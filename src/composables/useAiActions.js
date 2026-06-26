import { ref } from 'vue'
import { useAI } from './useAI'
import { useEditor } from './useEditor'
import { buildSelectionMessages, buildDocMessages, buildGenerateMessages } from '../ai/prompts'

// Orchestrates the editor's one-shot AI actions: selection rewrites (streamed back into the
// textarea), whole-document actions, and "continue writing" inline completion. Holds the
// streaming/abort state so multiple UI surfaces (context menu, floating toolbar, export menu)
// share one implementation. Singleton-style like the other composables.

const busy = ref(false)            // an action is streaming
const streamingText = ref('')      // live partial output (for the preview popover)
const activeKind = ref('')         // label/id of the running action
const lastError = ref('')
let controller = null

export function useAiActions() {
  const { ready, chat } = useAI()
  const { content, updateContent } = useEditor()

  function abort() {
    if (controller) { try { controller.abort() } catch {} ; controller = null }
    busy.value = false
  }

  // Read the live selection from the editor textarea. Returns null when nothing usable.
  function getSelection(el) {
    if (!el) return null
    let start = el.selectionStart
    let end = el.selectionEnd
    if (end <= start) return null
    return { start, end, text: el.value.substring(start, end) }
  }

  // Stream a completion and call onChunk(fullSoFar, deltaText) for each token.
  async function streamInto(messages, { onChunk, temperature } = {}) {
    abort()
    controller = new AbortController()
    busy.value = true
    streamingText.value = ''
    lastError.value = ''
    let full = ''
    try {
      await chat(messages, {
        signal: controller.signal,
        temperature,
        onToken: (delta) => {
          full += delta
          streamingText.value = full
          onChunk?.(full, delta)
        },
      })
      return full
    } catch (e) {
      if (e?.name === 'AbortError') return full // partial kept
      lastError.value = e?.message || String(e)
      throw e
    } finally {
      busy.value = false
      controller = null
    }
  }

  // Selection action: replace the selected range live as tokens arrive. `el` is the textarea.
  // For non-replacing actions (explain), returns the text without touching the document.
  async function runSelectionAction(el, actionId, input) {
    const sel = getSelection(el)
    if (!sel) return { ok: false, reason: 'no-selection' }
    const { replaces, messages } = buildSelectionMessages(actionId, sel.text, input)
    activeKind.value = actionId

    if (!replaces) {
      const text = await streamInto(messages, { temperature: 0.4 })
      return { ok: true, replaced: false, text }
    }

    // Replace as we stream: keep the original range start fixed, grow the inserted text by
    // overwriting from curStart to the end of what we last wrote.
    const originalValue = el.value // snapshot so the final apply can be a single undoable edit
    const curStart = sel.start
    let curEnd = sel.end
    const text = await streamInto(messages, {
      temperature: 0.6,
      onChunk: (full) => {
        try {
          el.setRangeText(full, curStart, curEnd, 'end')
          curEnd = curStart + full.length
          updateContent(el.value)
        } catch { /* element may have unmounted */ }
      },
    })
    // setRangeText streaming bypasses the textarea's native undo history. Re-apply the final result
    // as ONE execCommand('insertText') edit over the original selection so a single Ctrl+Z reverts
    // the whole AI change. Falls back to setRangeText if execCommand is unavailable.
    try {
      el.focus()
      el.value = originalValue
      el.setSelectionRange(sel.start, sel.end)
      const undoable = typeof document !== 'undefined' && document.execCommand && document.execCommand('insertText', false, text)
      if (!undoable) el.setRangeText(text, sel.start, sel.end, 'end')
      el.selectionStart = curStart
      el.selectionEnd = curStart + text.length
      updateContent(el.value)
    } catch {
      try { el.setRangeText(text, curStart, curEnd, 'end'); updateContent(el.value) } catch {}
    }
    return { ok: true, replaced: true, text }
  }

  // Whole-document action. Replacing actions overwrite content; others return text to display.
  // `el` (the textarea) is optional — when given, the final overwrite is applied as a single
  // undoable edit so Ctrl+Z reverts the AI change.
  async function runDocAction(actionId, el) {
    const doc = content.value
    if (!doc.trim() && actionId !== 'generate') return { ok: false, reason: 'empty' }
    const { replaces, messages } = buildDocMessages(actionId, doc)
    activeKind.value = actionId
    if (replaces) {
      const originalValue = el ? el.value : doc
      const text = await streamInto(messages, {
        temperature: 0.6,
        onChunk: (full) => updateContent(full),
      })
      if (el) {
        try {
          el.focus()
          el.value = originalValue
          el.setSelectionRange(0, originalValue.length)
          const undoable = typeof document !== 'undefined' && document.execCommand && document.execCommand('insertText', false, text)
          if (!undoable) el.value = text
          updateContent(el.value)
        } catch { updateContent(text) }
      }
      return { ok: true, replaced: true, text }
    }
    const text = await streamInto(messages, { temperature: 0.4 })
    return { ok: true, replaced: false, text }
  }

  // "Write an article about…" — streams generated Markdown into the editor at the cursor/end.
  async function generateDocument(topic, el, { format = 'article' } = {}) {
    if (!topic?.trim()) return { ok: false, reason: 'empty' }
    activeKind.value = 'generate'
    const messages = buildGenerateMessages(topic, { format })
    const base = el ? el.value : content.value
    const insertAt = el ? (el.selectionStart ?? base.length) : base.length
    const before = base.slice(0, insertAt)
    const after = base.slice(insertAt)
    // Add a separating newline if inserting mid-text.
    const sep = before && !before.endsWith('\n') ? '\n\n' : ''
    const text = await streamInto(messages, {
      temperature: 0.8,
      onChunk: (full) => updateContent(before + sep + full + after),
    })
    return { ok: true, text }
  }

  // Inline "continue writing": stream a continuation at the cursor (ghost-accept handled by caller).
  // Returns the continuation text; the caller inserts it.
  async function continueWriting(el, { onChunk } = {}) {
    if (!el) return { ok: false }
    const cursor = el.selectionStart ?? el.value.length
    const before = el.value.slice(0, cursor)
    const after = el.value.slice(cursor)
    if (!before.trim()) return { ok: false, reason: 'empty' }
    // Give the model recent context (cap to keep tokens sane).
    const ctxBefore = before.slice(-4000)
    const ctxAfter = after.slice(0, 1000)
    const messages = [
      {
        role: 'system',
        content:
          'You are a writing assistant that continues the user\'s Markdown text. Continue naturally from where it stops. ' +
          'Output ONLY the continuation (no repetition of the existing text, no preamble, no code fences). Keep the same language and voice.',
      },
      {
        role: 'user',
        content:
          `Continue this text. Text before the cursor:\n"""\n${ctxBefore}\n"""` +
          (ctxAfter.trim() ? `\n\nText after the cursor (do not repeat it):\n"""\n${ctxAfter}\n"""` : ''),
      },
    ]
    activeKind.value = 'continue'
    const text = await streamInto(messages, { temperature: 0.7, onChunk })
    return { ok: true, text }
  }

  return {
    ready,
    busy,
    streamingText,
    activeKind,
    lastError,
    abort,
    getSelection,
    runSelectionAction,
    runDocAction,
    generateDocument,
    continueWriting,
  }
}
