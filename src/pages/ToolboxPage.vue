<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useRouteHead } from '../composables/useRouteHead'
import { useI18n } from '../composables/useI18n'
import { useToast } from '../composables/useToast'
import { TOOL_DEFS } from '../tools/text/toolDefs'
import { jwtDecode, countText } from '../tools/text/transforms'
import { sha1, sha256, sha384, sha512 } from '../tools/text/hash'
import { aesEncrypt, aesDecrypt } from '../tools/text/crypto'
import { totp, totpRemaining, parseOtpauth } from '../tools/text/totp'

const { meta: m } = useRouteHead()
const route = useRoute()
const { t, locale } = useI18n()
const { showToast } = useToast()

const def = computed(() => TOOL_DEFS[route.meta?.path] || { mode: 'transform', ops: [] })

// Localized on-page title/subtitle, keyed by the tool's route path
// (/tools/base64 → tool.base64.title). The English m.h1 stays as the SEO <h1>.
const toolKey = computed(() => (route.meta?.path || route.path || '').replace('/tools/', ''))
const pageTitle = computed(() => { const k = `tool.${toolKey.value}.title`; const v = t(k); return v === k ? m.h1 : v })
const pageSub = computed(() => { const k = `tool.${toolKey.value}.sub`; const v = t(k); return v === k ? m.description : v })
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

// TOTP (live 2FA code) — recomputed every second so the code + countdown stay current. All local.
const totpCode = ref('')
const totpRemain = ref(30)
const totpStep = ref(30)
const totpErr = ref(false)
async function recomputeTotp() {
  if (def.value.mode !== 'totp') return
  let secret = input.value.trim(), step = 30, digits = 6, algorithm = 'SHA1'
  if (/^otpauth:\/\//i.test(secret)) {
    const p = parseOtpauth(secret)
    if (p) { secret = p.secret; step = p.step; digits = p.digits; algorithm = p.algorithm }
  }
  totpStep.value = step
  if (!secret) { totpCode.value = ''; totpErr.value = false; totpRemain.value = step; return }
  try { totpCode.value = await totp(secret, { step, digits, algorithm }); totpRemain.value = totpRemaining(step); totpErr.value = false }
  catch { totpCode.value = ''; totpErr.value = true }
}
let totpTimer = null
watch([input, def], recomputeTotp, { immediate: true })
onMounted(() => { totpTimer = setInterval(recomputeTotp, 1000) })
onUnmounted(() => clearInterval(totpTimer))
async function copyTotp() {
  if (!totpCode.value) return
  try { await navigator.clipboard.writeText(totpCode.value); showToast(t('toast.copied')) } catch {}
}
const totpSpaced = computed(() => totpCode.value.length === 6 ? totpCode.value.slice(0, 3) + ' ' + totpCode.value.slice(3) : totpCode.value)
const totpPct = computed(() => Math.round((totpRemain.value / (totpStep.value || 30)) * 100))
function clearAll() { input.value = ''; output.value = ''; passphrase.value = '' }
function onDrop(e) {
  const f = e.dataTransfer?.files?.[0]
  if (f && f.type.startsWith('text')) { const r = new FileReader(); r.onload = () => { input.value = r.result }; r.readAsText(f) }
}
</script>

<template>
  <main class="toolbox" @dragover.prevent @drop.prevent="onDrop">
    <h1 class="sr-only">{{ m.h1 }}</h1>
    <header class="tb-head">
      <h2>{{ pageTitle }}</h2>
      <p>{{ pageSub }}</p>
    </header>

    <div class="tb-io">
      <div class="tb-pane">
        <div class="tb-pane-head"><span>{{ t('tool.input') }}</span>
          <div class="tb-actions">
            <button @click="pasteIn">{{ t('tool.paste') }}</button>
            <button @click="clearAll">{{ t('tool.clear') }}</button>
          </div>
        </div>
        <textarea v-model="input" spellcheck="false" :placeholder="def.mode === 'totp' ? t('tool.totp.placeholder') : t('tool.input') + '…'"></textarea>
      </div>

      <!-- AES passphrase -->
      <div v-if="def.mode === 'aes'" class="tb-pass">
        <input v-model="passphrase" type="password" :placeholder="t('tool.passphrase')" />
      </div>

      <!-- Operation buttons -->
      <div class="tb-ops">
        <template v-if="def.mode === 'transform'">
          <button v-for="(op, i) in def.ops" :key="i" class="btn op" @click="runOp(op)">{{ opLabel(op) }}</button>
        </template>
        <template v-else-if="def.mode === 'aes'">
          <button class="btn primary op" @click="runAes('enc')">{{ t('tool.encrypt') }}</button>
          <button class="btn op" @click="runAes('dec')">{{ t('tool.decrypt') }}</button>
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

      <!-- Output: TOTP (live 2FA code) -->
      <div v-else-if="def.mode === 'totp'" class="tb-totp">
        <div v-if="totpCode" class="totp-card">
          <button class="totp-code" :title="t('tool.copy')" @click="copyTotp">{{ totpSpaced }}</button>
          <div class="totp-track"><div class="totp-fill" :style="{ width: totpPct + '%' }"></div></div>
          <span class="totp-remain">{{ totpRemain }}s</span>
        </div>
        <p v-else-if="totpErr" class="tb-hint">{{ t('tool.invalid') }}</p>
      </div>
    </div>
  </main>
</template>

<style scoped>
.toolbox { flex: 1; overflow-y: auto; padding: 28px 24px 56px; max-width: var(--page-narrow); margin: 0 auto; width: 100%; animation: tbIn 0.3s var(--ease-out); }
@keyframes tbIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.tb-head { margin-bottom: 20px; }
.tb-head h2 { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; }
.tb-head p { margin-top: 6px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }
.tb-io { display: flex; flex-direction: column; gap: 12px; }
.tb-pane { border: 1px solid var(--border-light); border-radius: 12px; overflow: hidden; background: var(--surface); }
.tb-pane-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border-light); font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
.tb-actions { display: flex; gap: 4px; }
.tb-actions button { border: none; background: var(--surface-hover); color: var(--text-secondary); font-size: 12px; padding: 6px 11px; border-radius: 5px; cursor: pointer; font-family: var(--font-sans); }
.tb-actions button:hover { color: var(--text); }
.tb-pane textarea { width: 100%; min-height: 120px; border: none; background: transparent; padding: 12px; font-family: var(--font-mono); font-size: 13px; line-height: 1.6; color: var(--text); outline: none; resize: vertical; }
.tb-pass input { width: 100%; padding: 9px 12px; border: 1px solid var(--border-light); border-radius: 9px; background: var(--surface); color: var(--text); font-size: 13px; outline: none; }
.tb-pass input:focus { border-color: var(--accent); }
.tb-ops { display: flex; flex-wrap: wrap; gap: 8px; }
/* Operation buttons use the global .btn / .btn.primary kit. */
.tb-result { display: flex; flex-direction: column; gap: 10px; }
.hash-row { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border: 1px solid var(--border-light); border-radius: 10px; background: var(--surface); }
.hash-name { font-size: 11px; font-weight: 600; color: var(--text-secondary); }
.hash-val { font-family: var(--font-mono); font-size: 12px; word-break: break-all; color: var(--text); }
.jwt-block { border: 1px solid var(--border-light); border-radius: 10px; overflow: hidden; }
.jwt-label { display: block; padding: 6px 12px; font-size: 11px; font-weight: 600; color: var(--text-secondary); background: var(--surface-hover); }
.jwt-block pre { padding: 12px; font-family: var(--font-mono); font-size: 12px; overflow-x: auto; color: var(--text); }
.tb-hint { color: var(--text-tertiary); font-size: 13px; padding: 8px; }
.tb-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.tb-totp { display: flex; flex-direction: column; }
.totp-card { display: flex; align-items: center; gap: 16px; padding: 18px 20px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); }
.totp-code { font-family: var(--font-mono); font-size: 34px; font-weight: 700; letter-spacing: 4px; color: var(--accent); background: none; border: none; padding: 0; line-height: 1; cursor: pointer; font-variant-numeric: tabular-nums; }
.totp-track { flex: 1; height: 6px; border-radius: 99px; background: var(--surface-hover); overflow: hidden; }
.totp-fill { height: 100%; background: var(--accent); border-radius: 99px; transition: width 0.9s linear; }
.totp-remain { font-family: var(--font-mono); font-size: 13px; color: var(--text-secondary); min-width: 34px; text-align: right; font-variant-numeric: tabular-nums; }
@media (max-width: 480px) { .totp-code { font-size: 28px; letter-spacing: 3px; } }
.stat { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 18px; border: 1px solid var(--border-light); border-radius: 12px; background: var(--surface); }
.stat strong { font-size: 26px; font-weight: 750; }
.stat span { font-size: 11px; color: var(--text-secondary); }
@media (max-width: 560px) { .tb-stats { grid-template-columns: repeat(2, 1fr); } }

/* Phones: grow the input-pane action chips to comfortable thumb targets
   (operation buttons use .btn, which already grows to 44px on mobile). */
@media (max-width: 640px) {
  .tb-actions button { padding: 9px 13px; font-size: 12.5px; }
}
</style>
