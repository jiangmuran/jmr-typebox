<script setup>
// Multi-file Python mini-IDE. Rendered ONLY inside <ClientOnly>, so it is safe to touch
// window/document/CodeMirror/pyodide here. Pure logic (file model, console model, examples,
// package parsing) is imported from ./fileModel + ./pythonHelpers; CodeMirror is set up via
// ./cmEditor and the wasm runtime is lazy-loaded from ./pythonRunner on first run. Nothing
// heavy is touched at module top level or in synchronous setup beyond reading localStorage.
import { ref, computed, reactive, shallowRef, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { useSettings } from '../../composables/useSettings'
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
import {
  FILES_STORAGE_KEY,
  createDefaultProject,
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
const { resolvedTheme } = useSettings()

// ---- file project state -----------------------------------------------------------------
// Migrate the legacy single-file draft (python-code) into main.py on first load if no file-set
// has been saved yet, so returning users keep their code.
const project = ref(deserializeProject(load(FILES_STORAGE_KEY), load(STORAGE_KEYS.code)))
const names = computed(() => fileNames(project.value))
const activeName = computed(() => project.value.active)

const pkgText = ref(load(STORAGE_KEYS.packages) ?? '')

// ---- editor (CodeMirror) ----------------------------------------------------------------
const editorEl = ref(null)
const cm = shallowRef(null)          // editor handle from cmEditor.createEditor
const editorReady = ref(false)

// ---- run / output state -----------------------------------------------------------------
const lines = reactive([])           // console-line model (see pythonHelpers.appendChunk)
const result = ref({ kind: 'none', data: '' })  // last-expression rich repr
const figures = ref([])              // base64 PNG data from matplotlib
const htmlOut = ref('')              // sandboxed HTML output (from _repr_html_)
const busy = ref(false)
const phase = ref('')                // localized status under the Run button
const installing = ref(false)
const hadError = ref(false)

// Pyodide load state for the first-run banner.
const coreLoading = computed(() => libLoadState.pyodide === 'loading')
const coreReady = computed(() => libLoadState.pyodide === 'ready')

const examples = computed(() =>
  EXAMPLE_PROJECTS.map(e => ({ id: e.id, title: e.title[locale.value] || e.title.en, needsNetwork: e.needsNetwork }))
)

const hasOutput = computed(() =>
  lines.length > 0 || figures.value.length > 0 || !!htmlOut.value || (result.value.kind === 'text' && !!result.value.data)
)

const cmdLabel = computed(() =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘↵' : 'Ctrl+↵'
)

// ---- inline rename state ----------------------------------------------------------------
const renaming = ref(null)           // filename currently being renamed (or null)
const renameText = ref('')
const renameInput = ref(null)

// ---- persistence (debounced) ------------------------------------------------------------
let saveTimer = null
function persist() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    save(FILES_STORAGE_KEY, serializeProject(project.value))
    save(STORAGE_KEYS.packages, pkgText.value)
  }, 400)
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
      // Mirror the editor doc into the active file in our model, then persist (debounced).
      project.value = setContent(project.value, activeName.value, doc)
      persist()
    },
    onRun: () => run(),
  })
  editorReady.value = true
}

// Switch the editor document when the active file changes (tab click / add / delete / example).
watch(activeName, () => {
  if (cm.value) cm.value.setDoc(activeContent(project.value))
})

// Keep CodeMirror in sync with the app theme.
watch(resolvedTheme, (theme) => {
  cm.value?.setDark(theme === 'dark')
})

// ---- file tab actions -------------------------------------------------------------------
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
  // Jump straight into renaming the freshly-created file.
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
    const el = renameInput.value
    if (el) {
      el.focus()
      // Select the stem (before .py) for quick editing.
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

function cancelRename() {
  renaming.value = null
}

// ---- run --------------------------------------------------------------------------------
async function run() {
  if (busy.value) return
  busy.value = true
  hadError.value = false
  lines.length = 0
  result.value = { kind: 'none', data: '' }
  figures.value = []
  htmlOut.value = ''
  phase.value = coreReady.value ? t('py.running') : t('py.loadingCore')

  // Batch stdout/stderr so chatty loops don't thrash the DOM.
  const outBatcher = createBatcher(s => appendChunk(lines, 'out', s))
  const errBatcher = createBatcher(s => appendChunk(lines, 'err', s))
  const flushTimer = setInterval(() => { outBatcher.flush(); errBatcher.flush() }, 60)

  try {
    const { runPython } = await import('./pythonRunner')
    // Hand the whole file set + active entry to the runner; it writes every file into the
    // virtual FS first (so cross-file imports work) then executes the active file.
    const res = await runPython(
      { files: { ...project.value.files }, entry: activeName.value },
      {
        onStdout: s => outBatcher.push(s),
        onStderr: s => errBatcher.push(s),
        onStatus: st => { phase.value = st === 'download' ? t('py.loadingCore') : t('py.initRuntime') },
      }
    )
    outBatcher.flush(); errBatcher.flush()

    figures.value = res.figures || []
    if (res.error) {
      hadError.value = true
      appendChunk(lines, 'err', formatError(res.error))
      showToast(t('py.failed'))
    } else if (res.result?.kind === 'html') {
      htmlOut.value = res.result.data
    } else if (res.result?.kind === 'text' && res.result.data) {
      result.value = res.result
    }
    if (!res.error && !lines.length && !figures.value.length && !htmlOut.value && res.result?.kind === 'none') {
      appendChunk(lines, 'info', t('py.noOutput'))
    }
  } catch (err) {
    hadError.value = true
    appendChunk(lines, 'err', formatError(err))
    showToast(t('py.failed'))
  } finally {
    clearInterval(flushTimer)
    outBatcher.flush(); errBatcher.flush()
    busy.value = false
    phase.value = ''
  }
}

// ---- packages (micropip — network) ------------------------------------------------------
async function installPkgs() {
  const specs = parsePackages(pkgText.value)
  if (!specs.length || installing.value) return
  installing.value = true
  appendChunk(lines, 'info', t('py.installing') + ' ' + specs.join(', '))
  try {
    const { installPackages } = await import('./pythonRunner')
    await installPackages(specs, {
      onStatus: spec => appendChunk(lines, 'info', `micropip: ${spec}`),
    })
    appendChunk(lines, 'info', t('py.installed') + ' ' + specs.join(', '))
    showToast(t('py.installed'))
    persistNow()
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
  const ex = EXAMPLE_PROJECTS.find(e => e.id === id)
  if (!ex) return
  // Replace the whole project with the example's file-set.
  const files = {}
  for (const n of Object.keys(ex.files)) files[n] = ex.files[n]
  const active = files[ex.entry] != null ? ex.entry : Object.keys(files)[0]
  project.value = { files, active }
  result.value = { kind: 'none', data: '' }
  // The activeName watcher updates the editor doc; do it explicitly too in case the name is
  // unchanged (e.g. example also uses main.py as the active file).
  nextTick(() => {
    cm.value?.setDoc(activeContent(project.value))
    cm.value?.focus()
  })
  persistNow()
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

onMounted(() => { initEditor() })
onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  persistNow()
  cm.value?.destroy()
})
</script>

<template>
  <main class="ide">
    <!-- Header + examples -->
    <header class="ide-head">
      <div class="ide-titles">
        <h2 class="ide-title">{{ t('py.title') }}</h2>
        <p class="ide-sub">{{ t('py.hint') }}</p>
      </div>
      <div class="examples" role="list" :aria-label="t('py.examples')">
        <button
          v-for="ex in examples"
          :key="ex.id"
          class="example"
          role="listitem"
          type="button"
          @click="loadExample(ex.id)"
        >
          {{ ex.title }}
          <span v-if="ex.needsNetwork" class="net-dot" :title="t('py.networkBadge')">●</span>
        </button>
      </div>
    </header>

    <!-- First-run runtime download banner -->
    <p v-if="!coreReady" class="banner">
      <span class="banner-icon" aria-hidden="true">⤓</span>
      <span>{{ coreLoading ? t('py.loadingCore') : t('py.coreNotice') }}</span>
    </p>

    <!-- The IDE: editor pane (file tabs + CodeMirror) | output pane -->
    <div class="workbench">
      <!-- Editor pane -->
      <section class="pane editor-pane">
        <!-- File tab strip -->
        <div class="filebar" role="tablist" :aria-label="t('py.files')">
          <div
            v-for="name in names"
            :key="name"
            class="filetab"
            :class="{ active: name === activeName }"
            role="tab"
            :aria-selected="name === activeName"
          >
            <template v-if="renaming === name">
              <input
                ref="renameInput"
                v-model="renameText"
                class="rename-input"
                spellcheck="false"
                autocapitalize="off"
                autocorrect="off"
                @keydown.enter.prevent="commitRename"
                @keydown.esc.prevent="cancelRename"
                @blur="commitRename"
              />
            </template>
            <template v-else>
              <button
                class="filetab-name"
                type="button"
                @click="switchTo(name)"
                @dblclick="beginRename(name)"
                :title="t('py.renameHint')"
              >{{ name }}</button>
              <button
                v-if="names.length > 1"
                class="filetab-x"
                type="button"
                :aria-label="t('py.deleteFile') + ' ' + name"
                :title="t('py.deleteFile')"
                @click.stop="removeFile(name)"
              >×</button>
            </template>
          </div>
          <button class="filetab-add" type="button" :aria-label="t('py.newFile')" :title="t('py.newFile')" @click="newFile">+</button>
        </div>

        <!-- CodeMirror mount point -->
        <div ref="editorEl" class="cm-host"></div>

        <!-- Editor footer: run + actions -->
        <div class="editor-foot">
          <button class="run-btn" :disabled="busy" @click="run">
            <span v-if="!busy">▶ {{ t('py.run') }} · {{ cmdLabel }}</span>
            <span v-else>{{ phase || t('py.running') }}</span>
          </button>
          <div class="foot-spacer"></div>
          <button class="ghost-btn" type="button" @click="copyActive">{{ t('tool.copy') }}</button>
          <button class="ghost-btn" type="button" :disabled="busy" @click="newFile">{{ t('py.newFile') }}</button>
        </div>

        <!-- Loading bar while the runtime downloads / inits -->
        <div v-if="busy" class="progress">
          <div class="bar"><div class="bar-fill indet"></div></div>
          <span class="progress-pct">{{ phase || t('py.running') }}</span>
        </div>

        <!-- Packages (micropip — explicitly a network operation) -->
        <div class="pkg">
          <div class="pkg-head">
            <span class="pkg-label">{{ t('py.packages') }}</span>
            <span class="net-badge">{{ t('py.networkBadge') }}</span>
            <BackendInfo />
          </div>
          <div class="pkg-row">
            <input
              v-model="pkgText"
              class="pkg-input"
              type="text"
              spellcheck="false"
              :placeholder="t('py.packagesPlaceholder')"
              @input="persist"
              @keydown.enter.prevent="installPkgs"
            />
            <button class="pkg-btn" :disabled="installing || !pkgText.trim()" @click="installPkgs">
              <span v-if="!installing">{{ t('py.install') }}</span>
              <span v-else>{{ t('py.installing') }}</span>
            </button>
          </div>
          <p class="pkg-note">{{ t('py.packagesNote') }}</p>
        </div>
      </section>

      <!-- Output pane -->
      <section class="pane output-pane">
        <div class="output-head">
          <span class="output-title">{{ t('py.console') }}</span>
          <button v-if="hasOutput" class="mini-btn" type="button" @click="clearOutput">{{ t('py.clearOutput') }}</button>
        </div>

        <div class="output-body">
          <div v-if="!hasOutput" class="output-empty">{{ t('py.outputEmpty') }}</div>

          <!-- stdout / stderr / info console -->
          <pre v-if="lines.length" class="console"><template v-for="(ln, i) in lines" :key="i"><span :class="['ln', 'ln-' + ln.kind]">{{ ln.text }}</span></template></pre>

          <!-- last-expression repr -->
          <div v-if="result.kind === 'text' && result.data" class="block repr">
            <div class="block-head">{{ t('py.lastValue') }}</div>
            <pre class="repr-body">{{ result.data }}</pre>
          </div>

          <!-- matplotlib figures -->
          <div v-if="figures.length" class="block figures">
            <div class="block-head">{{ t('py.figures') }}</div>
            <img
              v-for="(fig, i) in figures"
              :key="i"
              class="figure"
              :src="'data:image/png;base64,' + fig"
              :alt="t('py.figures') + ' ' + (i + 1)"
            />
          </div>

          <!-- sandboxed HTML (from _repr_html_) -->
          <div v-if="htmlOut" class="block htmlout">
            <div class="block-head">{{ t('py.htmlOutput') }}</div>
            <iframe class="htmlout-frame" sandbox="allow-scripts" :srcdoc="htmlOut" :title="t('py.htmlOutput')"></iframe>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.ide {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
  padding: 20px 20px 28px; max-width: 1180px; margin: 0 auto; width: 100%;
  animation: tbIn 0.3s var(--ease-out);
}
@keyframes tbIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

/* Header */
.ide-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
.ide-title { font-size: 22px; font-weight: 750; letter-spacing: -0.5px; }
.ide-sub { margin-top: 4px; color: var(--text-secondary); font-size: 12.5px; line-height: 1.5; max-width: 460px; }
.examples { display: flex; flex-wrap: wrap; gap: 7px; justify-content: flex-end; }
.example { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border: 1px solid var(--border); border-radius: 99px; background: var(--surface); color: var(--text); font-size: 12px; font-weight: 500; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; }
.example:hover { background: var(--surface-hover); border-color: var(--text-tertiary); }
.example:active { transform: scale(0.97); }
.net-dot { color: var(--accent); font-size: 7px; line-height: 1; }

/* First-run banner */
.banner { display: flex; align-items: center; gap: 9px; font-size: 12px; line-height: 1.45; color: var(--text-secondary); background: var(--accent-bg); border: 1px solid var(--border-light); border-radius: 10px; padding: 9px 12px; margin-bottom: 12px; }
.banner-icon { color: var(--accent); font-weight: 700; font-size: 14px; }

/* Workbench split */
.workbench { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr); gap: 14px; }
.pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); overflow: hidden; }

/* File tab strip */
.filebar { display: flex; align-items: stretch; gap: 2px; padding: 6px 6px 0; border-bottom: 1px solid var(--border-light); background: var(--surface-hover); overflow-x: auto; }
.filebar::-webkit-scrollbar { height: 0; }
.filetab { display: inline-flex; align-items: center; gap: 2px; padding: 0 2px 0 4px; border: 1px solid transparent; border-bottom: none; border-radius: 8px 8px 0 0; font-size: 12px; max-width: 200px; flex: 0 0 auto; position: relative; top: 1px; }
.filetab.active { background: var(--surface); border-color: var(--border-light); }
.filetab-name { border: none; background: transparent; color: var(--text-secondary); font-family: var(--font-mono); font-size: 12px; padding: 7px 6px; cursor: pointer; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.filetab.active .filetab-name { color: var(--text); font-weight: 600; }
.filetab-name:hover { color: var(--text); }
.filetab-x { border: none; background: transparent; color: var(--text-tertiary); font-size: 15px; line-height: 1; width: 18px; height: 18px; border-radius: 5px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.filetab-x:hover { background: var(--surface-active); color: var(--text); }
.filetab-add { flex: 0 0 auto; border: none; background: transparent; color: var(--text-secondary); font-size: 17px; line-height: 1; width: 28px; cursor: pointer; border-radius: 6px; margin: 2px 0; }
.filetab-add:hover { background: var(--surface-active); color: var(--text); }
.rename-input { width: 130px; border: 1px solid var(--accent); border-radius: 6px; background: var(--bg); color: var(--text); font-family: var(--font-mono); font-size: 12px; padding: 5px 6px; margin: 3px 2px; outline: none; }

/* CodeMirror host — fills available editor height */
.cm-host { flex: 1; min-height: 220px; overflow: hidden; }
.cm-host :deep(.cm-editor) { height: 100%; }
.cm-host :deep(.cm-editor.cm-focused) { outline: none; }

/* Editor footer */
.editor-foot { display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-top: 1px solid var(--border-light); background: var(--surface-hover); }
.foot-spacer { flex: 1; }
.run-btn { display: inline-flex; align-items: center; gap: 5px; padding: 8px 16px; border: none; border-radius: 9px; background: var(--text); color: var(--bg); font-size: 13px; font-weight: 650; font-family: var(--font-sans); cursor: pointer; transition: opacity 0.15s, transform 0.1s; }
.run-btn:hover:not(:disabled) { opacity: 0.9; }
.run-btn:active:not(:disabled) { transform: scale(0.99); }
.run-btn:disabled { opacity: 0.6; cursor: default; }
.ghost-btn { padding: 7px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text-secondary); font-size: 12px; font-family: var(--font-sans); cursor: pointer; }
.ghost-btn:hover:not(:disabled) { color: var(--text); background: var(--surface-active); }
.ghost-btn:disabled { opacity: 0.5; cursor: default; }

/* Loading bar */
.progress { display: flex; align-items: center; gap: 10px; padding: 0 10px 8px; }
.bar { flex: 1; height: 6px; border-radius: 99px; background: var(--surface-active); overflow: hidden; }
.bar-fill { height: 100%; background: var(--accent); border-radius: 99px; }
.bar-fill.indet { width: 35%; animation: indet 1.1s var(--ease-out) infinite; }
@keyframes indet { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }
.progress-pct { font-size: 11.5px; color: var(--text-secondary); }

/* Packages */
.pkg { padding: 11px 12px; border-top: 1px solid var(--border-light); }
.pkg-head { display: flex; align-items: center; gap: 8px; }
.pkg-label { font-size: 12px; font-weight: 650; color: var(--text); }
.net-badge { font-size: 10px; font-weight: 600; color: var(--accent); background: var(--accent-bg); border-radius: 99px; padding: 2px 8px; }
.pkg-row { display: flex; gap: 8px; margin-top: 8px; }
.pkg-input { flex: 1; min-width: 0; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 12.5px; font-family: var(--font-mono); outline: none; }
.pkg-input:focus { border-color: var(--accent); }
.pkg-btn { flex-shrink: 0; padding: 7px 13px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-hover); color: var(--text); font-size: 12px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; }
.pkg-btn:hover:not(:disabled) { border-color: var(--text-tertiary); }
.pkg-btn:disabled { opacity: 0.5; cursor: default; }
.pkg-note { font-size: 10.5px; line-height: 1.5; color: var(--text-tertiary); margin-top: 7px; }

/* Output pane */
.output-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border-light); background: var(--surface-hover); }
.output-title { font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.mini-btn { border: none; background: var(--surface-active); color: var(--text-secondary); font-size: 11px; padding: 3px 9px; border-radius: 5px; cursor: pointer; font-family: var(--font-sans); }
.mini-btn:hover { color: var(--text); }
.output-body { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px; }
.output-empty { color: var(--text-tertiary); font-size: 12.5px; font-style: italic; padding: 8px 0; }

.console { margin: 0 0 4px; font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6; color: var(--text); white-space: pre-wrap; word-break: break-word; }
.ln { display: inline; }
.ln-err { color: var(--danger, #e5484d); }
.ln-info { color: var(--text-tertiary); font-style: italic; }

.block { margin-top: 14px; border: 1px solid var(--border-light); border-radius: 10px; overflow: hidden; background: var(--bg); animation: tbIn 0.25s var(--ease-out); }
.block-head { padding: 6px 11px; font-size: 10.5px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border-light); background: var(--surface-hover); }
.repr-body { margin: 0; padding: 11px 13px; font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6; color: var(--accent); white-space: pre-wrap; word-break: break-word; }
.figures { padding-bottom: 11px; }
.figure { display: block; max-width: 100%; height: auto; margin: 11px 13px 0; border-radius: 8px; border: 1px solid var(--border-light); background: #fff; }
.htmlout-frame { width: 100%; min-height: 220px; border: 0; background: #fff; display: block; }

/* Responsive: stack panes on narrow screens */
@media (max-width: 880px) {
  .ide { padding: 16px 12px 24px; }
  .ide-head { flex-direction: column; }
  .examples { justify-content: flex-start; }
  .workbench { grid-template-columns: 1fr; grid-auto-rows: minmax(0, auto); }
  .cm-host { min-height: 300px; flex: none; height: 340px; }
  .output-pane { min-height: 240px; }
  .output-body { max-height: 420px; }
}
</style>
