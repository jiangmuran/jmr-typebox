// CodeMirror 6 glue for the Python IDE. This module touches the DOM (it constructs an
// EditorView attached to a real element) so it is imported LAZILY from inside <ClientOnly>,
// never at app/SSG load time. The pure file/console models live in fileModel.js /
// pythonHelpers.js and are tested separately; CodeMirror itself is NOT unit-tested.
//
// We build on the installed `codemirror` meta-package (basicSetup) plus @codemirror/lang-python
// and a couple of low-level packages that ship as its dependencies (no extra installs).

import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { indentWithTab, defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { indentUnit, indentOnInput, bracketMatching, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { closeBrackets } from '@codemirror/autocomplete'
import { highlightSelectionMatches } from '@codemirror/search'
import { python } from '@codemirror/lang-python'

// A light theme that leans on the app's CSS tokens so the editor blends into either palette.
// (CSS custom properties resolve at render time, so the same theme object works in light/dark —
// the values come from :root / [data-theme=dark].)
const appTheme = EditorView.theme({
  '&': {
    color: 'var(--text)',
    backgroundColor: 'transparent',
    fontSize: 'var(--editor-font-size, 13px)',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
    overflow: 'auto',
  },
  '.cm-content': {
    caretColor: 'var(--accent)',
    padding: '12px 0',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-tertiary)',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'var(--accent-bg)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--accent-bg)', color: 'var(--text-secondary)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--accent-bg)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--surface-active)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--surface-active)',
    outline: '1px solid var(--text-tertiary)',
  },
})

// Create an editor mounted at `parent`. Returns a small handle the Vue layer drives:
//   { setDoc, getDoc, focus, destroy }
// onChange(doc) fires (debounced by the caller's persistence) on every edit; onRun() fires on
// Cmd/Ctrl+Enter so the IDE can run without leaving the editor.
export function createEditor({ parent, doc = '', dark = false, onChange, onRun } = {}) {
  // Compartments let us reconfigure the dark theme without rebuilding the whole editor.
  const darkComp = new Compartment()

  const runKeymap = keymap.of([
    {
      key: 'Mod-Enter',
      preventDefault: true,
      run: () => { onRun?.(); return true },
    },
  ])

  const updateListener = EditorView.updateListener.of((u) => {
    if (u.docChanged) onChange?.(u.state.doc.toString())
  })

  const state = EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      history(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      indentUnit.of('    '),
      EditorState.tabSize.of(4),
      python(),
      runKeymap,
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      appTheme,
      darkComp.of(dark ? oneDarkish : []),
      updateListener,
    ],
  })

  const view = new EditorView({ state, parent })

  return {
    view,
    // Replace the whole document (used when switching files). We compare first so re-selecting
    // the active file doesn't reset the cursor.
    setDoc(next) {
      const cur = view.state.doc.toString()
      if (cur === next) return
      view.dispatch({ changes: { from: 0, to: cur.length, insert: next } })
    },
    getDoc() {
      return view.state.doc.toString()
    },
    setDark(isDark) {
      view.dispatch({ effects: darkComp.reconfigure(isDark ? oneDarkish : []) })
    },
    focus() {
      view.focus()
    },
    destroy() {
      view.destroy()
    },
  }
}

// A compact dark-mode syntax theme. Rather than pull in @codemirror/theme-one-dark (not
// installed), we adjust just the few colors that the token highlight needs to be legible on the
// app's near-black dark surface. Structural colors (bg, gutter, selection) already come from
// appTheme via CSS tokens, so this only tweaks selection/active-line contrast for dark.
const oneDarkish = EditorView.theme(
  {
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.04)' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(255,255,255,0.10)' },
  },
  { dark: true }
)
