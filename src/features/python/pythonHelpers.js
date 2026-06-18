// Pure, SSG-safe helpers for the Python playground. NO window/document/pyodide/Blob/Worker
// access here — these operate on plain values so they can be unit-tested in node and imported
// anywhere (including index.js, which must stay side-effect-free). All impure Pyodide work
// lives in ./pythonRunner and is loaded lazily.

// Approx download weight of the Pyodide core (wasm + stdlib) — surfaced in the UI via
// libLoadState/libMeta exactly like the ffmpeg core in the Media suite.
export const PYODIDE_SIZE_MB = 12

// ---- localStorage keys (prefix `tb-` is added by utils/storage) -------------------------
// The current draft snippet and a couple of small prefs persist across reloads.
const STORAGE_NS = 'python'

export function storageKey(name) {
  return `${STORAGE_NS}-${name}`
}

export const STORAGE_KEYS = {
  code: storageKey('code'),
  packages: storageKey('packages'),
}

// ---- Console line model -----------------------------------------------------------------
// A run produces an ordered list of console lines. Each is a plain object so it can be
// rendered with distinct styling and asserted in tests without touching the DOM.
//   kind: 'out' (stdout) | 'err' (stderr/traceback) | 'result' (last-expr repr) | 'info'
export function makeLine(kind, text) {
  return { kind, text: text == null ? '' : String(text) }
}

// Append text to a console-line array, coalescing consecutive same-kind chunks into the
// trailing line so streamed stdout doesn't explode into one object per character. Mutates
// and returns `lines` for convenience.
export function appendChunk(lines, kind, text) {
  if (text == null || text === '') return lines
  const last = lines[lines.length - 1]
  if (last && last.kind === kind) last.text += String(text)
  else lines.push(makeLine(kind, text))
  return lines
}

// ---- stdout/stderr batching buffer ------------------------------------------------------
// Pyodide's setStdout/setStderr can fire per-write. We buffer raw chunks and flush them on a
// timer (or when explicitly flushed), which keeps the UI smooth during chatty loops. This is
// pure state management — the actual scheduling (setTimeout) is the caller's concern, so the
// logic stays testable in node.
export function createBatcher(onFlush, { maxChars = 8192 } = {}) {
  let buf = ''
  return {
    push(chunk) {
      if (chunk == null) return
      buf += String(chunk)
      // Flush eagerly if the buffer gets large so memory stays bounded during huge outputs.
      if (buf.length >= maxChars) this.flush()
    },
    flush() {
      if (!buf) return
      const out = buf
      buf = ''
      onFlush(out)
    },
    get pending() { return buf },
    get hasPending() { return buf.length > 0 },
  }
}

// ---- Error formatting -------------------------------------------------------------------
// Pyodide throws PythonError whose .message already contains the formatted traceback. Trim
// the noisy leading Pyodide/JS frames so the user sees the Python traceback they expect.
export function formatError(err) {
  const raw = (err && (err.message || err.toString())) || 'Error'
  const lines = String(raw).split('\n')
  // Keep from the first "Traceback (most recent call last):" if present; else show as-is.
  const tbIdx = lines.findIndex(l => l.startsWith('Traceback (most recent call last)'))
  const kept = tbIdx >= 0 ? lines.slice(tbIdx) : lines
  return kept.join('\n').replace(/\s+$/, '')
}

// ---- micropip / package input parsing ---------------------------------------------------
// Parse a free-text package field ("numpy, pandas==2.0  requests") into a clean, de-duped
// list of requirement specifiers. Accepts commas and/or whitespace as separators.
export function parsePackages(text) {
  if (!text) return []
  const seen = new Set()
  const out = []
  for (const tok of String(text).split(/[\s,]+/)) {
    const t = tok.trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

// The base package name of a requirement specifier (for "already installed?" checks and
// import hints). "pandas==2.0.1" -> "pandas", "scikit-learn>=1" -> "scikit-learn".
export function packageName(spec) {
  return String(spec || '').trim().split(/[<>=!~ \[]/)[0].toLowerCase()
}

// ---- Examples gallery -------------------------------------------------------------------
// Small, self-contained snippets that entice exploration. Everything except `requests-demo`
// runs fully offline on the Python stdlib + bundled numpy/matplotlib. `id` is stable so it
// can be referenced from tests and the command palette.
export const EXAMPLES = [
  {
    id: 'hello',
    title: { en: 'Hello, world', zh: '你好,世界' },
    needsNetwork: false,
    code: [
      'import sys',
      'print("Hello from Python", sys.version.split()[0])',
      '',
      'for i in range(1, 6):',
      '    print(f"{i} squared is {i*i}")',
      '',
      '# The value of the last expression is shown too:',
      'sum(range(101))',
      '',
    ].join('\n'),
  },
  {
    id: 'stdlib',
    title: { en: 'Stdlib tour (json · datetime · collections)', zh: '标准库一览(json · datetime · collections)' },
    needsNetwork: false,
    code: [
      'import json, datetime, collections, statistics',
      '',
      'data = [{"name": n, "score": s} for n, s in zip("abcde", [91, 72, 88, 64, 95])]',
      'print(json.dumps(data, indent=2))',
      '',
      'scores = [d["score"] for d in data]',
      'print("mean:", statistics.mean(scores), "stdev:", round(statistics.pstdev(scores), 2))',
      '',
      'top = collections.Counter({d["name"]: d["score"] for d in data}).most_common(2)',
      'print("top two:", top)',
      'print("generated at", datetime.datetime(2026, 1, 1).isoformat())',
      '',
    ].join('\n'),
  },
  {
    id: 'plot',
    title: { en: 'Matplotlib plot', zh: 'Matplotlib 绘图' },
    needsNetwork: false,
    code: [
      '# Plots render inline as PNG. numpy + matplotlib ship with Pyodide (offline).',
      'import numpy as np',
      'import matplotlib.pyplot as plt',
      '',
      'x = np.linspace(0, 4 * np.pi, 400)',
      'plt.figure(figsize=(6, 3.2))',
      'plt.plot(x, np.sin(x), label="sin")',
      'plt.plot(x, np.cos(x), label="cos", linestyle="--")',
      'plt.title("Trig functions")',
      'plt.legend()',
      'plt.grid(alpha=0.3)',
      'plt.show()',
      '',
    ].join('\n'),
  },
  {
    id: 'numpy',
    title: { en: 'NumPy arrays', zh: 'NumPy 数组' },
    needsNetwork: false,
    code: [
      'import numpy as np',
      '',
      'a = np.arange(12).reshape(3, 4)',
      'print("matrix:\\n", a)',
      'print("column means:", a.mean(axis=0))',
      'print("row sums:", a.sum(axis=1))',
      '',
      'rng = np.random.default_rng(0)',
      'samples = rng.normal(size=1000)',
      'print("sampled mean:", round(samples.mean(), 3))',
      '',
    ].join('\n'),
  },
  {
    id: 'html',
    title: { en: 'Render HTML output', zh: '渲染 HTML 输出' },
    needsNetwork: false,
    code: [
      '# Return an object with _repr_html_ (or use display) to render rich HTML inline.',
      'from pyodide.ffi import to_js  # noqa: F401',
      '',
      'rows = "".join(',
      '    f"<tr><td>{n}</td><td>{n*n}</td><td>{n**3}</td></tr>" for n in range(1, 6)',
      ')',
      'html = f"""',
      '<table style="border-collapse:collapse;font-family:sans-serif">',
      '  <thead><tr><th>n</th><th>n²</th><th>n³</th></tr></thead>',
      '  <tbody>{rows}</tbody>',
      '</table>',
      '"""',
      '',
      'class HTML:',
      '    def __init__(self, s): self.s = s',
      '    def _repr_html_(self): return self.s',
      '',
      'HTML(html)',
      '',
    ].join('\n'),
  },
  {
    id: 'requests-demo',
    title: { en: 'Install a package (micropip · network)', zh: '安装一个包(micropip · 联网)' },
    needsNetwork: true,
    code: [
      '# This needs the "Install packages" field above (micropip fetches the wheel over the',
      '# network). The pure-python "cowsay" wheel is tiny and works well as a demo.',
      'import cowsay',
      'cowsay.cow("Installed from PyPI via micropip!")',
      '',
    ].join('\n'),
  },
]

export function getExample(id) {
  return EXAMPLES.find(e => e.id === id) || null
}

// Default snippet shown on a fresh visit (no saved draft).
export const DEFAULT_CODE = getExample('hello').code

// ---- Example PROJECTS (multi-file file-sets) for the IDE ---------------------------------
// Each project loads a whole set of `.py` files at once (entry = the file made active). Unlike
// the legacy single-file EXAMPLES above (kept for back-compat), these can demonstrate
// cross-file imports. Everything except `packages` runs fully offline on the Python stdlib +
// bundled numpy/matplotlib. `id` is stable so it can be referenced from tests.
export const EXAMPLE_PROJECTS = [
  {
    id: 'hello',
    title: { en: 'Hello, world', zh: '你好,世界' },
    needsNetwork: false,
    entry: 'main.py',
    files: {
      'main.py': getExample('hello').code,
    },
  },
  {
    id: 'multifile',
    title: { en: 'Multi-file (cross-import)', zh: '多文件(跨文件导入)' },
    needsNetwork: false,
    entry: 'main.py',
    files: {
      'main.py': [
        '# main.py imports from the sibling files in this project. All files are written into',
        '# Pyodide\'s virtual filesystem before running, so plain imports just work.',
        'from geometry import circle_area, Rectangle',
        'from greet import banner',
        '',
        'print(banner("Multi-file Python"))',
        'print(f"Area of r=2 circle: {circle_area(2):.4f}")',
        '',
        'box = Rectangle(3, 4)',
        'print(f"{box} -> area {box.area()}, perimeter {box.perimeter()}")',
        '',
        '# Last expression value is shown in the output panel too:',
        'circle_area(1)',
        '',
      ].join('\n'),
      'geometry.py': [
        '"""A tiny geometry module imported by main.py."""',
        'import math',
        '',
        '',
        'def circle_area(r):',
        '    return math.pi * r * r',
        '',
        '',
        'class Rectangle:',
        '    def __init__(self, w, h):',
        '        self.w = w',
        '        self.h = h',
        '',
        '    def area(self):',
        '        return self.w * self.h',
        '',
        '    def perimeter(self):',
        '        return 2 * (self.w + self.h)',
        '',
        '    def __repr__(self):',
        '        return f"Rectangle({self.w}x{self.h})"',
        '',
      ].join('\n'),
      'greet.py': [
        '"""Formatting helpers imported by main.py."""',
        '',
        '',
        'def banner(text):',
        '    line = "=" * (len(text) + 4)',
        '    return f"{line}\\n| {text} |\\n{line}"',
        '',
      ].join('\n'),
    },
  },
  {
    id: 'plot',
    title: { en: 'Matplotlib plot', zh: 'Matplotlib 绘图' },
    needsNetwork: false,
    entry: 'main.py',
    files: {
      'main.py': getExample('plot').code,
    },
  },
  {
    id: 'numpy',
    title: { en: 'NumPy arrays', zh: 'NumPy 数组' },
    needsNetwork: false,
    entry: 'main.py',
    files: {
      'main.py': getExample('numpy').code,
    },
  },
  {
    id: 'html',
    title: { en: 'Render HTML output', zh: '渲染 HTML 输出' },
    needsNetwork: false,
    entry: 'main.py',
    files: {
      'main.py': getExample('html').code,
    },
  },
  {
    id: 'packages',
    title: { en: 'Install a package (micropip · network)', zh: '安装一个包(micropip · 联网)' },
    needsNetwork: true,
    entry: 'main.py',
    files: {
      'main.py': getExample('requests-demo').code,
    },
  },
]

export function getExampleProject(id) {
  return EXAMPLE_PROJECTS.find(e => e.id === id) || null
}

// ---- editor helpers ---------------------------------------------------------------------
// Insert `unit` spaces at a caret position in textarea-like state, returning the new value
// and the caret offset to restore. Pure string math so Tab-to-indent is testable.
export function insertIndent(value, selStart, selEnd, unit = '    ') {
  const v = String(value)
  if (selStart === selEnd) {
    const next = v.slice(0, selStart) + unit + v.slice(selEnd)
    return { value: next, caret: selStart + unit.length }
  }
  // Selection spanning multiple lines: indent every line in range.
  const lineStart = v.lastIndexOf('\n', selStart - 1) + 1
  const before = v.slice(0, lineStart)
  const region = v.slice(lineStart, selEnd)
  const after = v.slice(selEnd)
  const indented = region.replace(/^/gm, unit)
  return {
    value: before + indented + after,
    caret: selEnd + (indented.length - region.length),
    selStart: lineStart,
    selEnd: lineStart + indented.length,
  }
}
