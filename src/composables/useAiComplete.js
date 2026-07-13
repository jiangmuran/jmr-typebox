import { ref, computed } from 'vue'
import { useAI } from './useAI'
import { useSettings } from './useSettings'
import { useToast } from './useToast'
import { useI18n } from './useI18n'

// Inline completion fails silently by design. The ONE exception: a configuration
// problem (bad/expired API key → HTTP 401/403, or an "invalid key"-flavored error
// message) makes the feature look silently broken. We surface that with a single
// toast the FIRST time it happens in a session, then go quiet again so a persistent
// bad key can't nag on every keystroke. Module-scoped so it's once per page load,
// regardless of how many editors mount the composable.
let configToastShown = false

function isConfigError(e) {
  if (!e) return false
  if (e.status === 401 || e.status === 403) return true
  const msg = String(e.message || '').toLowerCase()
  return /invalid[\s_-]?(api[\s_-]?)?key|incorrect api key|unauthorized|authentication/.test(msg)
}

// Copilot-style inline "ghost text" completion for the Markdown editor's <textarea>.
//
// Separation of concerns:
//  - The PURE helpers below (no DOM) decide *whether* to suggest, build the prompt, clean the
//    model output, and compute the accept-insertion. They are unit-tested directly.
//  - The composable wires those to a debounce + AbortController + the AI client, and exposes a
//    reactive `suggestion` ref. The overlay component renders it; EditorPage handles Tab/dismiss.
//
// This NEVER mutates the document until the user accepts (Tab) — the ghost is a pure overlay.

export const COMPLETE_DEBOUNCE_MS = 450
// Cap the context we send so token usage stays tiny and latency low.
export const MAX_CONTEXT_BEFORE = 1500
export const MAX_CONTEXT_AFTER = 300

// Should we even ask for a completion at this caret position?
// Keep it simple/robust: only when there is no selection (caret is a point) AND the caret is at
// the end of the whole text OR at the end of its current line (i.e. nothing but whitespace/EOL
// follows on the same line). This avoids ghosting in the middle of a word/line.
export function shouldSuggestAt(value, selStart, selEnd) {
  if (typeof value !== 'string') return false
  if (selStart !== selEnd) return false              // a range is selected → no ghost
  const pos = selStart
  if (pos < 0 || pos > value.length) return false
  const before = value.slice(0, pos)
  // Require *some* preceding context to continue from.
  if (before.trim().length < 2) return false
  // Don't fire mid-word: the char immediately before should be a boundary-ish char is too strict;
  // instead, only require that the caret is at end-of-line (nothing non-newline remains on the line).
  const rest = value.slice(pos)
  const nextNewline = rest.indexOf('\n')
  const restOfLine = nextNewline === -1 ? rest : rest.slice(0, nextNewline)
  if (restOfLine.length > 0) return false            // text follows on this line → skip
  return true
}

// Build the chat messages for a SHORT continuation. We send the capped preceding text (and a
// little of what follows, if any) and ask for only the next bit — no preamble, no fences.
export function buildCompletionMessages(before, after = '') {
  const ctxBefore = String(before || '').slice(-MAX_CONTEXT_BEFORE)
  const ctxAfter = String(after || '').slice(0, MAX_CONTEXT_AFTER)
  const system =
    'You are an inline autocomplete engine inside a Markdown editor, like GitHub Copilot. ' +
    'Predict a SHORT, natural continuation of the user\'s text starting exactly at the cursor. ' +
    'Rules: output ONLY the continuation text to insert — never repeat what is already written, ' +
    'no quotes, no preamble, no explanations, no code fences. Continue at most one sentence or ' +
    'one short line. Match the existing language, tone and Markdown formatting. If a natural ' +
    'continuation is not possible, output nothing.'
  const user =
    `Text before the cursor (continue from its very end):\n<<<\n${ctxBefore}\n>>>` +
    (ctxAfter.trim()
      ? `\n\nText after the cursor (do NOT repeat or include it):\n<<<\n${ctxAfter}\n>>>`
      : '')
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

// Clean raw model output into an insertable suggestion. Strips wrapping quotes/code-fences the
// model sometimes adds, drops a leading copy of text it shouldn't repeat, and trims to a sane
// length. Returns '' when there is nothing useful to show.
export function sanitizeCompletion(raw, before = '') {
  if (!raw) return ''
  let s = String(raw)
  // Remove surrounding code fences if the whole thing got fenced.
  const fence = s.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/)
  if (fence) s = fence[1]
  // Strip a single pair of wrapping quotes.
  s = s.replace(/^\s*["'`]([\s\S]*)["'`]\s*$/, '$1')
  // Drop a leading newline-only prefix but keep meaningful internal newlines.
  s = s.replace(/^[ \t]*\n+/, '')
  // Guard against the model echoing the tail of `before`: strip the longest suffix of `before`
  // (up to 60 chars) that the suggestion repeats at its start. Catches both whole-tail echoes
  // and the common case of the model restarting the current word/phrase.
  const tail = String(before).slice(-60)
  for (let i = tail.length; i > 0; i--) {
    if (s.startsWith(tail.slice(tail.length - i))) { s = s.slice(i); break }
  }
  // Collapse a runaway completion to a reasonable size (a few lines / ~240 chars).
  if (s.length > 240) s = s.slice(0, 240)
  const lines = s.split('\n')
  if (lines.length > 4) s = lines.slice(0, 4).join('\n')
  // Trim trailing whitespace but preserve a single leading space if the model added one to join
  // onto the previous word naturally.
  s = s.replace(/\s+$/, '')
  // If, after the previous char being a non-space, the suggestion starts with a letter and the
  // char before the cursor is also a letter, keep as-is (model decides spacing). Nothing to do.
  return s
}

// Compute the result of accepting `suggestion` inserted at `pos` in `value`.
// Returns { value, caret } — caret lands at the end of the inserted text.
export function acceptInto(value, pos, suggestion) {
  const v = String(value ?? '')
  const p = Math.max(0, Math.min(pos | 0, v.length))
  const s = String(suggestion ?? '')
  return { value: v.slice(0, p) + s + v.slice(p), caret: p + s.length }
}

// ---- The composable ----
// opts: { getEditor: () => HTMLTextAreaElement|null, getContent: () => string }
export function useAiComplete(opts = {}) {
  const { ready, completeInline } = useAI()
  const { settings } = useSettings()
  const { showToast } = useToast()
  const { t } = useI18n()

  // Active suggestion: { pos, text } or null. `pos` is the caret index it was anchored at.
  const suggestion = ref(null)
  const loading = ref(false)

  let timer = null
  let controller = null
  let lastRequestId = 0

  // Feature is on only when AI is ready, the setting is enabled, and we're on a non-touch,
  // wide-enough environment (mobile keyboards + ghost overlays don't mix well).
  const enabled = computed(() => {
    if (!ready.value || !settings.aiInlineComplete) return false
    if (typeof window === 'undefined') return false
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
    const narrow = window.innerWidth <= 768
    return !coarse && !narrow
  })

  function clearTimer() { if (timer) { clearTimeout(timer); timer = null } }
  function abort() { if (controller) { try { controller.abort() } catch {} controller = null } }

  // Drop any pending request + visible ghost.
  function clear() {
    clearTimer()
    abort()
    loading.value = false
    if (suggestion.value) suggestion.value = null
  }

  // Schedule a completion after the idle debounce, if the caret position warrants one.
  function schedule() {
    clearTimer()
    abort()
    // A new edit supersedes any shown ghost.
    if (suggestion.value) suggestion.value = null
    if (!enabled.value) return
    const el = opts.getEditor?.()
    if (!el) return
    if (!shouldSuggestAt(el.value, el.selectionStart, el.selectionEnd)) return
    timer = setTimeout(run, COMPLETE_DEBOUNCE_MS)
  }

  async function run() {
    timer = null
    if (!enabled.value) return
    const el = opts.getEditor?.()
    if (!el) return
    const pos = el.selectionStart
    if (!shouldSuggestAt(el.value, el.selectionStart, el.selectionEnd)) return
    const before = el.value.slice(0, pos)
    const after = el.value.slice(pos)

    abort()
    controller = new AbortController()
    const reqId = ++lastRequestId
    loading.value = true
    let raw = ''
    try {
      raw = await completeInline(buildCompletionMessages(before, after), { signal: controller.signal })
    } catch (e) {
      // Stay silent (just show no ghost) — EXCEPT the first config error per session:
      // a bad/expired API key makes the feature look broken, so nudge the user once.
      if (isConfigError(e) && !configToastShown) {
        configToastShown = true
        showToast(t('ai.completeConfigError'))
      }
      if (reqId === lastRequestId) loading.value = false
      return
    }
    if (reqId !== lastRequestId) return            // superseded
    loading.value = false
    controller = null

    // Re-validate: the caret may have moved while we waited.
    const cur = opts.getEditor?.()
    if (!cur || cur.selectionStart !== pos || cur.selectionStart !== cur.selectionEnd) return
    if (cur.value.slice(0, pos) !== before) return // content changed under us

    const text = sanitizeCompletion(raw, before)
    if (!text) return
    suggestion.value = { pos, text }
  }

  // Accept the current ghost into the editor. Returns true if something was accepted.
  function accept() {
    const sug = suggestion.value
    const el = opts.getEditor?.()
    if (!sug || !el) return false
    // Insert via setRangeText so it merges into the browser's native undo stack.
    try {
      el.focus()
      el.setRangeText(sug.text, sug.pos, sug.pos, 'end')
      const caret = sug.pos + sug.text.length
      el.selectionStart = el.selectionEnd = caret
    } catch {
      return false
    }
    suggestion.value = null
    return true
  }

  return { suggestion, loading, enabled, schedule, clear, accept, abort }
}
