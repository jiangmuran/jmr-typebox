// Impure Pyodide runtime glue for the Python playground. This module touches the network,
// WebAssembly and the global scope, so it is imported LAZILY (only when the user runs code or
// loads the runtime) and never at app/SSG load time. Pure value logic lives in
// pythonHelpers.js and is tested separately; the wasm runtime itself is NOT unit-tested.

import { loadLibrary } from '../../utils/loadLibrary'
import { PYODIDE_SIZE_MB } from './pythonHelpers'

// Self-hosted core (copied into public/pyodide/ from the `pyodide` package by
// scripts/copy-assets.js). Loading from a same-origin folder means NO CDN and the browser
// HTTP cache keeps the ~12MB runtime after first use, so re-loads are instant.
const INDEX_URL = '/pyodide/'

let pyodideInstance = null   // the loaded Pyodide instance (singleton)
let loadPromise = null       // dedupes concurrent load() calls
let bootstrapped = false     // capture helpers defined in the interpreter once
let matplotlibPatched = false // Agg backend + show() shim installed once matplotlib loads

// Lazily import the `pyodide` ESM through loadLibrary so the shared spinner + size hint
// ("downloading ~12MB") works exactly like the ffmpeg core and other heavy libs.
function importPyodide() {
  return loadLibrary('pyodide', () => import('pyodide'), { sizeMB: PYODIDE_SIZE_MB })
}

// Get a loaded, ready-to-use Pyodide instance. The runtime loads once and is reused for every
// subsequent run (instant). Optional onStatus(msg) reports coarse load phases for the banner.
export async function getPyodide({ onStatus } = {}) {
  if (pyodideInstance) return pyodideInstance
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    onStatus?.('download')
    const mod = await importPyodide()
    const { loadPyodide } = mod
    onStatus?.('init')
    const py = await loadPyodide({ indexURL: INDEX_URL })
    pyodideInstance = py
    return py
  })()

  try {
    await loadPromise
  } catch (err) {
    loadPromise = null // allow retry after a failed load
    throw err
  }
  return pyodideInstance
}

// Defines the capture helpers in the interpreter once (run by bootstrap()): a matplotlib
// figure grabber (_tb_take_figures), the Agg/show() installer (_tb_install_matplotlib, called
// lazily after matplotlib loads), and _tb_repr for the last expression's rich/text repr.
const BOOTSTRAP_PY = `
import io, base64

# Matplotlib figure capture. Called lazily (from JS) only AFTER matplotlib is loaded, since
# it ships separately and is pulled in on demand by loadPackagesFromImports. Switches to the
# headless Agg backend and rewires plt.show() to stash each figure as a base64 PNG.
_tb_figs = []
def _tb_install_matplotlib():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    def _show(*args, **kwargs):
        for num in plt.get_fignums():
            fig = plt.figure(num)
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
            _tb_figs.append(base64.b64encode(buf.getvalue()).decode("ascii"))
        plt.close("all")
    plt.show = _show

def _tb_take_figures():
    out = list(_tb_figs)
    _tb_figs.clear()
    return out

# Rich repr of the last expression value: prefer _repr_html_, else repr(). Returns
# {"kind": "html"|"text"|"none", "data": str}.
def _tb_repr(value):
    if value is None:
        return {"kind": "none", "data": ""}
    html = getattr(value, "_repr_html_", None)
    if callable(html):
        try:
            return {"kind": "html", "data": str(html())}
        except Exception:
            pass
    try:
        return {"kind": "text", "data": repr(value)}
    except Exception:
        return {"kind": "text", "data": "<unreprable object>"}
`

async function bootstrap(py) {
  if (bootstrapped) return
  await py.runPythonAsync(BOOTSTRAP_PY)
  bootstrapped = true
}

// Run a snippet. Streams stdout/stderr via the provided callbacks (already batched by the
// caller) and returns a structured result:
//   { ok, result: { kind, data }, figures: string[] (base64 png), error: string|null }
// The last top-level expression's value is captured the way a REPL would show it.
export async function runPython(code, { onStdout, onStderr, onStatus } = {}) {
  const py = await getPyodide({ onStatus })
  await bootstrap(py)

  // Route stdout/stderr to the UI. setStdout/setStderr accept a batched callback that gets
  // whole strings; we forward them straight to the caller's batcher.
  py.setStdout({ batched: (s) => onStdout?.(s) })
  py.setStderr({ batched: (s) => onStderr?.(s) })

  const figures = []
  let result = { kind: 'none', data: '' }
  let error = null

  try {
    // Since Pyodide 0.18, runPythonAsync does NOT auto-install packages referenced by import
    // statements. loadPackagesFromImports inspects the code and loads any packages that are
    // bundled with Pyodide (numpy, matplotlib, pandas, …) from the self-hosted lock — this is
    // OFFLINE (no network); micropip is only needed for packages not in the lock.
    try {
      await py.loadPackagesFromImports(code)
    } catch { /* unknown/3rd-party imports — let the run raise a clear ModuleNotFoundError */ }

    // matplotlib may have just been loaded; (re)install the Agg backend + show() capture.
    if (!matplotlibPatched) {
      try {
        await py.runPythonAsync('_tb_install_matplotlib()')
        matplotlibPatched = true
      } catch { /* matplotlib not present — ignore */ }
    }

    // run_async returns the value of the last expression (like the REPL), or None.
    const value = await py.runPythonAsync(code)
    // Collect any matplotlib figures produced during the run.
    try {
      const takeFigs = py.globals.get('_tb_take_figures')
      const figProxy = takeFigs()
      const arr = figProxy?.toJs ? figProxy.toJs() : figProxy
      if (Array.isArray(arr)) figures.push(...arr)
      figProxy?.destroy?.()
      takeFigs?.destroy?.()
    } catch { /* matplotlib not used — ignore */ }

    // Rich repr of the last expression.
    try {
      const reprFn = py.globals.get('_tb_repr')
      const r = reprFn(value)
      const obj = r.toJs ? r.toJs({ dict_converter: Object.fromEntries }) : r
      if (obj && obj.kind) result = { kind: obj.kind, data: obj.data }
      r?.destroy?.()
      reprFn?.destroy?.()
    } catch { /* ignore repr failures */ }

    // Free the PyProxy of the returned value if one was created.
    if (value && typeof value.destroy === 'function') value.destroy()
  } catch (err) {
    error = err
  } finally {
    // Restore default streams so nothing leaks between runs.
    try { py.setStdout({}) } catch {}
    try { py.setStderr({}) } catch {}
  }

  return { ok: !error, result, figures, error }
}

// Install packages with micropip. This FETCHES WHEELS OVER THE NETWORK (PyPI / jsDelivr) and
// is the only part of the playground that is not offline. Returns the list of installed
// specifiers. onStatus(spec) reports progress per package. Pure-python wheels and the many
// packages prebuilt for Pyodide both work.
export async function installPackages(specs, { onStatus } = {}) {
  if (!specs || !specs.length) return []
  const py = await getPyodide()
  await py.loadPackage('micropip')
  const micropip = py.pyimport('micropip')
  try {
    for (const spec of specs) {
      onStatus?.(spec)
      // keep_going surfaces a clearer error if a dependency can't be resolved.
      await micropip.install(spec, { keep_going: true })
    }
    return [...specs]
  } finally {
    micropip?.destroy?.()
  }
}

// True once the runtime is loaded (re-runs are instant). Lets the UI label state without
// importing loadLibrary state directly.
export function isReady() {
  return !!pyodideInstance
}

// Free the runtime (used by tests / clear-all). Best-effort; Pyodide has no full teardown, so
// we just drop our references and let the page reload reclaim memory.
export function _resetRunner() {
  pyodideInstance = null
  loadPromise = null
  bootstrapped = false
  matplotlibPatched = false
}
