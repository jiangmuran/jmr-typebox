<script setup>
// Multi-file Python workbench. Rendered ONLY inside <ClientOnly>, so it is safe to touch
// window/document/CodeMirror/pyodide here. Pure logic (file model, console model, examples,
// package parsing, request/proxy shaping) is imported from ./fileModel + ./pythonHelpers +
// ./pythonNet; CodeMirror is set up via ./cmEditor and the wasm runtime is lazy-loaded from
// ./pythonRunner on first run. Nothing heavy is touched at module top level or in synchronous
// setup beyond reading localStorage.
//
// Layout: a VS-Code-like workbench on desktop (file explorer rail · editor with tabs · a
// resizable, collapsible bottom panel that tabs between Output and the Web Preview) and a SIMPLE
// single-column flow on mobile (file chips → editor → Run → output). The web preview is fully
// collapsible and only opens when the CURRENT run produces a web app or the user opts in — it
// never auto-pops on later runs once dismissed.
import { ref, computed, reactive, shallowRef, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { useSettings } from '../../composables/useSettings'
import { useBackend } from '../../composables/useBackend'
import { load, save } from '../../utils/storage'
import { libLoadState } from '../../utils/loadLibrary'
import BackendInfo from '../../components/BackendInfo.vue'
import {
  EXAMPLE_PROJECTS,
  appendChunk,
  createBatcher,
  formatError,
  parsePackages,
  STORAGE_KEYS,
} from './pythonHelpers'
import { prettyJson } from './pythonNet'
import { resolveNav, resolveForm, injectPreviewBridge } from './workerProtocol'
import {
  FILES_STORAGE_KEY,
  deserializeProject,
  serializeProject,
  fileNames,
  addFile,
  renameFile,
  deleteFile,
  setActive,
  setContent,
  activeContent,
} from './fileModel'

const { t, locale } = useI18n()
const { showToast } = useToast()
const { settings, resolvedTheme } = useSettings()
const { apiBase, probe: probeBackend } = useBackend()

// ---- file project state -----------------------------------------------------------------
const project = ref(deserializeProject(load(FILES_STORAGE_KEY), load(STORAGE_KEYS.code)))
const names = computed(() => fileNames(project.value))
const activeName = computed(() => project.value.active)

const pkgText = ref(load(STORAGE_KEYS.packages) ?? '')

// ---- editor (CodeMirror) ----------------------------------------------------------------
const editorEl = ref(null)
const cm = shallowRef(null)
const editorReady = ref(false)

// ---- run / output state -----------------------------------------------------------------
const lines = reactive([])
const result = ref({ kind: 'none', data: '' })
const figures = ref([])
const htmlOut = ref('')
const busy = ref(false)
const phase = ref('')
const installing = ref(false)
const hadError = ref(false)

const coreProgress = ref(null)
const coreDownloading = ref(false)
const restarting = ref(false)        // worker was terminated by Stop; a fresh one is booting
const runtimeCached = ref(false)     // the Pyodide runtime is in the durable cache (instant start)

// ---- interactive stdin (input()) --------------------------------------------------------
// input() reads from the IN-PAGE terminal line — NEVER a browser alert/prompt. With the stdin
// Service Worker active (stdinBlocking), a program calling input() truly PAUSES until the user
// types a line + Enter, then resumes — like a real terminal. When the program is waiting we set
// awaitingInput to focus/highlight the terminal input. (If the SW is unavailable, input() falls
// back to consuming pre-typed lines.)
const stdinText = ref('')
const stdinInput = ref(null)
const mStdinInput = ref(null)
const awaitingInput = ref(false)
const stdinBlocking = ref(false)     // SW-backed blocking input() is available

// ---- web preview ------------------------------------------------------------------------
// hasApp: the LAST run left a web app (WSGI/ASGI) in globals. appKind: 'wsgi' | 'asgi' | ''.
// previewVisible: the user's explicit show/hide. The auto-popup bug ("once activated it keeps
// popping up") is fixed by gating the preview on previewVisible + the current run's hasApp only —
// dismissing sets previewVisible=false and it STAYS dismissed until the user re-opens it or a
// fresh run produces a (new) app and they haven't dismissed this run.
const hasApp = ref(false)
const appKind = ref('')
const previewVisible = ref(false)
const previewDismissed = ref(false)   // user closed the preview for the current run
const previewPath = ref('/')
const previewHtml = ref('')
const previewStatus = ref('')
const previewStatusCode = ref(0)
const previewCtype = ref('')
const previewError = ref('')
const previewBusy = ref(false)

// ---- workbench panel layout (desktop) ---------------------------------------------------
const panelTab = ref('output')           // 'output' | 'preview'
const panelCollapsed = ref(false)        // bottom panel hidden (editor full-height)
const explorerCollapsed = ref(load('python-explorer-collapsed') === '1')
const panelHeight = ref(clampPanel(Number(load('python-panel-h')) || 280))
const isNarrow = ref(false)              // mobile single-column mode

function clampPanel(px) {
  const max = typeof window !== 'undefined' ? Math.max(160, window.innerHeight - 260) : 600
  return Math.min(Math.max(140, px || 280), max)
}

// Pyodide load state for the first-run banner.
const coreLoading = computed(() => libLoadState.pyodide === 'loading')
const coreReady = computed(() => libLoadState.pyodide === 'ready')
const runtimeReadyFlag = ref(false)  // mirrors the worker's "Pyodide loaded" (reset by Stop)

// ---- package manager + cache status -----------------------------------------------------
const pkgManagerOpen = ref(false)
const installedPkgs = ref([])        // [{ name, version, source, installer }]
const pkgLoading = ref(false)

// Pull the installed-package list + cache state from the runner (post-run / on open). Cheap and
// best-effort; only meaningful once the runtime exists.
async function refreshRuntimeMeta() {
  try {
    const { listPackages, isReady } = await import('./pythonRunner')
    if (!isReady()) return
    runtimeReadyFlag.value = true
    pkgLoading.value = true
    installedPkgs.value = await listPackages()
  } catch { /* best-effort */ } finally {
    pkgLoading.value = false
  }
}

async function togglePkgManager() {
  pkgManagerOpen.value = !pkgManagerOpen.value
  if (pkgManagerOpen.value) { refreshRuntimeMeta(); probeRuntimeCache() }
}

// Read the durable Cache directly (same origin, same bucket the worker writes) to learn whether the
// big runtime asset is already cached — drives the "cached / will download" banner + pill WITHOUT
// spawning the worker or fetching anything.
async function probeRuntimeCache() {
  try {
    if (typeof caches === 'undefined') return
    const { PYODIDE_VERSION, PYODIDE_CDN_URL } = await import('./pythonRunner')
    const cache = await caches.open(`typebox-pyodide-v${PYODIDE_VERSION}`)
    const hit = await cache.match(PYODIDE_CDN_URL + 'pyodide.asm.wasm')
    runtimeCached.value = !!hit
  } catch { /* best-effort */ }
}

async function uninstallPkg(name) {
  try {
    const { uninstallPackage } = await import('./pythonRunner')
    await uninstallPackage(name)
    showToast(t('py.uninstalled'))
    await refreshRuntimeMeta()
  } catch (err) {
    showToast(t('py.uninstallFailed'))
  }
}

const progressLabel = computed(() => {
  const p = coreProgress.value
  if (!p || !p.total) return t('py.downloadingCore')
  const mb = (n) => (n / 1_048_576).toFixed(1)
  return `${t('py.downloadingCore')} · ${mb(p.loaded)} / ${mb(p.total)} MB`
})
const progressPct = computed(() => {
  const p = coreProgress.value
  if (!p || !p.total) return 0
  return Math.max(0, Math.min(100, Math.round((p.loaded / p.total) * 100)))
})

const examples = computed(() =>
  EXAMPLE_PROJECTS.map(e => ({ id: e.id, title: e.title[locale.value] || e.title.en, needsNetwork: e.needsNetwork }))
)
const examplesOpen = ref(false)
const exWrapEl = ref(null)
// Toggle the examples menu. Outside-clicks close it via a document listener registered only while
// open (and on the NEXT tick), so the same gesture that opens it can't immediately close it — the
// fragile full-screen-backdrop approach caught the opening click and snapped the menu shut.
function toggleExamples() {
  examplesOpen.value = !examplesOpen.value
  if (examplesOpen.value) {
    nextTick(() => document.addEventListener('pointerdown', onOutsideExamples, true))
  } else {
    document.removeEventListener('pointerdown', onOutsideExamples, true)
  }
}
function onOutsideExamples(e) {
  if (exWrapEl.value && !exWrapEl.value.contains(e.target)) {
    examplesOpen.value = false
    document.removeEventListener('pointerdown', onOutsideExamples, true)
  }
}

const hasOutput = computed(() =>
  lines.length > 0 || figures.value.length > 0 || !!htmlOut.value ||
  (result.value.kind === 'text' && !!result.value.data)
)

const cmdLabel = computed(() =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘↵' : 'Ctrl+↵'
)

// ---- inline rename state ----------------------------------------------------------------
const renaming = ref(null)
const renameText = ref('')
const renameInput = ref(null)

// ---- persistence (debounced) ------------------------------------------------------------
let saveTimer = null
function persist() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(persistNow, 400)
}
function persistNow() {
  clearTimeout(saveTimer)
  save(FILES_STORAGE_KEY, serializeProject(project.value))
  save(STORAGE_KEYS.packages, pkgText.value)
}

// ---- editor wiring ----------------------------------------------------------------------
async function initEditor() {
  if (cm.value || !editorEl.value) return
  const { createEditor } = await import('./cmEditor')
  cm.value = createEditor({
    parent: editorEl.value,
    doc: activeContent(project.value),
    dark: resolvedTheme.value === 'dark',
    onChange: (doc) => {
      project.value = setContent(project.value, activeName.value, doc)
      persist()
    },
    onRun: () => run(),
  })
  editorReady.value = true
}

watch(activeName, () => {
  if (cm.value) cm.value.setDoc(activeContent(project.value))
})
watch(resolvedTheme, (theme) => {
  cm.value?.setDark(theme === 'dark')
})

// ---- file actions -----------------------------------------------------------------------
function switchTo(name) {
  if (renaming.value) return
  project.value = setActive(project.value, name)
  persist()
  nextTick(() => cm.value?.focus())
}
function newFile() {
  const { project: next, name, error } = addFile(project.value, null, '')
  if (error) { showToast(t('py.fileError')); return }
  project.value = next
  persistNow()
  nextTick(() => beginRename(name))
}
function removeFile(name) {
  const { project: next, error } = deleteFile(project.value, name)
  if (error === 'last') { showToast(t('py.cantDeleteLast')); return }
  if (error) return
  project.value = next
  persistNow()
  nextTick(() => cm.value?.focus())
}
function beginRename(name) {
  renaming.value = name
  renameText.value = name
  nextTick(() => {
    const el = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value
    if (el) {
      el.focus()
      const dot = name.lastIndexOf('.')
      el.setSelectionRange(0, dot > 0 ? dot : name.length)
    }
  })
}
function commitRename() {
  const from = renaming.value
  if (!from) return
  const to = renameText.value
  renaming.value = null
  if (!to || to === from) return
  const { project: next, error } = renameFile(project.value, from, to)
  if (error === 'duplicate') { showToast(t('py.fileDuplicate')); return }
  if (error === 'invalid') { showToast(t('py.fileInvalid')); return }
  if (error) return
  project.value = next
  persistNow()
}
function cancelRename() { renaming.value = null }

// ---- run --------------------------------------------------------------------------------
// One batcher pair lives for the whole component so streamed chunks coalesce smoothly; a 60ms
// timer flushes them to the reactive `lines` array while a run is in flight (live streaming).
let outBatcher = null
let errBatcher = null
let flushTimer = null

async function run() {
  if (busy.value) return
  busy.value = true
  hadError.value = false
  awaitingInput.value = false
  lines.length = 0
  result.value = { kind: 'none', data: '' }
  figures.value = []
  htmlOut.value = ''
  // Reset preview run-state. Crucially we clear hasApp/dismissed BEFORE the run so a previous
  // run's app can't keep the pane alive, and a freshly-dismissed flag doesn't leak across runs.
  hasApp.value = false
  appKind.value = ''
  previewDismissed.value = false
  previewHtml.value = ''
  previewStatus.value = ''
  previewStatusCode.value = 0
  previewError.value = ''
  phase.value = coreReady.value ? t('py.running') : t('py.loadingCore')
  // On mobile, jump the view focus to output; on desktop default the panel to Output.
  if (!isNarrow.value) { panelCollapsed.value = false; panelTab.value = 'output' }

  outBatcher = createBatcher(s => appendChunk(lines, 'out', s))
  errBatcher = createBatcher(s => appendChunk(lines, 'err', s))
  clearInterval(flushTimer)
  flushTimer = setInterval(() => { outBatcher?.flush(); errBatcher?.flush() }, 60)

  try {
    const runner = await import('./pythonRunner')
    const { runPython, setProxyApiBase } = runner
    // Point the in-interpreter network patch at the same-origin CORS proxy — but only when the
    // backend master toggle is on. Off ⇒ no proxy ⇒ Python networking (requests/urllib) is disabled.
    setProxyApiBase(apiBase || '', settings.backendEnabled)

    const res = await runPython(
      { files: { ...project.value.files }, entry: activeName.value },
      {
        // Output resuming means the program moved past any input() — clear the awaiting state.
        onStdout: s => { awaitingInput.value = false; outBatcher.push(s) },
        onStderr: s => { awaitingInput.value = false; errBatcher.push(s) },
        onStatus: st => {
          coreDownloading.value = st === 'download'
          phase.value = st === 'download' ? t('py.loadingCore') : t('py.initRuntime')
        },
        onProgress: ({ loaded, total }) => { coreProgress.value = { loaded, total } },
        // The program called input(): with the stdin Service Worker active the program is now PAUSED
        // until the user types a line in the terminal (NO browser dialog). Focus + highlight the
        // terminal input. (Without the SW, this means a pre-typed line is being consumed.)
        onInput: () => {
          outBatcher.flush(); errBatcher.flush()
          awaitingInput.value = true
          focusStdin()
        },
      }
    )
    outBatcher.flush(); errBatcher.flush()

    figures.value = res.figures || []
    hasApp.value = !!res.hasApp
    appKind.value = res.appKind || ''
    if (res.error) {
      hadError.value = true
      appendChunk(lines, 'err', formatError(res.error))
      showToast(t('py.failed'))
    } else if (res.result?.kind === 'html') {
      htmlOut.value = res.result.data
    } else if (res.result?.kind === 'text' && res.result.data) {
      result.value = res.result
    }
    if (!res.error && !lines.length && !figures.value.length && !htmlOut.value && res.result?.kind === 'none' && !hasApp.value) {
      appendChunk(lines, 'info', t('py.noOutput'))
    }
    // Auto-open the preview ONLY for a fresh app on this run (and only if not dismissed). This is
    // the fix for the auto-popup bug: a run with no app leaves the preview closed.
    if (hasApp.value && !previewDismissed.value) {
      previewVisible.value = true
      panelTab.value = 'preview'
      panelCollapsed.value = false
      await loadPreview()
    } else if (!hasApp.value) {
      previewVisible.value = false
      if (panelTab.value === 'preview') panelTab.value = 'output'
    }
    // Refresh the package list/cache state opportunistically (cheap; reflects micropip installs).
    refreshRuntimeMeta()
  } catch (err) {
    if (err && err.stopped) {
      // The user pressed Stop: the worker was terminated. Show a clear, non-error notice.
      appendChunk(lines, 'info', t('py.stopped'))
    } else {
      hadError.value = true
      appendChunk(lines, 'err', formatError(err))
      showToast(t('py.failed'))
    }
  } finally {
    clearInterval(flushTimer)
    flushTimer = null
    outBatcher?.flush(); errBatcher?.flush()
    busy.value = false
    awaitingInput.value = false
    coreDownloading.value = false
    coreProgress.value = null
    phase.value = ''
  }
}

// Hard-stop a running program: terminate the worker (kills even `while True:`), then show a brief
// "restarting runtime" state — the next run lazily spawns a fresh worker and re-loads Pyodide.
async function stop() {
  const { stopRun } = await import('./pythonRunner')
  const killed = stopRun()
  if (!killed) return
  // The in-flight run() promise rejects with {stopped:true}; its finally clears busy. We also flag
  // a short restarting state so the user understands the runtime must re-init on the next run.
  restarting.value = true
  awaitingInput.value = false
  runtimeReadyFlag.value = false
  setTimeout(() => { restarting.value = false }, 1500)
}

// ---- interactive stdin ------------------------------------------------------------------
function focusStdin() {
  nextTick(() => {
    const el = isNarrow.value ? mStdinInput.value : stdinInput.value
    el?.focus?.()
  })
}

async function submitStdin() {
  const text = stdinText.value
  const { feedStdin } = await import('./pythonRunner')
  feedStdin(text)
  appendChunk(lines, 'in', text + '\n')
  stdinText.value = ''
  awaitingInput.value = false
}

// ---- web preview ------------------------------------------------------------------------
// previewRawHtml holds the body for "open in new window" (without our injected bridge, so the
// detached page is clean); previewHtml is what the sandboxed iframe renders (bridge injected so
// link/form navigation re-routes back to the in-interpreter app).
const previewRawHtml = ref('')
const previewMethod = ref('GET')
const previewFs = ref(false)
const previewPaneEl = ref(null)
const mPreviewPaneEl = ref(null)

async function loadPreview(path, method = 'GET', body = '') {
  if (previewBusy.value) return
  const reqPath = path != null ? path : (previewPath.value || '/')
  previewBusy.value = true
  previewError.value = ''
  try {
    const { callServer } = await import('./pythonRunner')
    const res = await callServer(reqPath, method, body)
    if (res && res.ok) {
      previewPath.value = reqPath
      previewMethod.value = method
      previewStatus.value = res.status || '200 OK'
      previewStatusCode.value = res.statusCode || 200
      previewCtype.value = res.contentType || 'text/html'
      let html
      if (res.isHtml) html = res.body || ''
      else if (res.isJson) html = renderTextDoc(prettyJson(res.body || ''))
      else html = renderTextDoc(res.body || '')
      previewRawHtml.value = html
      // Inject the navigation bridge so links/buttons/forms inside the preview re-route here.
      previewHtml.value = injectPreviewBridge(html)
    } else {
      previewStatus.value = ''
      previewStatusCode.value = 0
      previewHtml.value = ''
      previewRawHtml.value = ''
      previewError.value = res && res.error === 'no-app'
        ? t('py.previewNoApp')
        : (res?.detail || t('py.previewNoApp'))
    }
  } catch (err) {
    previewError.value = (err && err.message) || String(err)
  } finally {
    previewBusy.value = false
  }
}

// Handle a navigation intent posted by the preview iframe's bridge script. Link clicks and form
// submits are resolved (purely) into the next in-interpreter request and re-rendered, so the
// previewed app is actually navigable ("链接和按钮都无法点击" fixed). Only messages tagged by our
// bridge are honoured; cross-origin junk is ignored.
function onPreviewMessage(e) {
  const d = e && e.data
  if (!d || d.__tbPreview !== true) return
  if (d.kind === 'navigate') {
    const { follow, path } = resolveNav(previewPath.value || '/', d.href)
    if (follow) loadPreview(path, 'GET')
  } else if (d.kind === 'submit') {
    const { path, method, body } = resolveForm(previewPath.value || '/', d.action, d.method, d.fields || [])
    loadPreview(path, method, body)
  }
}

// Open the CURRENT rendered preview response in a real new browser tab/window. We write the raw
// body (no bridge) into the new document so it stands alone.
function openPreviewWindow() {
  if (typeof window === 'undefined') return
  const w = window.open('', '_blank')
  if (!w) { showToast(t('py.popupBlocked')); return }
  try {
    w.document.open()
    w.document.write(previewRawHtml.value || '<!doctype html><meta charset=utf-8><p>(empty response)</p>')
    w.document.close()
  } catch { /* cross-origin write guard — ignore */ }
}

// Fullscreen the preview pane via the Fullscreen API (the whole pane, so the address bar + frame
// are included). Toggles off if already fullscreen.
function togglePreviewFullscreen() {
  if (typeof document === 'undefined') return
  const el = isNarrow.value ? mPreviewPaneEl.value : previewPaneEl.value
  if (!el) return
  if (document.fullscreenElement) {
    document.exitFullscreen?.()
  } else {
    el.requestFullscreen?.().catch(() => showToast(t('py.fsFailed')))
  }
}
function onFsChange() {
  previewFs.value = !!(typeof document !== 'undefined' && document.fullscreenElement)
}

function renderTextDoc(s) {
  return `<pre style="white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.55;padding:14px;margin:0;color:#1c1c1e">${escapeHtml(s)}</pre>`
}
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

// Show the preview pane (user opt-in or re-open after dismiss).
function openPreview() {
  previewDismissed.value = false
  previewVisible.value = true
  panelTab.value = 'preview'
  panelCollapsed.value = false
  if (!previewHtml.value && !previewError.value) loadPreview()
}
// Dismiss the preview and keep it dismissed for this run (the bug fix).
function dismissPreview() {
  previewVisible.value = false
  previewDismissed.value = true
  if (panelTab.value === 'preview') panelTab.value = 'output'
}

// ---- packages (micropip — network) ------------------------------------------------------
async function installPkgs() {
  const specs = parsePackages(pkgText.value)
  if (!specs.length || installing.value) return
  installing.value = true
  panelTab.value = 'output'
  panelCollapsed.value = false
  appendChunk(lines, 'info', t('py.installing') + ' ' + specs.join(', '))
  try {
    const { installPackages } = await import('./pythonRunner')
    await installPackages(specs, {
      onStatus: spec => appendChunk(lines, 'info', `micropip: ${spec}`),
    })
    appendChunk(lines, 'info', t('py.installed') + ' ' + specs.join(', '))
    showToast(t('py.installed'))
    persistNow()
    // Reflect the new package(s) in the manager list + cache pill.
    refreshRuntimeMeta()
  } catch (err) {
    hadError.value = true
    appendChunk(lines, 'err', formatError(err))
    showToast(t('py.installFailed'))
  } finally {
    installing.value = false
  }
}

// ---- examples / actions -----------------------------------------------------------------
function loadExample(id) {
  examplesOpen.value = false
  document.removeEventListener('pointerdown', onOutsideExamples, true)
  const ex = EXAMPLE_PROJECTS.find(e => e.id === id)
  if (!ex) return
  const files = {}
  for (const n of Object.keys(ex.files)) files[n] = ex.files[n]
  const active = files[ex.entry] != null ? ex.entry : Object.keys(files)[0]
  project.value = { files, active }
  result.value = { kind: 'none', data: '' }
  // Prefill the packages field only for examples needing a PyPI wheel (fastapi & requests are
  // bundled with Pyodide and auto-load from the CDN, so they don't go in the micropip field).
  if (id === 'packages') pkgText.value = mergePkg(pkgText.value, 'cowsay')
  nextTick(() => {
    cm.value?.setDoc(activeContent(project.value))
    cm.value?.focus()
  })
  persistNow()
}
function mergePkg(text, name) {
  const have = new Set(parsePackages(text).map(s => s.toLowerCase().split(/[<>=!~ ]/)[0]))
  if (have.has(name.toLowerCase())) return text
  return text.trim() ? `${text.trim()}, ${name}` : name
}

function clearOutput() {
  lines.length = 0
  result.value = { kind: 'none', data: '' }
  figures.value = []
  htmlOut.value = ''
  hadError.value = false
}

async function copyActive() {
  try { await navigator.clipboard.writeText(activeContent(project.value)); showToast(t('toast.copied')) } catch {}
}

// ---- panel layout helpers ---------------------------------------------------------------
function toggleExplorer() {
  explorerCollapsed.value = !explorerCollapsed.value
  save('python-explorer-collapsed', explorerCollapsed.value ? '1' : '0')
}
function togglePanel() { panelCollapsed.value = !panelCollapsed.value }

// Drag-to-resize the bottom panel (desktop). Pointer events so it works with mouse + touch.
let dragStartY = 0
let dragStartH = 0
function startPanelDrag(e) {
  if (isNarrow.value) return
  dragStartY = e.clientY
  dragStartH = panelHeight.value
  panelCollapsed.value = false
  window.addEventListener('pointermove', onPanelDrag)
  window.addEventListener('pointerup', endPanelDrag)
  e.preventDefault()
}
function onPanelDrag(e) {
  const dy = dragStartY - e.clientY
  panelHeight.value = clampPanel(dragStartH + dy)
}
function endPanelDrag() {
  window.removeEventListener('pointermove', onPanelDrag)
  window.removeEventListener('pointerup', endPanelDrag)
  save('python-panel-h', String(Math.round(panelHeight.value)))
}

// Responsive: switch to the simple single-column flow at/under 1024px. The previous 900px cutoff
// left a broken hybrid at tablet/narrow-desktop widths (~700–1000px) where the explorer rail + the
// bottom panel fought for room and a panel bled off the right edge (horizontal overflow). Below
// 1024 we use the clean single-column layout (no rail, full-width panel) so there is NO overflow at
// 768/820/900. The desktop workbench only appears with comfortable room (>1024).
const NARROW_MAX = 1024
let mq = null
function syncNarrow() {
  if (typeof window === 'undefined') return
  isNarrow.value = window.innerWidth <= NARROW_MAX
  panelHeight.value = clampPanel(panelHeight.value)
}

let offRuntimeStatus = null
onMounted(() => {
  initEditor()
  syncNarrow()
  if (typeof window !== 'undefined') {
    mq = window.matchMedia(`(max-width: ${NARROW_MAX}px)`)
    mq.addEventListener?.('change', syncNarrow)
    window.addEventListener('resize', syncNarrow)
    // Re-route navigation intents the preview iframe posts (link clicks / form submits).
    window.addEventListener('message', onPreviewMessage)
    document.addEventListener('fullscreenchange', onFsChange)
  }
  // Subscribe to runtime status so the banner reflects download/init/ready/restarting, and register
  // the stdin Service Worker EARLY (before the first run) so input() can block on it.
  import('./pythonRunner').then(({ onRuntimeStatus, registerStdinSW }) => {
    offRuntimeStatus = onRuntimeStatus(({ phase }) => {
      if (phase === 'ready') { runtimeReadyFlag.value = true; restarting.value = false }
      else if (phase === 'stopped') { runtimeReadyFlag.value = false }
    })
    registerStdinSW?.().then((ok) => { stdinBlocking.value = !!ok }).catch(() => {})
  }).catch(() => {})
  // Probe whether the Pyodide runtime is already in the durable cache (so the banner/pill can show
  // "cached — instant" without spawning the worker or downloading anything). Same-origin Cache API.
  probeRuntimeCache()
  // Probe the optional backend so the proxy/Network note reflects availability.
  probeBackend().catch(() => {})
})
onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  persistNow()
  cm.value?.destroy()
  offRuntimeStatus?.()
  if (typeof window !== 'undefined') {
    mq?.removeEventListener?.('change', syncNarrow)
    window.removeEventListener('resize', syncNarrow)
    window.removeEventListener('pointermove', onPanelDrag)
    window.removeEventListener('pointerup', endPanelDrag)
    window.removeEventListener('message', onPreviewMessage)
    document.removeEventListener('pointerdown', onOutsideExamples, true)
    document.removeEventListener('fullscreenchange', onFsChange)
  }
})
</script>

<template>
  <main class="ide" :class="{ 'is-narrow': isNarrow }">
    <!-- Top toolbar -->
    <header class="toolbar">
      <div class="tb-left">
        <span class="tb-logo" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M5 3.5l7 4.5-7 4.5z"/></svg></span>
        <span class="tb-title">{{ t('py.title') }}</span>
      </div>

      <div class="tb-actions">
        <!-- Examples dropdown -->
        <div ref="exWrapEl" class="ex-wrap">
          <button class="tb-btn ghost" type="button" :aria-expanded="examplesOpen" @click="toggleExamples">
            {{ t('py.examples') }} <span class="caret"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6.5 8 10.5 12 6.5"/></svg></span>
          </button>
          <Transition name="pop">
            <div v-if="examplesOpen" class="ex-menu">
              <button
                v-for="ex in examples"
                :key="ex.id"
                class="ex-item"
                type="button"
                @click="loadExample(ex.id)"
              >
                <span class="ex-name">{{ ex.title }}</span>
                <span v-if="ex.needsNetwork" class="net-dot" :title="t('py.networkBadge')"></span>
              </button>
            </div>
          </Transition>
        </div>

        <button class="tb-btn ghost" type="button" :aria-expanded="pkgManagerOpen" @click="togglePkgManager">{{ t('py.packagesManage') }}</button>

        <button class="tb-btn ghost" type="button" @click="copyActive">{{ t('tool.copy') }}</button>

        <!-- Run when idle; while running, a real Stop button that terminates the worker. -->
        <button v-if="!busy" class="tb-btn run" @click="run">
          <span class="run-ico" aria-hidden="true"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 3v10l8-5z"/></svg></span>
          <span>{{ t('py.run') }}</span>
          <kbd class="run-kbd">{{ cmdLabel }}</kbd>
        </button>
        <button v-else class="tb-btn stop" type="button" :title="t('py.stopHint')" @click="stop">
          <span class="stop-ico" aria-hidden="true"><svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1.5"/></svg></span>
          <span>{{ t('py.stop') }}</span>
        </button>
      </div>
    </header>

    <!-- Package & version manager (micropip) -->
    <Transition name="pop">
      <section v-if="pkgManagerOpen" class="pkgmgr">
        <div class="pkgmgr-head">
          <span class="pkgmgr-title">{{ t('py.packagesManage') }}</span>
          <span class="cache-pill" :class="{ on: runtimeCached }">
            <span class="cache-dot" aria-hidden="true"></span>{{ runtimeCached ? t('py.cacheReady') : t('py.cacheWill') }}
          </span>
          <div class="panel-spacer"></div>
          <button class="mini-btn" type="button" :disabled="pkgLoading" @click="refreshRuntimeMeta">{{ t('py.refresh') }}</button>
          <button class="mini-btn icon" type="button" :aria-label="t('py.collapse')" @click="pkgManagerOpen = false">×</button>
        </div>
        <div class="pkgmgr-row">
          <input
            v-model="pkgText" class="pkg-input" type="text" spellcheck="false"
            :placeholder="t('py.packagesPlaceholder')"
            @keydown.enter.prevent="installPkgs"
          />
          <button class="pkg-btn primary" :disabled="installing || !pkgText.trim()" @click="installPkgs">
            {{ installing ? t('py.installing') : t('py.install') }}
          </button>
        </div>
        <p class="pkgmgr-hint">{{ t('py.versionHint') }}</p>
        <div v-if="!runtimeReadyFlag" class="pkgmgr-empty">{{ t('py.pkgRunFirst') }}</div>
        <div v-else-if="pkgLoading && !installedPkgs.length" class="pkgmgr-empty">{{ t('py.loadingPkgs') }}</div>
        <ul v-else-if="installedPkgs.length" class="pkglist">
          <li v-for="p in installedPkgs" :key="p.name" class="pkgrow">
            <span class="pkg-name">{{ p.name }}</span>
            <span class="pkg-ver">{{ p.version }}</span>
            <span v-if="p.source === 'pypi' || p.installer === 'micropip'" class="pkg-src">micropip</span>
            <span class="panel-spacer"></span>
            <button
              v-if="p.installer === 'micropip'"
              class="pkg-x" type="button"
              :aria-label="t('py.uninstall') + ' ' + p.name" :title="t('py.uninstall')"
              @click="uninstallPkg(p.name)"
            >×</button>
          </li>
        </ul>
        <div v-else class="pkgmgr-empty">{{ t('py.noPkgs') }}</div>
      </section>
    </Transition>

    <!-- Restarting-runtime notice (after Stop terminates the worker) -->
    <div v-if="restarting" class="banner restarting">
      <span class="run-spin small" aria-hidden="true"></span>
      <span>{{ t('py.restarting') }}</span>
    </div>

    <!-- First-run runtime download banner -->
    <div v-else-if="!coreReady" class="banner" :class="{ 'banner-progress': coreDownloading }">
      <template v-if="coreDownloading">
        <div class="dl">
          <div class="dl-top">
            <span class="banner-icon" aria-hidden="true">⤓</span>
            <span class="dl-label">{{ progressLabel }}</span>
            <span class="dl-pct">{{ progressPct }}%</span>
          </div>
          <div class="dl-track"><div class="dl-fill" :style="{ width: progressPct + '%' }"></div></div>
        </div>
      </template>
      <template v-else>
        <span class="banner-icon" aria-hidden="true">⤓</span>
        <span>{{ coreLoading ? t('py.loadingCore') : (runtimeCached ? t('py.coreNoticeCached') : t('py.coreNotice')) }}</span>
      </template>
    </div>

    <!-- ============================ DESKTOP WORKBENCH ============================ -->
    <div v-if="!isNarrow" class="wb">
      <!-- File explorer rail -->
      <aside class="explorer" :class="{ collapsed: explorerCollapsed }">
        <div class="explorer-head">
          <button class="explorer-toggle" type="button" :title="explorerCollapsed ? t('py.files') : t('py.collapse')" @click="toggleExplorer">
            <span aria-hidden="true">{{ explorerCollapsed ? '»' : '«' }}</span>
          </button>
          <span v-if="!explorerCollapsed" class="explorer-title">{{ t('py.explorer') }}</span>
          <button v-if="!explorerCollapsed" class="explorer-add" type="button" :title="t('py.newFile')" :aria-label="t('py.newFile')" @click="newFile">+</button>
        </div>
        <div v-if="!explorerCollapsed" class="filelist" role="tablist" :aria-label="t('py.files')">
          <div
            v-for="name in names"
            :key="name"
            class="fileitem"
            :class="{ active: name === activeName }"
            role="tab"
            :aria-selected="name === activeName"
          >
            <template v-if="renaming === name">
              <input
                ref="renameInput"
                v-model="renameText"
                class="rename-input"
                spellcheck="false" autocapitalize="off" autocorrect="off"
                @keydown.enter.prevent="commitRename"
                @keydown.esc.prevent="cancelRename"
                @blur="commitRename"
              />
            </template>
            <template v-else>
              <button class="fileitem-name" type="button" @click="switchTo(name)" @dblclick="beginRename(name)" :title="t('py.renameHint')">
                <span class="file-ico" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5h5l3.5 3.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z"/><path d="M9 1.5V5h3.5"/></svg></span>{{ name }}
              </button>
              <button
                v-if="names.length > 1"
                class="fileitem-x" type="button"
                :aria-label="t('py.deleteFile') + ' ' + name" :title="t('py.deleteFile')"
                @click.stop="removeFile(name)"
              >×</button>
            </template>
          </div>
        </div>
        <!-- Packages live at the bottom of the explorer -->
        <div v-if="!explorerCollapsed" class="explorer-pkg">
          <div class="pkg-head">
            <span class="pkg-label">{{ t('py.packages') }}</span>
            <span class="net-badge">{{ t('py.networkBadge') }}</span>
            <BackendInfo />
          </div>
          <div class="pkg-row">
            <input
              v-model="pkgText" class="pkg-input" type="text" spellcheck="false"
              :placeholder="t('py.packagesPlaceholder')"
              @input="persist" @keydown.enter.prevent="installPkgs"
            />
            <button class="pkg-btn" :disabled="installing || !pkgText.trim()" @click="installPkgs">
              <span v-if="!installing">{{ t('py.install') }}</span>
              <span v-else>{{ t('py.installing') }}</span>
            </button>
          </div>
        </div>
      </aside>

      <!-- Editor + bottom panel column -->
      <section class="main-col">
        <!-- Editor tabs -->
        <div class="tabstrip" role="tablist" :aria-label="t('py.files')">
          <div
            v-for="name in names"
            :key="name"
            class="tab"
            :class="{ active: name === activeName }"
            role="tab"
            :aria-selected="name === activeName"
          >
            <button class="tab-name" type="button" @click="switchTo(name)" @dblclick="beginRename(name)">{{ name }}</button>
            <button
              v-if="names.length > 1"
              class="tab-x" type="button"
              :aria-label="t('py.deleteFile') + ' ' + name" :title="t('py.deleteFile')"
              @click.stop="removeFile(name)"
            >×</button>
          </div>
        </div>

        <!-- Editor -->
        <div class="editor-wrap" :style="{ minHeight: panelCollapsed ? '0' : '120px' }">
          <div ref="editorEl" class="cm-host"></div>
          <!-- thin run-progress strip overlaid at the editor bottom -->
          <div v-if="busy" class="edge-progress">
            <div v-if="coreDownloading" class="edge-fill" :style="{ width: progressPct + '%' }"></div>
            <div v-else class="edge-fill indet"></div>
          </div>
        </div>

        <!-- Resizable drag handle -->
        <div v-show="!panelCollapsed" class="resizer" @pointerdown="startPanelDrag" :title="t('py.dragResize')">
          <span class="resizer-grip" aria-hidden="true"></span>
        </div>

        <!-- Bottom panel: Output | Web preview -->
        <div class="panel" :class="{ collapsed: panelCollapsed }" :style="panelCollapsed ? {} : { height: panelHeight + 'px' }">
          <div class="panel-tabs">
            <button class="ptab" :class="{ active: panelTab === 'output' }" type="button" @click="panelTab = 'output'; panelCollapsed = false">
              {{ t('py.console') }}
              <span v-if="hadError" class="ptab-dot err" aria-hidden="true"></span>
            </button>
            <button
              v-if="previewVisible"
              class="ptab"
              :class="{ active: panelTab === 'preview' }"
              type="button"
              @click="panelTab = 'preview'; panelCollapsed = false"
            >
              {{ t('py.preview') }}
              <span class="ptab-badge">{{ appKind === 'asgi' ? 'ASGI' : 'WSGI' }}</span>
            </button>
            <button v-if="hasApp && !previewVisible" class="ptab open-preview" type="button" @click="openPreview">
              {{ t('py.openPreview') }}
            </button>
            <div class="panel-spacer"></div>
            <button v-if="panelTab === 'output' && hasOutput" class="mini-btn" type="button" @click="clearOutput">{{ t('py.clearOutput') }}</button>
            <button class="mini-btn icon" type="button" :title="panelCollapsed ? t('py.expand') : t('py.collapse')" @click="togglePanel">
              <svg class="pc-caret" :class="{ up: panelCollapsed }" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6.5 8 10.5 12 6.5"/></svg>
            </button>
          </div>

          <div v-show="!panelCollapsed" class="panel-body">
            <!-- OUTPUT TAB -->
            <div v-show="panelTab === 'output'" class="output-scroll">
              <div v-if="!hasOutput" class="output-empty">{{ t('py.outputEmpty') }}</div>
              <div v-if="lines.length" class="console"><span v-for="(ln, i) in lines" :key="i" :class="['ln', 'ln-' + ln.kind]">{{ ln.text }}</span></div>
              <div v-if="result.kind === 'text' && result.data" class="block repr">
                <div class="block-head">{{ t('py.lastValue') }}</div>
                <div class="repr-body">{{ result.data }}</div>
              </div>
              <div v-if="figures.length" class="block figures">
                <div class="block-head">{{ t('py.figures') }}</div>
                <img v-for="(fig, i) in figures" :key="i" class="figure" :src="'data:image/png;base64,' + fig" :alt="t('py.figures') + ' ' + (i + 1)" />
              </div>
              <div v-if="htmlOut" class="block htmlout">
                <div class="block-head">{{ t('py.htmlOutput') }}</div>
                <iframe class="htmlout-frame" sandbox="allow-scripts" :srcdoc="htmlOut" :title="t('py.htmlOutput')"></iframe>
              </div>
            </div>

            <!-- WEB PREVIEW TAB -->
            <div v-show="panelTab === 'preview'" ref="previewPaneEl" class="preview-scroll">
              <div class="preview-bar">
                <span class="addr-method" :class="{ post: previewMethod !== 'GET' }">{{ previewMethod }}</span>
                <input v-model="previewPath" class="preview-path" type="text" spellcheck="false" :placeholder="t('py.previewPath')" @keydown.enter.prevent="loadPreview(previewPath, 'GET')" />
                <button class="preview-go" type="button" :disabled="previewBusy" @click="loadPreview(previewPath, 'GET')">{{ t('py.previewGo') }}</button>
                <span v-if="previewStatus" class="preview-status" :class="{ ok: previewStatusCode < 400, bad: previewStatusCode >= 400 }">{{ previewStatus }}</span>
                <button class="preview-icon-btn" type="button" :disabled="!previewRawHtml" :title="t('py.openInWindow')" :aria-label="t('py.openInWindow')" @click="openPreviewWindow">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5H3.5v9h9v-3"/><path d="M9.5 3.5h3v3"/><path d="M12.5 3.5l-5 5"/></svg>
                </button>
                <button class="preview-icon-btn" type="button" :disabled="!previewHtml" :title="previewFs ? t('py.exitFullscreen') : t('py.fullscreen')" :aria-label="previewFs ? t('py.exitFullscreen') : t('py.fullscreen')" @click="togglePreviewFullscreen">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"/></svg>
                </button>
                <button class="preview-close" type="button" :title="t('py.dismissPreview')" :aria-label="t('py.dismissPreview')" @click="dismissPreview">×</button>
              </div>
              <p class="preview-hint">{{ t('py.previewHint') }}</p>
              <p v-if="previewError" class="preview-error">{{ previewError }}</p>
              <iframe
                v-else-if="previewHtml"
                class="preview-frame"
                sandbox="allow-scripts allow-forms allow-popups"
                :srcdoc="previewHtml"
                :title="t('py.preview')"
              ></iframe>
              <div v-else class="preview-empty">{{ t('py.previewEmpty') }}</div>
            </div>
          </div>
        </div>

        <!-- stdin console box (always available). Highlights when a program is awaiting input(). -->
        <div class="stdin" :class="{ awaiting: awaitingInput }">
          <span class="stdin-caret" aria-hidden="true">{{ awaitingInput ? '⌶' : '›' }}</span>
          <input
            ref="stdinInput" v-model="stdinText" class="stdin-input" type="text"
            spellcheck="false" autocomplete="off"
            :placeholder="awaitingInput ? t('py.waitingInput') : t('py.stdinPlaceholder')"
            @keydown.enter.prevent="submitStdin"
          />
          <button class="stdin-send" type="button" @click="submitStdin">{{ t('py.stdinSend') }}</button>
        </div>
      </section>
    </div>

    <!-- ============================ MOBILE FLOW ============================ -->
    <div v-else class="mobile">
      <!-- File chips -->
      <div class="m-files" role="tablist" :aria-label="t('py.files')">
        <button
          v-for="name in names"
          :key="name"
          class="m-chip"
          :class="{ active: name === activeName }"
          type="button"
          role="tab"
          :aria-selected="name === activeName"
          @click="switchTo(name)"
          @dblclick="beginRename(name)"
        >{{ name }}</button>
        <button class="m-chip add" type="button" :aria-label="t('py.newFile')" @click="newFile">+</button>
      </div>

      <!-- rename input surfaces inline above the editor on mobile -->
      <div v-if="renaming" class="m-rename">
        <input
          ref="renameInput" v-model="renameText" class="rename-input wide"
          spellcheck="false" autocapitalize="off" autocorrect="off"
          @keydown.enter.prevent="commitRename" @keydown.esc.prevent="cancelRename" @blur="commitRename"
        />
        <button v-if="names.length > 1" class="m-del" type="button" @click="removeFile(renaming)">{{ t('py.deleteFile') }}</button>
      </div>

      <!-- Editor -->
      <div class="m-editor">
        <div ref="editorEl" class="cm-host"></div>
      </div>

      <!-- Big Run button; while running it becomes a Stop button (terminates the worker). -->
      <div class="m-runrow">
        <button v-if="!busy" class="m-run" @click="run">
          <span class="m-run-lbl"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.5 3v10l8-5z"/></svg>{{ t('py.run') }}</span>
        </button>
        <button v-else class="m-run stop" type="button" @click="stop">
          <span class="m-run-lbl"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5"/></svg>{{ t('py.stop') }} · {{ phase || t('py.running') }}</span>
        </button>
      </div>
      <div v-if="busy" class="m-progress">
        <div class="bar"><div v-if="coreDownloading" class="bar-fill" :style="{ width: progressPct + '%' }"></div><div v-else class="bar-fill indet"></div></div>
        <span class="m-progress-label">{{ coreDownloading ? progressLabel : (phase || t('py.running')) }}</span>
      </div>

      <!-- Packages -->
      <details class="m-pkg">
        <summary>
          <span>{{ t('py.packages') }}</span>
          <span class="net-badge">{{ t('py.networkBadge') }}</span>
        </summary>
        <div class="pkg-row">
          <input v-model="pkgText" class="pkg-input" type="text" spellcheck="false" :placeholder="t('py.packagesPlaceholder')" @input="persist" @keydown.enter.prevent="installPkgs" />
          <button class="pkg-btn" :disabled="installing || !pkgText.trim()" @click="installPkgs">{{ installing ? t('py.installing') : t('py.install') }}</button>
        </div>
        <p class="pkg-note">{{ t('py.packagesNote') }}</p>
      </details>

      <!-- Output -->
      <section class="m-output">
        <div class="m-output-head">
          <span class="m-output-title">{{ t('py.console') }}</span>
          <button v-if="hasOutput" class="mini-btn" type="button" @click="clearOutput">{{ t('py.clearOutput') }}</button>
        </div>
        <div class="m-output-body">
          <div v-if="!hasOutput && !hasApp" class="output-empty">{{ t('py.outputEmpty') }}</div>
          <div v-if="lines.length" class="console"><span v-for="(ln, i) in lines" :key="i" :class="['ln', 'ln-' + ln.kind]">{{ ln.text }}</span></div>
          <div v-if="result.kind === 'text' && result.data" class="block repr">
            <div class="block-head">{{ t('py.lastValue') }}</div>
            <div class="repr-body">{{ result.data }}</div>
          </div>
          <div v-if="figures.length" class="block figures">
            <div class="block-head">{{ t('py.figures') }}</div>
            <img v-for="(fig, i) in figures" :key="i" class="figure" :src="'data:image/png;base64,' + fig" :alt="t('py.figures') + ' ' + (i + 1)" />
          </div>
          <div v-if="htmlOut" class="block htmlout">
            <div class="block-head">{{ t('py.htmlOutput') }}</div>
            <iframe class="htmlout-frame" sandbox="allow-scripts" :srcdoc="htmlOut" :title="t('py.htmlOutput')"></iframe>
          </div>
        </div>
        <!-- stdin -->
        <div class="stdin" :class="{ awaiting: awaitingInput }">
          <span class="stdin-caret" aria-hidden="true">{{ awaitingInput ? '⌶' : '›' }}</span>
          <input ref="mStdinInput" v-model="stdinText" class="stdin-input" type="text" spellcheck="false" autocomplete="off"
            :placeholder="awaitingInput ? t('py.waitingInput') : t('py.stdinPlaceholder')" @keydown.enter.prevent="submitStdin" />
          <button class="stdin-send" type="button" @click="submitStdin">{{ t('py.stdinSend') }}</button>
        </div>
      </section>

      <!-- Web preview (collapsible) -->
      <section v-if="previewVisible" ref="mPreviewPaneEl" class="m-preview">
        <div class="m-preview-head">
          <span class="m-output-title">{{ t('py.preview') }}</span>
          <span class="ptab-badge">{{ appKind === 'asgi' ? 'ASGI' : 'WSGI' }}</span>
          <span v-if="previewStatus" class="preview-status" :class="{ ok: previewStatusCode < 400, bad: previewStatusCode >= 400 }">{{ previewStatus }}</span>
          <span class="panel-spacer"></span>
          <button class="preview-icon-btn" type="button" :disabled="!previewRawHtml" :title="t('py.openInWindow')" :aria-label="t('py.openInWindow')" @click="openPreviewWindow">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5H3.5v9h9v-3"/><path d="M9.5 3.5h3v3"/><path d="M12.5 3.5l-5 5"/></svg>
          </button>
          <button class="preview-icon-btn" type="button" :disabled="!previewHtml" :title="previewFs ? t('py.exitFullscreen') : t('py.fullscreen')" :aria-label="previewFs ? t('py.exitFullscreen') : t('py.fullscreen')" @click="togglePreviewFullscreen">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"/></svg>
          </button>
          <button class="preview-close" type="button" :aria-label="t('py.dismissPreview')" @click="dismissPreview">×</button>
        </div>
        <div class="preview-bar">
          <span class="addr-method" :class="{ post: previewMethod !== 'GET' }">{{ previewMethod }}</span>
          <input v-model="previewPath" class="preview-path" type="text" spellcheck="false" :placeholder="t('py.previewPath')" @keydown.enter.prevent="loadPreview(previewPath, 'GET')" />
          <button class="preview-go" type="button" :disabled="previewBusy" @click="loadPreview(previewPath, 'GET')">{{ t('py.previewGo') }}</button>
        </div>
        <p v-if="previewError" class="preview-error">{{ previewError }}</p>
        <iframe v-else-if="previewHtml" class="preview-frame" sandbox="allow-scripts allow-forms allow-popups" :srcdoc="previewHtml" :title="t('py.preview')"></iframe>
      </section>
      <button v-else-if="hasApp" class="m-open-preview" type="button" @click="openPreview">{{ t('py.openPreview') }}</button>
    </div>
  </main>
</template>

<style scoped>
.ide {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
  width: 100%; max-width: 1320px; margin: 0 auto; padding: 12px 14px 14px;
  animation: tbIn 0.3s var(--ease-out);
  min-width: 0; overflow-x: hidden;   /* never let an inner panel cause horizontal overflow */
}
@keyframes tbIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

/* ---------- Top toolbar ---------- */
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 2px 10px; }
.tb-left { display: flex; align-items: center; gap: 9px; min-width: 0; }
.tb-logo { color: var(--accent); display: inline-flex; }
.tb-logo svg { width: 15px; height: 15px; }
.tb-title { font-size: 15px; font-weight: 700; letter-spacing: -0.3px; white-space: nowrap; }
.tb-actions { display: flex; align-items: center; gap: 8px; }
.tb-btn { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-sans); cursor: pointer; border-radius: 9px; font-size: 12.5px; transition: all 0.15s; }
.tb-btn.ghost { padding: 7px 12px; border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary); }
.tb-btn.ghost:hover { color: var(--text); background: var(--surface-hover); border-color: var(--text-tertiary); }
.caret { opacity: 0.7; display: inline-flex; }
.caret svg { width: 9px; height: 9px; }
.pc-caret { width: 13px; height: 13px; transition: transform 0.15s; }
.pc-caret.up { transform: rotate(180deg); }
/* Run = the primary build/run action → dark fill (gold is reserved for download/confirm CTAs). */
.tb-btn.run { padding: 8px 15px; border: none; background: var(--text); color: var(--bg); font-weight: 650; }
.tb-btn.run:hover:not(:disabled) { opacity: 0.9; }
.tb-btn.run:active:not(:disabled) { transform: scale(0.98); }
.tb-btn.run:disabled { opacity: 0.7; cursor: default; }
.run-ico { display: inline-flex; }
.run-ico svg { width: 10px; height: 10px; }
.m-run-lbl { display: inline-flex; align-items: center; gap: 7px; }
.m-run-lbl svg { width: 13px; height: 13px; }
.run-kbd { font-family: var(--font-mono); font-size: 10px; padding: 1px 5px; border-radius: 5px; background: rgba(255,255,255,0.18); color: inherit; border: none; }
.run-spin { width: 12px; height: 12px; border: 2px solid color-mix(in srgb, var(--accent-text) 35%, transparent); border-top-color: var(--accent-text); border-radius: 50%; animation: tb-spin 0.7s linear infinite; }
.run-spin.small { width: 13px; height: 13px; border-color: color-mix(in srgb, var(--accent) 30%, transparent); border-top-color: var(--accent); }
/* Stop button — danger-tinted, replaces Run while a program is executing. */
.tb-btn.stop { padding: 8px 15px; border: none; background: var(--danger, #e5484d); color: #fff; font-weight: 650; }
.tb-btn.stop:hover { filter: brightness(1.06); }
.tb-btn.stop:active { transform: scale(0.98); }
.stop-ico { display: inline-flex; }
.stop-ico svg { width: 11px; height: 11px; }

/* Examples dropdown */
.ex-wrap { position: relative; }
.ex-menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 60; min-width: 240px; background: var(--surface); border: 1px solid var(--border-light); border-radius: 12px; box-shadow: var(--shadow-lg); padding: 6px; }
.ex-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; text-align: left; padding: 8px 10px; border: none; background: transparent; color: var(--text); font-size: 12.5px; font-family: var(--font-sans); border-radius: 8px; cursor: pointer; }
.ex-item:hover { background: var(--surface-hover); }
.ex-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.net-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); flex: 0 0 auto; }
.pop-enter-active, .pop-leave-active { transition: opacity 0.14s, transform 0.14s; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translateY(-6px) scale(0.98); }

/* ---------- First-run banner ---------- */
.banner { display: flex; align-items: center; gap: 9px; font-size: 12px; line-height: 1.45; color: var(--text-secondary); background: var(--accent-bg); border: 1px solid var(--border-light); border-radius: 10px; padding: 9px 12px; margin-bottom: 10px; }
.banner-icon { color: var(--accent); font-weight: 700; font-size: 14px; }
.banner-progress { display: block; }
.dl { width: 100%; }
.dl-top { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.dl-label { flex: 1; font-size: 12px; color: var(--text-secondary); }
.dl-pct { font-size: 12px; font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
.dl-track { height: 7px; border-radius: 99px; background: var(--surface-active); overflow: hidden; }
.dl-fill { height: 100%; background: var(--accent); border-radius: 99px; transition: width 0.18s var(--ease-out); }
.banner.restarting { color: var(--text); }

/* ---------- Package & version manager ---------- */
.pkgmgr { border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); padding: 12px 14px; margin-bottom: 10px; }
.pkgmgr-head { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
.pkgmgr-title { font-size: 12.5px; font-weight: 700; color: var(--text); }
.cache-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 600; color: var(--text-tertiary); background: var(--surface-active); border-radius: 99px; padding: 3px 8px; }
.cache-pill.on { color: var(--status-ok, #34c759); background: var(--status-ok-bg, rgba(52,199,89,0.1)); }
.cache-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pkgmgr-row { display: flex; gap: 8px; }
.pkgmgr-row .pkg-input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 12.5px; font-family: var(--font-mono); outline: none; }
.pkgmgr-row .pkg-input:focus { border-color: var(--accent); }
.pkg-btn.primary { flex-shrink: 0; padding: 8px 14px; border: none; border-radius: 8px; background: var(--accent); color: var(--accent-text); font-size: 12px; font-weight: 650; font-family: var(--font-sans); cursor: pointer; }
.pkg-btn.primary:disabled { opacity: 0.55; cursor: default; }
.pkgmgr-hint { font-size: 10.5px; line-height: 1.5; color: var(--text-tertiary); margin: 8px 0 0; }
.pkgmgr-empty { font-size: 11.5px; color: var(--text-tertiary); font-style: italic; padding: 10px 2px 2px; }
.pkglist { list-style: none; margin: 10px 0 0; padding: 0; max-height: 240px; overflow: auto; border-top: 1px solid var(--border-light); }
.pkgrow { display: flex; align-items: center; gap: 9px; padding: 7px 2px; border-bottom: 1px solid var(--border-light); }
.pkg-name { font-family: var(--font-mono); font-size: 12px; color: var(--text); }
.pkg-ver { font-family: var(--font-mono); font-size: 11px; color: var(--accent); }
.pkg-src { font-size: 9px; font-weight: 700; letter-spacing: 0.3px; color: var(--accent-text); background: var(--accent); border-radius: 99px; padding: 1px 6px; }
.pkg-x { flex: 0 0 auto; border: none; background: transparent; color: var(--text-tertiary); font-size: 16px; line-height: 1; width: 24px; height: 24px; border-radius: 6px; cursor: pointer; }
.pkg-x:hover { background: rgba(229,72,77,0.1); color: var(--danger, #e5484d); }

/* ======================= DESKTOP WORKBENCH ======================= */
.wb { flex: 1; min-height: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; }

/* File explorer */
.explorer { display: flex; flex-direction: column; width: 240px; min-height: 0; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); overflow: hidden; transition: width 0.18s var(--ease-out); }
.explorer.collapsed { width: 42px; }
.explorer-head { display: flex; align-items: center; gap: 6px; padding: 8px 8px; border-bottom: 1px solid var(--border-light); background: var(--surface-hover); }
.explorer-toggle { flex: 0 0 auto; width: 26px; height: 26px; border: none; border-radius: 7px; background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 13px; }
.explorer-toggle:hover { background: var(--surface-active); color: var(--text); }
.explorer-title { flex: 1; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: var(--text-tertiary); }
.explorer-add { flex: 0 0 auto; width: 24px; height: 24px; border: none; border-radius: 6px; background: transparent; color: var(--text-secondary); font-size: 17px; line-height: 1; cursor: pointer; }
.explorer-add:hover { background: var(--surface-active); color: var(--text); }
.filelist { flex: 1; min-height: 0; overflow: auto; padding: 6px; }
.fileitem { display: flex; align-items: center; border-radius: 8px; }
.fileitem.active { background: var(--accent-bg); }
.fileitem-name { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; border: none; background: transparent; color: var(--text-secondary); font-family: var(--font-mono); font-size: 12px; padding: 7px 8px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.fileitem.active .fileitem-name { color: var(--text); font-weight: 600; }
.fileitem-name:hover { color: var(--text); }
.file-ico { font-size: 11px; flex: 0 0 auto; }
.fileitem-x { flex: 0 0 auto; border: none; background: transparent; color: var(--text-tertiary); font-size: 15px; width: 22px; height: 22px; border-radius: 5px; cursor: pointer; margin-right: 4px; }
.fileitem-x:hover { background: var(--surface-active); color: var(--text); }
.rename-input { width: 100%; border: 1px solid var(--accent); border-radius: 6px; background: var(--bg); color: var(--text); font-family: var(--font-mono); font-size: 12px; padding: 6px 7px; margin: 1px 0; outline: none; }
.rename-input.wide { width: 100%; }

.explorer-pkg { border-top: 1px solid var(--border-light); padding: 10px; background: var(--surface-hover); }
.pkg-head { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.pkg-label { font-size: 11.5px; font-weight: 650; color: var(--text); }
.net-badge { font-size: 9.5px; font-weight: 600; color: var(--accent); background: var(--accent-bg); border-radius: 99px; padding: 2px 7px; }
.pkg-row { display: flex; gap: 7px; margin-top: 8px; }
.pkg-input { flex: 1; min-width: 0; padding: 7px 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 12px; font-family: var(--font-mono); outline: none; }
.pkg-input:focus { border-color: var(--accent); }
.pkg-btn { flex-shrink: 0; padding: 7px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 11.5px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; }
.pkg-btn:hover:not(:disabled) { border-color: var(--text-tertiary); }
.pkg-btn:disabled { opacity: 0.5; cursor: default; }
.pkg-note { font-size: 10.5px; line-height: 1.5; color: var(--text-tertiary); margin-top: 7px; }

/* Main column (editor + panel) */
.main-col { display: flex; flex-direction: column; min-width: 0; min-height: 0; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); overflow: hidden; }
.tabstrip { display: flex; align-items: stretch; gap: 1px; padding: 6px 6px 0; border-bottom: 1px solid var(--border-light); background: var(--surface-hover); overflow-x: auto; }
.tabstrip::-webkit-scrollbar { height: 0; }
.tab { display: inline-flex; align-items: center; gap: 1px; border: 1px solid transparent; border-bottom: none; border-radius: 8px 8px 0 0; position: relative; top: 1px; flex: 0 0 auto; }
.tab.active { background: var(--surface); border-color: var(--border-light); }
.tab-name { border: none; background: transparent; color: var(--text-secondary); font-family: var(--font-mono); font-size: 12px; padding: 8px 10px; cursor: pointer; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab.active .tab-name { color: var(--text); font-weight: 600; }
.tab-name:hover { color: var(--text); }
.tab-x { border: none; background: transparent; color: var(--text-tertiary); font-size: 14px; width: 18px; height: 18px; border-radius: 5px; cursor: pointer; margin-right: 4px; }
.tab-x:hover { background: var(--surface-active); color: var(--text); }

.editor-wrap { flex: 1; min-height: 0; position: relative; }
.cm-host { position: absolute; inset: 0; overflow: hidden; }
.cm-host :deep(.cm-editor) { height: 100%; }
.cm-host :deep(.cm-editor.cm-focused) { outline: none; }
.edge-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--surface-active); overflow: hidden; }
.edge-fill { height: 100%; background: var(--accent); }
.edge-fill.indet { width: 35%; animation: indet 1.1s var(--ease-out) infinite; }
@keyframes indet { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }

/* Resizer */
.resizer { height: 8px; cursor: ns-resize; display: flex; align-items: center; justify-content: center; background: var(--surface-hover); border-top: 1px solid var(--border-light); }
.resizer:hover { background: var(--surface-active); }
.resizer-grip { width: 36px; height: 3px; border-radius: 99px; background: var(--text-tertiary); opacity: 0.5; }
.resizer:hover .resizer-grip { opacity: 0.9; }

/* Bottom panel */
.panel { display: flex; flex-direction: column; min-height: 0; border-top: 1px solid var(--border-light); background: var(--surface); }
.panel.collapsed { height: auto !important; }
.panel-tabs { display: flex; align-items: center; gap: 2px; padding: 5px 8px; background: var(--surface-hover); border-bottom: 1px solid var(--border-light); }
.ptab { position: relative; border: none; background: transparent; color: var(--text-secondary); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; padding: 5px 10px; border-radius: 7px; cursor: pointer; font-family: var(--font-sans); display: inline-flex; align-items: center; gap: 6px; }
.ptab:hover { color: var(--text); background: var(--surface-active); }
.ptab.active { color: var(--text); background: var(--surface-active); }
.ptab.open-preview { color: var(--accent); }
.ptab-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.ptab-dot.err { background: var(--danger, #e5484d); }
.ptab-badge { font-size: 8.5px; font-weight: 700; letter-spacing: 0.4px; color: var(--accent-text); background: var(--accent); border-radius: 99px; padding: 1px 6px; }
.panel-spacer { flex: 1; }
.mini-btn { border: none; background: var(--surface-active); color: var(--text-secondary); font-size: 11px; padding: 4px 9px; border-radius: 6px; cursor: pointer; font-family: var(--font-sans); }
.mini-btn:hover { color: var(--text); }
.mini-btn.icon { padding: 4px 8px; font-size: 12px; }
.panel-body { flex: 1; min-height: 0; display: flex; }
.output-scroll, .preview-scroll { flex: 1; min-width: 0; min-height: 0; overflow: auto; }
.output-scroll { padding: 12px 14px; }

/* console + blocks (shared desktop+mobile) */
.output-empty { color: var(--text-tertiary); font-size: 12.5px; font-style: italic; padding: 8px 0; }
.console { margin: 0 0 4px; font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6; color: var(--text); white-space: pre-wrap; word-break: break-word; tab-size: 4; }
.ln { display: inline; white-space: pre-wrap; }
.ln-err { color: var(--danger, #e5484d); }
.ln-info { color: var(--text-tertiary); font-style: italic; }
.ln-in { color: var(--accent); }
.block { margin-top: 14px; border: 1px solid var(--border-light); border-radius: 10px; overflow: hidden; background: var(--bg); animation: tbIn 0.25s var(--ease-out); }
.block-head { padding: 6px 11px; font-size: 10.5px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border-light); background: var(--surface-hover); }
.repr-body { margin: 0; padding: 11px 13px; font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6; color: var(--accent); white-space: pre-wrap; word-break: break-word; }
.figures { padding-bottom: 11px; }
.figure { display: block; max-width: 100%; height: auto; margin: 11px 13px 0; border-radius: 8px; border: 1px solid var(--border-light); background: #fff; }
.htmlout-frame { width: 100%; min-height: 220px; border: 0; background: #fff; display: block; }

/* Web preview */
.preview-scroll { display: flex; flex-direction: column; background: var(--bg); }
.preview-bar { display: flex; align-items: center; gap: 7px; padding: 9px 11px; border-bottom: 1px solid var(--border-light); background: var(--surface-hover); }
.addr-method { font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; color: var(--accent); background: var(--accent-bg); border-radius: 6px; padding: 4px 7px; flex: 0 0 auto; }
.addr-method.post { color: var(--accent-text); background: var(--accent); }
.preview-icon-btn { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--text-secondary); cursor: pointer; }
.preview-icon-btn:hover:not(:disabled) { color: var(--text); border-color: var(--text-tertiary); }
.preview-icon-btn:disabled { opacity: 0.4; cursor: default; }
.preview-icon-btn svg { width: 14px; height: 14px; }
.preview-path { flex: 1; min-width: 0; padding: 6px 9px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text); font-size: 12px; font-family: var(--font-mono); outline: none; }
.preview-path:focus { border-color: var(--accent); }
.preview-go { flex-shrink: 0; padding: 6px 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--text); font-size: 12px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; }
.preview-go:hover:not(:disabled) { border-color: var(--text-tertiary); }
.preview-go:disabled { opacity: 0.5; cursor: default; }
.preview-status { font-size: 10.5px; font-weight: 700; font-variant-numeric: tabular-nums; padding: 3px 7px; border-radius: 6px; flex: 0 0 auto; }
.preview-status.ok { color: var(--status-ok, #34c759); background: var(--status-ok-bg, rgba(52,199,89,0.1)); }
.preview-status.bad { color: var(--danger, #e5484d); background: rgba(229,72,77,0.1); }
.preview-close { flex: 0 0 auto; border: none; background: transparent; color: var(--text-tertiary); font-size: 18px; line-height: 1; width: 26px; height: 26px; border-radius: 6px; cursor: pointer; }
.preview-close:hover { background: var(--surface-active); color: var(--text); }
.preview-hint { font-size: 10.5px; line-height: 1.5; color: var(--text-tertiary); margin: 8px 12px 0; }
.preview-error { font-size: 11.5px; line-height: 1.5; color: var(--danger, #e5484d); margin: 10px 12px; white-space: pre-wrap; font-family: var(--font-mono); }
.preview-frame { flex: 1; width: 100%; min-height: 220px; border: 0; background: #fff; display: block; margin-top: 8px; }
.preview-empty { color: var(--text-tertiary); font-size: 12.5px; font-style: italic; padding: 18px 14px; }

/* stdin */
.stdin { display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--border-light); background: var(--surface-hover); padding: 8px 12px; transition: background 0.18s; }
.stdin.awaiting { background: var(--accent-bg); box-shadow: inset 0 0 0 1px var(--accent); }
.stdin.awaiting .stdin-input { border-color: var(--accent); }
.stdin-caret { color: var(--accent); font-family: var(--font-mono); font-weight: 700; font-size: 13px; flex: 0 0 auto; }
.stdin-input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 12.5px; font-family: var(--font-mono); outline: none; }
.stdin-input:focus { border-color: var(--accent); }
.stdin-send { flex-shrink: 0; padding: 8px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 12px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; }
.stdin-send:hover { border-color: var(--text-tertiary); }

/* ======================= MOBILE FLOW ======================= */
.mobile { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: 8px; }
.m-files { display: flex; gap: 7px; overflow-x: auto; padding: 2px 0 4px; -webkit-overflow-scrolling: touch; }
.m-files::-webkit-scrollbar { height: 0; }
.m-chip { flex: 0 0 auto; padding: 9px 14px; border: 1px solid var(--border); border-radius: 99px; background: var(--surface); color: var(--text-secondary); font-family: var(--font-mono); font-size: 13px; cursor: pointer; min-height: 38px; }
.m-chip.active { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 600; }
.m-chip.add { font-size: 18px; padding: 9px 16px; color: var(--text-secondary); }
.m-rename { display: flex; gap: 8px; align-items: center; }
.m-del { flex: 0 0 auto; padding: 9px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); color: var(--danger, #e5484d); font-size: 12.5px; cursor: pointer; }

.m-editor { border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); overflow: hidden; height: 46vh; min-height: 280px; }
.m-editor .cm-host { position: relative; height: 100%; }

.m-runrow { display: flex; }
.m-run { width: 100%; padding: 15px; border: none; border-radius: 12px; background: var(--text); color: var(--bg); font-size: 16px; font-weight: 700; font-family: var(--font-sans); cursor: pointer; min-height: 52px; }
.m-run:disabled { opacity: 0.7; cursor: default; }
.m-run:active:not(:disabled) { transform: scale(0.99); }
.m-run.stop { background: var(--danger, #e5484d); color: #fff; }
.m-progress { display: flex; flex-direction: column; gap: 6px; }
.m-progress .bar { height: 6px; border-radius: 99px; background: var(--surface-active); overflow: hidden; }
.m-progress .bar-fill { height: 100%; background: var(--accent); border-radius: 99px; }
.m-progress .bar-fill.indet { width: 35%; animation: indet 1.1s var(--ease-out) infinite; }
.m-progress-label { font-size: 11.5px; color: var(--text-secondary); }

.m-pkg { border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); padding: 12px 14px; }
.m-pkg > summary { display: flex; align-items: center; gap: 9px; cursor: pointer; font-size: 13.5px; font-weight: 600; color: var(--text); list-style: none; }
.m-pkg > summary::-webkit-details-marker { display: none; }
.m-pkg > summary::before { content: ''; display: inline-block; width: 0; height: 0; border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-left: 5px solid var(--text-tertiary); transition: transform 0.15s; }
.m-pkg[open] > summary::before { transform: rotate(90deg); }
.m-pkg .pkg-row { margin-top: 12px; }
.m-pkg .pkg-input { padding: 11px 12px; font-size: 14px; min-height: 44px; }
.m-pkg .pkg-btn { padding: 11px 16px; font-size: 13px; min-height: 44px; }

.m-output { border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); overflow: hidden; display: flex; flex-direction: column; }
.m-output-head, .m-preview-head { display: flex; align-items: center; gap: 9px; padding: 11px 14px; border-bottom: 1px solid var(--border-light); background: var(--surface-hover); }
.m-output-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); }
.m-preview-head .preview-status { margin-left: 0; }
.m-preview-head .preview-close { margin-left: auto; }
.m-output-body { padding: 13px 14px; min-height: 110px; max-height: 50vh; overflow: auto; }

.m-preview { border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); overflow: hidden; display: flex; flex-direction: column; }
.m-preview .preview-frame { min-height: 300px; }
.m-open-preview { width: 100%; padding: 13px; border: 1px dashed var(--accent); border-radius: 12px; background: var(--accent-bg); color: var(--accent); font-size: 13.5px; font-weight: 650; cursor: pointer; min-height: 48px; }
.m-pkg .pkg-note { font-size: 11px; line-height: 1.5; color: var(--text-tertiary); margin-top: 9px; }

/* Phones: nudge the toolbar/stdin buttons to a comfortable tap height. */
@media (max-width: 768px) {
  .tb-btn.ghost { padding: 9px 12px; }
  .tb-btn.run, .tb-btn.stop { padding: 9px 15px; }
  .stdin-send { padding: 10px 14px; }
}
</style>
