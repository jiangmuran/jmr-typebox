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
import ToolboxNav from '../components/ToolboxNav.vue'

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

// QR code — generate (text → QR canvas) / decode (image → text). qrcode + jsqr are lazy-loaded.
const qrMode = ref('gen') // 'gen' | 'dec'
const qrText = ref('https://box.muran.tech')
const qrSize = ref(256)
const qrLevel = ref('M')
const qrCanvas = ref(null)
const qrDecoded = ref('')
const qrDecErr = ref(false)
const qrDragOver = ref(false)
async function renderQR() {
  if (def.value.mode !== 'qr' || qrMode.value !== 'gen') return
  const canvas = qrCanvas.value
  if (!canvas) return
  if (!qrText.value) { canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height); return }
  try {
    const { default: QRCode } = await import('qrcode')
    await QRCode.toCanvas(canvas, qrText.value, { width: qrSize.value, margin: 2, errorCorrectionLevel: qrLevel.value })
  } catch { /* content too long for this error-correction level, etc. */ }
}
watch([qrText, qrSize, qrLevel, qrMode, def], renderQR, { flush: 'post' })
onMounted(renderQR)
function downloadQRPng() {
  const canvas = qrCanvas.value; if (!canvas) return
  const a = document.createElement('a'); a.download = 'qrcode.png'; a.href = canvas.toDataURL('image/png'); a.click()
}
async function downloadQRSvg() {
  if (!qrText.value) return
  try {
    const { default: QRCode } = await import('qrcode')
    const svg = await QRCode.toString(qrText.value, { type: 'svg', margin: 2, errorCorrectionLevel: qrLevel.value })
    const a = document.createElement('a'); a.download = 'qrcode.svg'; a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); a.click()
  } catch {}
}
async function copyQR() {
  const canvas = qrCanvas.value; if (!canvas) return
  try {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); showToast(t('toast.copied'))
  } catch {}
}
async function decodeImageFile(file) {
  qrDecErr.value = false
  try {
    const bmp = await createImageBitmap(file)
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height
    const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0)
    const data = ctx.getImageData(0, 0, c.width, c.height)
    const { default: jsQR } = await import('jsqr')
    const res = jsQR(data.data, data.width, data.height)
    if (res && res.data) { qrDecoded.value = res.data } else { qrDecoded.value = ''; qrDecErr.value = true }
  } catch { qrDecoded.value = ''; qrDecErr.value = true }
}
function onQrDrop(e) { qrDragOver.value = false; const f = e.dataTransfer?.files?.[0]; if (f && f.type?.startsWith('image/')) decodeImageFile(f) }
function pickQrImage() { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = (e) => { const f = e.target.files?.[0]; if (f) decodeImageFile(f) }; i.click() }
async function pasteQrImage() {
  try {
    const items = await navigator.clipboard.read()
    for (const it of items) { const type = it.types.find((x) => x.startsWith('image/')); if (type) return decodeImageFile(await it.getType(type)) }
    showToast(t('tool.qr.notFound'))
  } catch {}
}
async function copyDecoded() { if (!qrDecoded.value) return; try { await navigator.clipboard.writeText(qrDecoded.value); showToast(t('toast.copied')) } catch {} }

// RSA — encrypt/decrypt (OAEP) or sign/verify (PSS). Keys are PEM. rsa.js is lazy-loaded.
const rsaPurpose = ref('encrypt') // 'encrypt' | 'sign'
const rsaBits = ref(2048)
const rsaPub = ref('')
const rsaPriv = ref('')
const rsaInput = ref('')
const rsaOut = ref('') // ciphertext / plaintext, or the signature (sign purpose)
const rsaMsg = ref('')
const rsaOk = ref(false)
const rsaBusy = ref(false)
async function genRsa() {
  rsaBusy.value = true; rsaMsg.value = ''
  try {
    const { generateRsaKeys } = await import('../tools/text/rsa')
    const { publicKey, privateKey } = await generateRsaKeys(rsaPurpose.value, rsaBits.value)
    rsaPub.value = publicKey; rsaPriv.value = privateKey
    showToast(t('tool.rsa.generated'))
  } catch { showToast(t('tool.rsa.failed')) } finally { rsaBusy.value = false }
}
async function runRsa(op) {
  rsaMsg.value = ''; rsaOk.value = false
  try {
    const rsa = await import('../tools/text/rsa')
    if (op === 'encrypt') rsaOut.value = await rsa.rsaEncrypt(rsaInput.value, rsaPub.value)
    else if (op === 'decrypt') rsaOut.value = await rsa.rsaDecrypt(rsaInput.value, rsaPriv.value)
    else if (op === 'sign') rsaOut.value = await rsa.rsaSign(rsaInput.value, rsaPriv.value)
    else if (op === 'verify') { const ok = await rsa.rsaVerify(rsaInput.value, rsaOut.value, rsaPub.value); rsaOk.value = ok; rsaMsg.value = ok ? t('tool.rsa.valid') : t('tool.rsa.invalid') }
  } catch { rsaMsg.value = t('tool.rsa.failed') }
}
async function copyText(text) { if (!text) return; try { await navigator.clipboard.writeText(text); showToast(t('toast.copied')) } catch {} }
function clearAll() { input.value = ''; output.value = ''; passphrase.value = '' }
function onDrop(e) {
  const f = e.dataTransfer?.files?.[0]
  if (f && f.type.startsWith('text')) { const r = new FileReader(); r.onload = () => { input.value = r.result }; r.readAsText(f) }
}
</script>

<template>
  <main class="toolbox" @dragover.prevent @drop.prevent="onDrop">
    <h1 class="sr-only">{{ m.h1 }}</h1>
    <ToolboxNav />
    <header class="tb-head">
      <h2>{{ pageTitle }}</h2>
      <p>{{ pageSub }}</p>
    </header>

    <div class="tb-io">
      <div v-if="def.mode !== 'qr' && def.mode !== 'rsa'" class="tb-pane">
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

      <!-- QR code: generate / decode -->
      <div v-else-if="def.mode === 'qr'" class="tb-qr">
        <div class="seg qr-seg">
          <button :class="{ on: qrMode === 'gen' }" @click="qrMode = 'gen'">{{ t('tool.qr.gen') }}</button>
          <button :class="{ on: qrMode === 'dec' }" @click="qrMode = 'dec'">{{ t('tool.qr.dec') }}</button>
        </div>

        <template v-if="qrMode === 'gen'">
          <textarea v-model="qrText" class="qr-input" spellcheck="false" :placeholder="t('tool.qr.placeholder')"></textarea>
          <div class="qr-opts">
            <label>{{ t('tool.qr.level') }}
              <select v-model="qrLevel"><option value="L">L</option><option value="M">M</option><option value="Q">Q</option><option value="H">H</option></select>
            </label>
            <label class="qr-size">{{ t('tool.qr.size') }}<input type="range" v-model.number="qrSize" min="128" max="512" step="16"><span class="qr-val">{{ qrSize }}</span></label>
          </div>
          <div class="qr-preview"><canvas ref="qrCanvas"></canvas></div>
          <div class="qr-actions">
            <button class="btn" :disabled="!qrText" @click="downloadQRPng">PNG</button>
            <button class="btn" :disabled="!qrText" @click="downloadQRSvg">SVG</button>
            <button class="btn" :disabled="!qrText" @click="copyQR">{{ t('tool.copy') }}</button>
          </div>
        </template>

        <template v-else>
          <div class="qr-drop" :class="{ over: qrDragOver }" @click="pickQrImage" @dragover.prevent="qrDragOver = true" @dragleave="qrDragOver = false" @drop.prevent="onQrDrop">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M20.5 14v.01M14 20.5v.01M20.5 20.5v.01M17.5 17.5v.01"/></svg>
            <span>{{ t('tool.qr.drop') }}</span>
          </div>
          <div class="qr-actions"><button class="btn" @click="pasteQrImage">{{ t('tool.qr.paste') }}</button></div>
          <div v-if="qrDecoded" class="tb-pane qr-decoded">
            <div class="tb-pane-head"><span>{{ t('tool.output') }}</span><div class="tb-actions"><button @click="copyDecoded">{{ t('tool.copy') }}</button></div></div>
            <textarea :value="qrDecoded" readonly spellcheck="false"></textarea>
          </div>
          <p v-else-if="qrDecErr" class="tb-hint">{{ t('tool.qr.notFound') }}</p>
        </template>
      </div>

      <!-- RSA: encrypt/decrypt or sign/verify -->
      <div v-else-if="def.mode === 'rsa'" class="tb-rsa">
        <div class="seg rsa-seg">
          <button :class="{ on: rsaPurpose === 'encrypt' }" @click="rsaPurpose = 'encrypt'">{{ t('tool.rsa.encMode') }}</button>
          <button :class="{ on: rsaPurpose === 'sign' }" @click="rsaPurpose = 'sign'">{{ t('tool.rsa.signMode') }}</button>
        </div>

        <div class="tb-pane">
          <div class="tb-pane-head"><span>{{ t('tool.rsa.pub') }}</span><div class="tb-actions"><button @click="copyText(rsaPub)">{{ t('tool.copy') }}</button></div></div>
          <textarea v-model="rsaPub" class="rsa-key" spellcheck="false" placeholder="-----BEGIN PUBLIC KEY-----"></textarea>
        </div>
        <div class="tb-pane">
          <div class="tb-pane-head"><span>{{ t('tool.rsa.priv') }}</span><div class="tb-actions"><button @click="copyText(rsaPriv)">{{ t('tool.copy') }}</button></div></div>
          <textarea v-model="rsaPriv" class="rsa-key" spellcheck="false" placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
        </div>
        <div class="rsa-genrow">
          <label>{{ t('tool.rsa.size') }}<select v-model.number="rsaBits"><option :value="2048">2048</option><option :value="4096">4096</option></select></label>
          <button class="btn" :disabled="rsaBusy" @click="genRsa">{{ rsaBusy ? '…' : t('tool.rsa.gen') }}</button>
        </div>

        <div class="tb-pane">
          <div class="tb-pane-head"><span>{{ rsaPurpose === 'encrypt' ? t('tool.input') : t('tool.rsa.text') }}</span></div>
          <textarea v-model="rsaInput" class="rsa-io" spellcheck="false" :placeholder="rsaPurpose === 'encrypt' ? t('tool.rsa.inEnc') : t('tool.rsa.inSign')"></textarea>
        </div>

        <div class="rsa-run">
          <template v-if="rsaPurpose === 'encrypt'">
            <button class="btn primary" @click="runRsa('encrypt')">{{ t('tool.rsa.encBtn') }}</button>
            <button class="btn" @click="runRsa('decrypt')">{{ t('tool.rsa.decBtn') }}</button>
          </template>
          <template v-else>
            <button class="btn primary" @click="runRsa('sign')">{{ t('tool.rsa.signBtn') }}</button>
            <button class="btn" @click="runRsa('verify')">{{ t('tool.rsa.verifyBtn') }}</button>
          </template>
        </div>

        <div class="tb-pane">
          <div class="tb-pane-head"><span>{{ rsaPurpose === 'sign' ? t('tool.rsa.sig') : t('tool.output') }}</span><div class="tb-actions"><button @click="copyText(rsaOut)">{{ t('tool.copy') }}</button></div></div>
          <textarea v-model="rsaOut" class="rsa-io" spellcheck="false"></textarea>
        </div>
        <p v-if="rsaMsg" class="tb-hint" :class="{ 'rsa-ok': rsaOk }">{{ rsaMsg }}</p>
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
.tb-qr { display: flex; flex-direction: column; gap: 12px; }
.qr-seg { align-self: flex-start; }
.qr-input { min-height: 70px; border: 1px solid var(--border-light); border-radius: 10px; background: var(--surface); padding: 10px 12px; font-family: var(--font-mono); font-size: 13px; color: var(--text); outline: none; resize: vertical; }
.qr-input:focus { border-color: var(--accent); }
.qr-opts { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; font-size: 13px; color: var(--text-secondary); }
.qr-opts label { display: flex; align-items: center; gap: 8px; }
.qr-opts select { padding: 5px 8px; border: 1px solid var(--border-light); border-radius: 7px; background: var(--surface); color: var(--text); font-family: var(--font-sans); }
.qr-size { flex: 1; min-width: 180px; }
.qr-size input[type=range] { flex: 1; }
.qr-val { font-variant-numeric: tabular-nums; min-width: 34px; text-align: right; }
.qr-preview { display: flex; justify-content: center; padding: 16px; background: var(--surface); border: 1px solid var(--border-light); border-radius: 12px; }
.qr-preview canvas { max-width: 100%; height: auto; image-rendering: pixelated; border-radius: 4px; }
.qr-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.qr-drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 40px 20px; border: 2px dashed var(--border); border-radius: 12px; color: var(--text-secondary); font-size: 13px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.qr-drop:hover, .qr-drop.over { border-color: var(--accent); background: var(--accent-bg); }
.qr-drop svg { width: 34px; height: 34px; color: var(--text-tertiary); }
.qr-decoded textarea { width: 100%; min-height: 80px; border: none; background: transparent; padding: 12px; font-family: var(--font-mono); font-size: 13px; line-height: 1.6; color: var(--text); outline: none; resize: vertical; word-break: break-all; }
.tb-rsa { display: flex; flex-direction: column; gap: 12px; }
.rsa-seg { align-self: flex-start; }
.rsa-key { width: 100%; min-height: 84px; border: none; background: transparent; padding: 10px 12px; font-family: var(--font-mono); font-size: 12px; line-height: 1.5; color: var(--text); outline: none; resize: vertical; word-break: break-all; }
.rsa-genrow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 13px; color: var(--text-secondary); }
.rsa-genrow label { display: flex; align-items: center; gap: 8px; }
.rsa-genrow select { padding: 5px 8px; border: 1px solid var(--border-light); border-radius: 7px; background: var(--surface); color: var(--text); font-family: var(--font-sans); }
.rsa-io { width: 100%; min-height: 72px; border: none; background: transparent; padding: 12px; font-family: var(--font-mono); font-size: 13px; line-height: 1.6; color: var(--text); outline: none; resize: vertical; word-break: break-all; }
.rsa-run { display: flex; gap: 8px; flex-wrap: wrap; }
.rsa-ok { color: var(--status-ok, #34c759); font-weight: 600; }
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
