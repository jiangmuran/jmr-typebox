<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useRouteHead } from '../composables/useRouteHead'
import { useI18n } from '../composables/useI18n'
import { useToast } from '../composables/useToast'
import { TOOL_DEFS } from '../tools/text/toolDefs'
import { jwtDecode, countText } from '../tools/text/transforms'
import { sha1, sha256, sha384, sha512 } from '../tools/text/hash'
import { aesEncrypt, aesDecrypt } from '../tools/text/crypto'

const { meta: m } = useRouteHead()
const route = useRoute()
const { t, locale } = useI18n()
const { showToast } = useToast()

const def = computed(() => TOOL_DEFS[route.meta?.path] || { mode: 'transform', ops: [] })
const input = ref('')
const output = ref('')
const passphrase = ref('')

const opLabel = op => (locale.value === 'zh' ? op.zh : op.en)

function runOp(op) {
  try { output.value = op.fn(input.value) }
  catch { showToast(t('tool.invalid')) }
}

async function runAes(kind) {
  try { output.value = kind === 'enc' ? await aesEncrypt(input.value, passphrase.value) : await aesDecrypt(input.value, passphrase.value) }
  catch { showToast(t('tool.invalid')) }
}

// hash (live)
const hashes = ref({})
watch([input, def], async () => {
  if (def.value.mode !== 'hash' || !input.value) { hashes.value = {}; return }
  const v = input.value
  hashes.value = { 'SHA-1': await sha1(v), 'SHA-256': await sha256(v), 'SHA-384': await sha384(v), 'SHA-512': await sha512(v) }
}, { immediate: true })

// jwt (live)
const jwt = computed(() => {
  if (def.value.mode !== 'jwt' || !input.value.trim()) return null
  try { return jwtDecode(input.value) } catch { return { error: true } }
})

// word count (live)
const stats = computed(() => countText(input.value))

async function copyOut() {
  const text = output.value || (def.value.mode === 'jwt' && jwt.value && !jwt.value.error ? JSON.stringify(jwt.value, null, 2) : '')
  if (!text) return
  try { await navigator.clipboard.writeText(text); showToast(t('toast.copied')) } catch {}
}
async function pasteIn() {
  try { input.value = await navigator.clipboard.readText() } catch {}
}
function clearAll() { input.value = ''; output.value = ''; passphrase.value = '' }
function onDrop(e) {
  const f = e.dataTransfer?.files?.[0]
  if (f && f.type.startsWith('text')) { const r = new FileReader(); r.onload = () => { input.value = r.result }; r.readAsText(f) }
}
</script>

<template>
  <main class="toolbox" @dragover.prevent @drop.prevent="onDrop">
    <header class="tb-head">
      <h1>{{ m.h1 }}</h1>
      <p>{{ m.description }}</p>
    </header>

    <div class="tb-io">
      <div class="tb-pane">
        <div class="tb-pane-head"><span>{{ t('tool.input') }}</span>
          <div class="tb-actions">
            <button @click="pasteIn">{{ t('tool.paste') }}</button>
            <button @click="clearAll">{{ t('tool.clear') }}</button>
          </div>
        </div>
        <textarea v-model="input" spellcheck="false" :placeholder="t('tool.input') + '…'"></textarea>
      </div>

      <!-- AES passphrase -->
      <div v-if="def.mode === 'aes'" class="tb-pass">
        <input v-model="passphrase" type="password" :placeholder="t('tool.passphrase')" />
      </div>

      <!-- Operation buttons -->
      <div class="tb-ops">
        <template v-if="def.mode === 'transform'">
          <button v-for="(op, i) in def.ops" :key="i" class="op" @click="runOp(op)">{{ opLabel(op) }}</button>
        </template>
        <template v-else-if="def.mode === 'aes'">
          <button class="op primary" @click="runAes('enc')">{{ t('tool.encrypt') }}</button>
          <button class="op" @click="runAes('dec')">{{ t('tool.decrypt') }}</button>
        </template>
      </div>

      <!-- Output: transform / aes -->
      <div v-if="def.mode === 'transform' || def.mode === 'aes'" class="tb-pane">
        <div class="tb-pane-head"><span>{{ t('tool.output') }}</span>
          <div class="tb-actions"><button @click="copyOut">{{ t('tool.copy') }}</button></div>
        </div>
        <textarea :value="output" readonly spellcheck="false"></textarea>
      </div>

      <!-- Output: hash -->
      <div v-else-if="def.mode === 'hash'" class="tb-result">
        <div v-for="(val, name) in hashes" :key="name" class="hash-row">
          <span class="hash-name">{{ name }}</span>
          <code class="hash-val">{{ val }}</code>
        </div>
        <p v-if="!input" class="tb-hint">{{ t('tool.input') }}…</p>
      </div>

      <!-- Output: jwt -->
      <div v-else-if="def.mode === 'jwt'" class="tb-result">
        <template v-if="jwt && !jwt.error">
          <div class="jwt-block"><span class="jwt-label">{{ t('tool.jwt.header') }}</span><pre>{{ JSON.stringify(jwt.header, null, 2) }}</pre></div>
          <div class="jwt-block"><span class="jwt-label">{{ t('tool.jwt.payload') }}</span><pre>{{ JSON.stringify(jwt.payload, null, 2) }}</pre></div>
        </template>
        <p v-else-if="input" class="tb-hint">{{ t('tool.invalid') }}</p>
      </div>

      <!-- Output: word count -->
      <div v-else-if="def.mode === 'wordcount'" class="tb-stats">
        <div class="stat"><strong>{{ stats.words }}</strong><span>{{ t('status.words') }}</span></div>
        <div class="stat"><strong>{{ stats.chars }}</strong><span>{{ t('status.chars') }}</span></div>
        <div class="stat"><strong>{{ stats.lines }}</strong><span>{{ t('status.lines') }}</span></div>
        <div class="stat"><strong>{{ stats.readMin }}</strong><span>{{ t('status.minRead') }}</span></div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.toolbox { flex: 1; overflow-y: auto; padding: 32px 24px 56px; max-width: 760px; margin: 0 auto; width: 100%; animation: tbIn 0.3s var(--ease-out); }
@keyframes tbIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.tb-head { margin-bottom: 20px; }
.tb-head h1 { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; }
.tb-head p { margin-top: 6px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }
.tb-io { display: flex; flex-direction: column; gap: 12px; }
.tb-pane { border: 1px solid var(--border-light); border-radius: 12px; overflow: hidden; background: var(--surface); }
.tb-pane-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border-light); font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.tb-actions { display: flex; gap: 4px; }
.tb-actions button { border: none; background: var(--surface-hover); color: var(--text-secondary); font-size: 11px; padding: 3px 9px; border-radius: 5px; cursor: pointer; font-family: var(--font-sans); }
.tb-actions button:hover { color: var(--text); }
.tb-pane textarea { width: 100%; min-height: 120px; border: none; background: transparent; padding: 12px; font-family: var(--font-mono); font-size: 13px; line-height: 1.6; color: var(--text); outline: none; resize: vertical; }
.tb-pass input { width: 100%; padding: 9px 12px; border: 1px solid var(--border-light); border-radius: 9px; background: var(--surface); color: var(--text); font-size: 13px; outline: none; }
.tb-pass input:focus { border-color: var(--accent); }
.tb-ops { display: flex; flex-wrap: wrap; gap: 8px; }
.op { padding: 8px 14px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); color: var(--text); font-size: 12px; font-weight: 500; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; }
.op:hover { background: var(--surface-hover); }
.op:active { transform: scale(0.97); }
.op.primary { background: var(--text); color: var(--bg); border-color: var(--text); }
.tb-result { display: flex; flex-direction: column; gap: 10px; }
.hash-row { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border: 1px solid var(--border-light); border-radius: 10px; background: var(--surface); }
.hash-name { font-size: 11px; font-weight: 600; color: var(--text-secondary); }
.hash-val { font-family: var(--font-mono); font-size: 12px; word-break: break-all; color: var(--text); }
.jwt-block { border: 1px solid var(--border-light); border-radius: 10px; overflow: hidden; }
.jwt-label { display: block; padding: 6px 12px; font-size: 11px; font-weight: 600; color: var(--text-secondary); background: var(--surface-hover); }
.jwt-block pre { padding: 12px; font-family: var(--font-mono); font-size: 12px; overflow-x: auto; color: var(--text); }
.tb-hint { color: var(--text-tertiary); font-size: 13px; padding: 8px; }
.tb-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.stat { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 18px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); }
.stat strong { font-size: 26px; font-weight: 750; }
.stat span { font-size: 11px; color: var(--text-secondary); }
@media (max-width: 560px) { .tb-stats { grid-template-columns: repeat(2, 1fr); } }
</style>
