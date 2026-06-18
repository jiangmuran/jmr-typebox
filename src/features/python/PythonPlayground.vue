<script setup>
// Interactive Python playground body. Rendered only inside <ClientOnly>, so it is safe to
// touch window/document/pyodide here. Pure logic (console model, snippet keys, examples,
// indent math, package parsing) is imported from ./pythonHelpers; the wasm runtime is
// lazy-loaded from ./pythonRunner on first run.
import { ref, computed, reactive, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { load, save } from '../../utils/storage'
import { libLoadState } from '../../utils/loadLibrary'
import BackendInfo from '../../components/BackendInfo.vue'
import {
  STORAGE_KEYS,
  DEFAULT_CODE,
  EXAMPLES,
  appendChunk,
  createBatcher,
  formatError,
  parsePackages,
  insertIndent,
} from './pythonHelpers'

const { t, locale } = useI18n()
const { showToast } = useToast()

// ---- editor state -----------------------------------------------------------------------
const code = ref(load(STORAGE_KEYS.code) ?? DEFAULT_CODE)
const editor = ref(null)
const pkgText = ref(load(STORAGE_KEYS.packages) ?? '')

// ---- run state --------------------------------------------------------------------------
const lines = reactive([])        // console-line model (see pythonHelpers.makeLine)
const result = ref({ kind: 'none', data: '' })  // last-expression rich repr
const figures = ref([])           // base64 PNG data from matplotlib
const htmlOut = ref('')           // sandboxed HTML output (from _repr_html_)
const busy = ref(false)
const phase = ref('')             // localized status under the Run button
const installing = ref(false)

// Pyodide load state for the first-run banner (mirrors the Media ffmpeg pattern).
const coreLoading = computed(() => libLoadState.pyodide === 'loading')
const coreReady = computed(() => libLoadState.pyodide === 'ready')

const examples = computed(() =>
  EXAMPLES.map(e => ({ id: e.id, title: e.title[locale.value] || e.title.en, needsNetwork: e.needsNetwork }))
)

// ---- persistence (debounced) ------------------------------------------------------------
let saveTimer = null
function persist() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    save(STORAGE_KEYS.code, code.value)
    save(STORAGE_KEYS.packages, pkgText.value)
  }, 400)
}

// ---- editor key handling ----------------------------------------------------------------
function onKeydown(e) {
  // Cmd/Ctrl+Enter runs.
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    run()
    return
  }
  // Tab inserts spaces (and indents multi-line selections); Shift+Tab is left to the browser.
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault()
    const el = e.target
    const { value, caret, selStart, selEnd } = insertIndent(el.value, el.selectionStart, el.selectionEnd)
    code.value = value
    nextTick(() => {
      if (selStart != null) el.setSelectionRange(selStart, selEnd)
      else el.setSelectionRange(caret, caret)
    })
    persist()
  }
}

function onInput() { persist() }

// ---- run --------------------------------------------------------------------------------
async function run() {
  if (busy.value) return
  busy.value = true
  lines.length = 0
  result.value = { kind: 'none', data: '' }
  figures.value = []
  htmlOut.value = ''
  phase.value = coreReady.value ? t('py.running') : t('py.loadingCore')

  // Batch stdout/stderr so chatty loops don't thrash the DOM; flush coalesced chunks into the
  // reactive line model on a short interval.
  const outBatcher = createBatcher(s => appendChunk(lines, 'out', s))
  const errBatcher = createBatcher(s => appendChunk(lines, 'err', s))
  const flushTimer = setInterval(() => { outBatcher.flush(); errBatcher.flush() }, 60)

  try {
    const { runPython } = await import('./pythonRunner')
    const res = await runPython(code.value, {
      onStdout: s => outBatcher.push(s),
      onStderr: s => errBatcher.push(s),
      onStatus: st => { phase.value = st === 'download' ? t('py.loadingCore') : t('py.initRuntime') },
    })
    outBatcher.flush(); errBatcher.flush()

    figures.value = res.figures || []
    if (res.error) {
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
  phase.value = ''
  appendChunk(lines, 'info', t('py.installing') + ' ' + specs.join(', '))
  try {
    const { installPackages } = await import('./pythonRunner')
    await installPackages(specs, {
      onStatus: spec => appendChunk(lines, 'info', `micropip: ${spec}`),
    })
    appendChunk(lines, 'info', t('py.installed') + ' ' + specs.join(', '))
    showToast(t('py.installed'))
    persist()
  } catch (err) {
    appendChunk(lines, 'err', formatError(err))
    showToast(t('py.installFailed'))
  } finally {
    installing.value = false
  }
}

// ---- examples / actions -----------------------------------------------------------------
function loadExample(id) {
  const ex = EXAMPLES.find(e => e.id === id)
  if (!ex) return
  code.value = ex.code
  result.value = { kind: 'none', data: '' }
  persist()
  editor.value?.focus()
}

function clearConsole() {
  lines.length = 0
  result.value = { kind: 'none', data: '' }
  figures.value = []
  htmlOut.value = ''
}

function clearCode() {
  code.value = ''
  persist()
  editor.value?.focus()
}

async function copyCode() {
  try { await navigator.clipboard.writeText(code.value); showToast(t('toast.copied')) } catch {}
}

onMounted(() => { editor.value?.focus() })
onBeforeUnmount(() => clearTimeout(saveTimer))

const cmdLabel = computed(() =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘↵' : 'Ctrl+↵'
)
</script>

<template>
  <main class="py">
    <header class="py-head">
      <h2 class="py-title">{{ t('py.title') }}</h2>
      <p class="py-sub">{{ t('py.hint') }}</p>
    </header>

    <!-- Examples gallery -->
    <div class="examples" role="list">
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

    <!-- Editor -->
    <div class="editor-card">
      <div class="editor-head">
        <span class="editor-label">main.py</span>
        <div class="editor-actions">
          <button type="button" @click="copyCode">{{ t('tool.copy') }}</button>
          <button type="button" @click="clearCode">{{ t('tool.clear') }}</button>
        </div>
      </div>
      <textarea
        ref="editor"
        v-model="code"
        class="editor"
        spellcheck="false"
        autocapitalize="off"
        autocorrect="off"
        :placeholder="t('py.placeholder')"
        @keydown="onKeydown"
        @input="onInput"
      ></textarea>
    </div>

    <!-- First-run runtime download notice -->
    <p v-if="!coreReady" class="notice">{{ t('py.coreNotice') }}</p>

    <!-- Run -->
    <div class="run-row">
      <button class="run-btn" :disabled="busy" @click="run">
        <span v-if="!busy">{{ t('py.run') }} · {{ cmdLabel }}</span>
        <span v-else>{{ phase || t('py.running') }}</span>
      </button>
      <button v-if="lines.length || figures.length || htmlOut || result.data" class="ghost-btn" :disabled="busy" @click="clearConsole">
        {{ t('py.clearOutput') }}
      </button>
    </div>

    <!-- Loading bar (indeterminate while the runtime downloads/inits) -->
    <div v-if="busy" class="progress">
      <div class="bar"><div class="bar-fill indet"></div></div>
      <span class="progress-pct">{{ phase || t('py.running') }}</span>
    </div>

    <!-- Packages (micropip — explicitly a network operation) -->
    <div class="pkg-card">
      <div class="pkg-head">
        <span class="pkg-label">{{ t('py.packages') }}</span>
        <BackendInfo />
      </div>
      <p class="pkg-note">{{ t('py.packagesNote') }}</p>
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
    </div>

    <!-- Output: console -->
    <div v-if="lines.length" class="console">
      <div class="console-head">{{ t('py.console') }}</div>
      <pre class="console-body"><template v-for="(ln, i) in lines" :key="i"><span :class="['ln', 'ln-' + ln.kind]">{{ ln.text }}</span></template></pre>
    </div>

    <!-- Output: last-expression repr -->
    <div v-if="result.kind === 'text' && result.data" class="repr">
      <div class="repr-head">{{ t('py.lastValue') }}</div>
      <pre class="repr-body">{{ result.data }}</pre>
    </div>

    <!-- Output: matplotlib figures -->
    <div v-if="figures.length" class="figures">
      <div class="figures-head">{{ t('py.figures') }}</div>
      <img
        v-for="(fig, i) in figures"
        :key="i"
        class="figure"
        :src="'data:image/png;base64,' + fig"
        :alt="t('py.figures') + ' ' + (i + 1)"
      />
    </div>

    <!-- Output: sandboxed HTML (from _repr_html_) -->
    <div v-if="htmlOut" class="htmlout">
      <div class="htmlout-head">{{ t('py.htmlOutput') }}</div>
      <iframe class="htmlout-frame" sandbox="allow-scripts" :srcdoc="htmlOut" :title="t('py.htmlOutput')"></iframe>
    </div>
  </main>
</template>

<style scoped>
.py { flex: 1; overflow-y: auto; padding: 32px 24px 56px; max-width: 760px; margin: 0 auto; width: 100%; animation: tbIn 0.3s var(--ease-out); }
@keyframes tbIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

.py-head { margin-bottom: 16px; }
.py-title { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; }
.py-sub { margin-top: 6px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }

.examples { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.example { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 99px; background: var(--surface); color: var(--text); font-size: 12px; font-weight: 500; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; }
.example:hover { background: var(--surface-hover); border-color: var(--text-tertiary); }
.example:active { transform: scale(0.97); }
.net-dot { color: var(--accent); font-size: 8px; line-height: 1; }

.editor-card { border: 1px solid var(--border-light); border-radius: 12px; overflow: hidden; background: var(--surface); }
.editor-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border-light); font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.editor-actions { display: flex; gap: 4px; }
.editor-actions button { border: none; background: var(--surface-hover); color: var(--text-secondary); font-size: 11px; padding: 3px 9px; border-radius: 5px; cursor: pointer; font-family: var(--font-sans); }
.editor-actions button:hover { color: var(--text); }
.editor { width: 100%; min-height: 260px; border: none; background: transparent; padding: 14px; font-family: var(--font-mono); font-size: 13px; line-height: 1.6; color: var(--text); outline: none; resize: vertical; tab-size: 4; white-space: pre; overflow-wrap: normal; overflow-x: auto; }

.notice { font-size: 12px; line-height: 1.5; color: var(--text-secondary); background: var(--surface-hover); border: 1px solid var(--border-light); border-radius: 10px; padding: 10px 12px; margin-top: 12px; }

.run-row { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
.run-btn { padding: 11px 18px; border: none; border-radius: 11px; background: var(--text); color: var(--bg); font-size: 14px; font-weight: 650; font-family: var(--font-sans); cursor: pointer; transition: opacity 0.15s, transform 0.1s; }
.run-btn:hover:not(:disabled) { opacity: 0.9; }
.run-btn:active:not(:disabled) { transform: scale(0.99); }
.run-btn:disabled { opacity: 0.6; cursor: default; }
.ghost-btn { padding: 9px 14px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); color: var(--text-secondary); font-size: 12px; font-family: var(--font-sans); cursor: pointer; }
.ghost-btn:hover:not(:disabled) { color: var(--text); background: var(--surface-hover); }
.ghost-btn:disabled { opacity: 0.5; cursor: default; }

.progress { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.bar { flex: 1; height: 8px; border-radius: 99px; background: var(--surface-hover); overflow: hidden; }
.bar-fill { height: 100%; background: var(--accent); border-radius: 99px; }
.bar-fill.indet { width: 35%; animation: indet 1.1s var(--ease-out) infinite; }
@keyframes indet { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }
.progress-pct { font-size: 12px; color: var(--text-secondary); }

.pkg-card { margin-top: 16px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); padding: 12px 14px; }
.pkg-head { display: flex; align-items: center; justify-content: space-between; }
.pkg-label { font-size: 12px; font-weight: 650; color: var(--text); }
.pkg-note { font-size: 11px; line-height: 1.5; color: var(--text-secondary); margin: 6px 0 10px; }
.pkg-row { display: flex; gap: 8px; }
.pkg-input { flex: 1; min-width: 0; padding: 8px 11px; border: 1px solid var(--border); border-radius: 9px; background: var(--bg); color: var(--text); font-size: 13px; font-family: var(--font-mono); outline: none; }
.pkg-input:focus { border-color: var(--accent); }
.pkg-btn { flex-shrink: 0; padding: 8px 14px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface-hover); color: var(--text); font-size: 12px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; }
.pkg-btn:hover:not(:disabled) { border-color: var(--text-tertiary); }
.pkg-btn:disabled { opacity: 0.5; cursor: default; }

.console, .repr, .figures, .htmlout { margin-top: 16px; border: 1px solid var(--border-light); border-radius: 12px; overflow: hidden; background: var(--surface); animation: tbIn 0.25s var(--ease-out); }
.console-head, .repr-head, .figures-head, .htmlout-head { padding: 7px 12px; font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border-light); background: var(--surface-hover); }
.console-body { margin: 0; padding: 12px 14px; font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6; color: var(--text); white-space: pre-wrap; word-break: break-word; max-height: 360px; overflow: auto; }
.ln { display: inline; }
.ln-err { color: var(--danger, #e5484d); }
.ln-info { color: var(--text-tertiary); font-style: italic; }
.repr-body { margin: 0; padding: 12px 14px; font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6; color: var(--accent); white-space: pre-wrap; word-break: break-word; }
.figures { padding-bottom: 12px; }
.figure { display: block; max-width: 100%; height: auto; margin: 12px 14px 0; border-radius: 8px; border: 1px solid var(--border-light); background: #fff; }
.htmlout-frame { width: 100%; min-height: 220px; border: 0; background: #fff; display: block; }

@media (max-width: 560px) {
  .py { padding: 20px 16px 48px; }
  .pkg-row { flex-direction: column; }
}
</style>
