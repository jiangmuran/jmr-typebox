<script setup>
// /admin — the player's admin surface. A single route that switches between four views based
// on the auth state machine in useAuth:
//   • loading      — initial session probe in flight
//   • no-setup     — operator hasn't run `wrangler secret put BOOTSTRAP_TOKEN` yet
//   • bind         — first passkey binding (bootstrap token → navigator.credentials.create)
//   • login        — returning-user biometric login
//   • authenticated — dashboard with Status / 网易云账号 / 安全 tabs
//
// Also handles `?otp=xxx` query links — a logged-in admin generates a one-time link, opens it on
// a new device, and this page redeems it automatically (establishes a 5-min session for adding
// that device's passkey).
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useI18n } from '../composables/useI18n'
import { useToast } from '../composables/useToast'
import ClientOnly from '../components/ClientOnly.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const { t } = useI18n()
const { showToast } = useToast()

// Dashboard tab.
const tab = ref('status') // 'status' | 'ncm' | 'security' | 'stats' | 'logs'

// ---- Phase 4: statistics + real-time logs (SSE) ----
const statsData = ref(null)     // snapshot from GET /api/admin/stats
const liveFeed = ref([])        // ring of recent { type, ts, ... } events from SSE
const sseConnected = ref(false)
let sseSource = null

function connectSSE() {
  if (sseSource || typeof window === 'undefined' || !window.EventSource) return
  try {
    sseSource = new EventSource('/api/admin/stats/stream', { withCredentials: true })
    sseSource.addEventListener('hello', (e) => {
      sseConnected.value = true
      try {
        const snap = JSON.parse(e.data)
        statsData.value = snap
        // Seed the live feed with the snapshot's recent + logs.
        const seed = [
          ...(snap.recent || []).map((r) => ({ type: 'request', ...r })),
          ...(snap.logs || []).map((l) => ({ type: 'log', ...l })),
        ].sort((a, b) => b.ts - a.ts).slice(0, 100)
        liveFeed.value = seed
      } catch { /* ignore parse errors */ }
    })
    sseSource.addEventListener('request', (e) => {
      try {
        const data = JSON.parse(e.data)
        liveFeed.value.unshift({ type: 'request', ...data })
        if (liveFeed.value.length > 100) liveFeed.value.pop()
        // Bump counters locally (so the dashboard updates even without a full refresh).
        if (statsData.value) {
          statsData.value.totals = statsData.value.totals || { total: 0, ok: 0, blocked_ip: 0, blocked_rate: 0, blocked_auth: 0, errors: 0 }
          statsData.value.totals.total = (statsData.value.totals.total || 0) + 1
          if (data.status >= 200 && data.status < 300) statsData.value.totals.ok = (statsData.value.totals.ok || 0) + 1
          else if (data.status === 403) statsData.value.totals.blocked_ip = (statsData.value.totals.blocked_ip || 0) + 1
          else if (data.status === 429) statsData.value.totals.blocked_rate = (statsData.value.totals.blocked_rate || 0) + 1
          else if (data.status === 401) statsData.value.totals.blocked_auth = (statsData.value.totals.blocked_auth || 0) + 1
          else if (data.status >= 500) statsData.value.totals.errors = (statsData.value.totals.errors || 0) + 1
        }
      } catch { /* ignore */ }
    })
    sseSource.addEventListener('log', (e) => {
      try {
        const data = JSON.parse(e.data)
        liveFeed.value.unshift({ type: 'log', ...data })
        if (liveFeed.value.length > 100) liveFeed.value.pop()
      } catch { /* ignore */ }
    })
    sseSource.onerror = () => { sseConnected.value = false }
  } catch { /* EventSource unsupported — dashboard degrades to manual refresh */ }
}
function disconnectSSE() {
  if (sseSource) { try { sseSource.close() } catch { /* ignore */ } sseSource = null }
  sseConnected.value = false
}
async function refreshStats() {
  try {
    const res = await fetch('/api/admin/stats', { credentials: 'include' })
    if (res.ok) statsData.value = await res.json()
  } catch { /* ignore */ }
}
// Auto-connect when the user opens the stats/logs tab; disconnect otherwise (saves the
// long-lived SSE connection when they're elsewhere).
watch(tab, (t) => {
  if (t === 'stats' || t === 'logs') { refreshStats(); connectSSE() }
  else disconnectSSE()
})
onBeforeUnmount(() => disconnectSSE())

const logLevelFilter = ref(new Set(['info', 'warn', 'error']))  // 'debug' off by default
function toggleLogLevel(lvl) {
  const s = new Set(logLevelFilter.value)
  if (s.has(lvl)) s.delete(lvl); else s.add(lvl)
  logLevelFilter.value = s
}
const filteredFeed = computed(() => {
  return liveFeed.value.filter((e) => {
    if (e.type === 'request') return true
    if (e.type === 'log') return logLevelFilter.value.has(e.level)
    return false
  })
})
const topPaths = computed(() => {
  if (!statsData.value?.counters) return []
  return Object.entries(statsData.value.counters)
    .map(([path, c]) => ({ path, ...c }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
})
const maxTotal = computed(() => topPaths.value.reduce((m, p) => Math.max(m, p.total), 1))
function fmtTime(ts) { return ts ? new Date(ts).toLocaleTimeString() : '' }

// Bind-flow inputs.
const bootstrapToken = ref('')
const bindNickname = ref('')

// One-time link generation UI.
const oneTimeLink = ref(null) // { url, expiresAt }

// IP allowlist editor.
const ipAllowlistDraft = ref('')
const ipDirty = computed(() => {
  const current = (auth.status.value?.ipAllowlist || []).join('\n')
  return ipAllowlistDraft.value !== current
})

// NCM cookie editor.
const ncmCookieDraft = ref('')

// NCM QR login state.
const qrUrl = ref('')
const qrKey = ref('')
const qrStatus = ref('') // 'idle' | 'waiting' | 'scanned' | 'confirming' | 'expired' | 'done'
let qrPollTimer = null

onMounted(async () => {
  // Auto-redeem a one-time link if ?otp= is in the URL.
  const otp = route.query.otp
  if (otp && typeof otp === 'string') {
    const ok = await auth.redeemOneTimeLink(otp)
    if (ok) {
      showToast(t('admin.otpRedeemed'))
      router.replace({ path: '/admin' }) // strip ?otp from the URL
    } else {
      showToast(t('admin.otpInvalid'))
    }
    return
  }
  await auth.probe()
})

// ---- IP allowlist editor sync ----
function syncIpDraft() {
  if (auth.status.value) {
    ipAllowlistDraft.value = (auth.status.value.ipAllowlist || []).join('\n')
  }
}
function onStatusLoaded() { syncIpDraft() }
// Watch status changes (after probe/loadStatus) — cheap re-sync.
watch(() => auth.status.value, onStatusLoaded)

async function saveIpAllowlist() {
  const ips = ipAllowlistDraft.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
  const ok = await auth.setIpAllowlist(ips)
  showToast(ok ? t('admin.ipSaved') : (auth.error.value || t('admin.ipSaveFailed')))
}

// ---- NCM cookie management ----
async function saveNcmCookie() {
  const cookie = (ncmCookieDraft.value || '').trim()
  if (!cookie) return
  const ok = await auth.setNcmCookie(cookie)
  showToast(ok ? t('admin.cookieSaved') : (auth.error.value || t('admin.cookieSaveFailed')))
  if (ok) ncmCookieDraft.value = ''
}
async function clearNcm() {
  if (!confirm(t('admin.cookieClearConfirm'))) return
  const ok = await auth.clearNcmCookie()
  showToast(ok ? t('admin.cookieCleared') : (auth.error.value || t('admin.failed')))
}

// ---- NCM QR-code login flow ----
async function startQrLogin() {
  qrStatus.value = 'waiting'
  try {
    const res = await fetch('/api/admin/ncm/qrcode/key', {
      method: 'POST',
      credentials: 'include',
    })
    const body = await res.json()
    if (!body?.data?.unikey) throw new Error('no unikey')
    qrKey.value = body.data.unikey
    // Build the qrurl locally (worker's login_qr_create returns just the URL string).
    qrUrl.value = `https://music.163.com/login?codekey=${qrKey.value}`
    // Render QR with the existing `qrcode` dep on the client (worker doesn't render images).
    pollQrLogin()
  } catch (e) {
    qrStatus.value = 'expired'
    showToast(t('admin.qrStartFailed'))
  }
}

async function pollQrLogin() {
  if (qrPollTimer) clearTimeout(qrPollTimer)
  if (!qrKey.value) return
  try {
    const res = await fetch(`/api/admin/ncm/qrcode/check/${qrKey.value}`, { credentials: 'include' })
    const body = await res.json()
    const code = body.code
    if (code === 800) { qrStatus.value = 'expired'; return }
    if (code === 801) { qrStatus.value = 'waiting' }
    else if (code === 802) { qrStatus.value = 'scanned' }
    else if (code === 803) {
      // 803 = success. body.cookie contains the joined MUSIC_U cookie string — persist via admin.
      qrStatus.value = 'done'
      const cookie = body.cookie
      if (cookie) {
        await auth.setNcmCookie(cookie)
        showToast(t('admin.qrLoggedIn'))
      }
      return
    }
    qrPollTimer = setTimeout(pollQrLogin, 2000)
  } catch {
    qrPollTimer = setTimeout(pollQrLogin, 3000)
  }
}

function stopQrLogin() {
  if (qrPollTimer) { clearTimeout(qrPollTimer); qrPollTimer = null }
  qrStatus.value = 'idle'
  qrKey.value = ''
  qrUrl.value = ''
}

// ---- one-time link generation ----
async function generateOneTimeLink() {
  const r = await auth.generateOneTimeLink()
  if (r) {
    oneTimeLink.value = r
  } else {
    showToast(auth.error.value || t('admin.failed'))
  }
}

// QR <img> rendering: use the existing `qrcode` npm dep to render the qrUrl into a data URL on
// the client (the worker deliberately doesn't ship image bytes).
const qrDataUrl = ref('')
watch(qrUrl, async (url) => {
  if (!url) { qrDataUrl.value = ''; return }
  try {
    const QRCode = (await import('qrcode')).default
    qrDataUrl.value = await QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: '#000000', light: '#ffffff' } })
  } catch { qrDataUrl.value = '' }
})

// Bind flow submit.
async function doBind() {
  const token = (bootstrapToken.value || '').trim()
  if (!token) return
  const nickname = (bindNickname.value || '').trim() || 'Device 1'
  const ok = await auth.bootstrap(token, { nickname })
  if (!ok) {
    showToast(auth.error.value || t('admin.bindFailed'))
  } else {
    showToast(t('admin.bound'))
  }
}

// Login submit.
async function doLogin() {
  const ok = await auth.login()
  if (!ok && auth.error.value) showToast(auth.error.value)
}

// Add-device (from inside dashboard).
async function doAddPasskey() {
  const ok = await auth.addPasskey({})
  showToast(ok ? t('admin.passkeyAdded') : (auth.error.value || t('admin.bindFailed')))
}

async function doRemovePasskey(id) {
  if (!confirm(t('admin.removePasskeyConfirm'))) return
  const ok = await auth.removePasskey(id)
  if (!ok) showToast(auth.error.value || t('admin.failed'))
}

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString()
}
function formatExpiry(ts) {
  if (!ts) return ''
  const sec = Math.floor((ts - Date.now()) / 1000)
  if (sec <= 0) return t('admin.expired')
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}m ${s}s`
}
</script>

<template>
  <!-- Real single-element root: a ClientOnly (fragment) root breaks the router-view's
       out-in page transition — navigating back from this page left a blank view. -->
  <div class="admin-route">
  <ClientOnly>
    <div class="admin-page">
      <h1 class="sr-only">{{ t('admin.title') }}</h1>

      <!-- LOADING -->
      <div v-if="auth.view.value === 'loading'" class="admin-loading">
        <div class="admin-spinner"></div>
        <p>{{ t('admin.loading') }}</p>
      </div>

      <!-- NO-SETUP (operator hasn't set BOOTSTRAP_TOKEN secret) -->
      <div v-else-if="auth.view.value === 'no-setup'" class="admin-card admin-no-setup">
        <h2>{{ t('admin.noSetupTitle') }}</h2>
        <p>{{ t('admin.noSetupBody') }}</p>
        <pre class="admin-code">npx wrangler secret put BOOTSTRAP_TOKEN</pre>
        <p class="admin-note">{{ t('admin.noSetupNote') }}</p>
      </div>

      <!-- BIND (first passkey) -->
      <div v-else-if="auth.view.value === 'bind'" class="admin-card admin-bind">
        <h2>{{ t('admin.bindTitle') }}</h2>
        <p class="admin-sub">{{ t('admin.bindSub') }}</p>
        <label class="admin-label">
          <span>{{ t('admin.bootstrapToken') }}</span>
          <input v-model="bootstrapToken" type="password" :placeholder="t('admin.tokenPlaceholder')" autocomplete="off" />
        </label>
        <label class="admin-label">
          <span>{{ t('admin.deviceName') }}</span>
          <input v-model="bindNickname" type="text" :placeholder="t('admin.deviceNamePlaceholder')" />
        </label>
        <button class="btn cta" :disabled="auth.busy.value || !bootstrapToken" @click="doBind">
          {{ auth.busy.value ? t('admin.working') : t('admin.bindAction') }}
        </button>
        <p v-if="auth.error.value" class="admin-error">{{ auth.error.value }}</p>
      </div>

      <!-- LOGIN (biometric) -->
      <div v-else-if="auth.view.value === 'login'" class="admin-card admin-login">
        <h2>{{ t('admin.loginTitle') }}</h2>
        <p class="admin-sub">{{ t('admin.loginSub') }}</p>
        <button class="btn primary admin-login-btn" :disabled="auth.busy.value" @click="doLogin">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          {{ auth.busy.value ? t('admin.working') : t('admin.loginAction') }}
        </button>
        <p v-if="auth.error.value" class="admin-error">{{ auth.error.value }}</p>
        <p class="admin-note">{{ t('admin.loginNoPasskey') }}</p>
      </div>

      <!-- AUTHENTICATED (dashboard) -->
      <div v-else-if="auth.view.value === 'authenticated'" class="admin-dashboard">
        <header class="admin-header">
          <h2>{{ t('admin.title') }}</h2>
          <button class="link-btn" @click="auth.logout()">{{ t('admin.logout') }}</button>
        </header>

        <div class="segbar admin-tabs">
          <button class="segbar-item" :class="{ active: tab === 'status' }" @click="tab = 'status'">{{ t('admin.tabStatus') }}</button>
          <button class="segbar-item" :class="{ active: tab === 'ncm' }" @click="tab = 'ncm'">{{ t('admin.tabNcm') }}</button>
          <button class="segbar-item" :class="{ active: tab === 'security' }" @click="tab = 'security'">{{ t('admin.tabSecurity') }}</button>
          <button class="segbar-item" :class="{ active: tab === 'stats' }" @click="tab = 'stats'">{{ t('admin.tabStats') }}</button>
          <button class="segbar-item" :class="{ active: tab === 'logs' }" @click="tab = 'logs'">{{ t('admin.tabLogs') }}</button>
        </div>

        <!-- STATUS -->
        <div v-show="tab === 'status'" class="admin-grid">
          <div class="admin-card stat">
            <div class="stat-label">{{ t('admin.statBootstrap') }}</div>
            <div class="stat-value" :class="{ ok: auth.status.value?.bootstrap?.used }">
              {{ auth.status.value?.bootstrap?.used ? t('admin.statBound') : t('admin.statUnbound') }}
            </div>
          </div>
          <div class="admin-card stat">
            <div class="stat-label">{{ t('admin.statPasskeys') }}</div>
            <div class="stat-value">{{ auth.status.value?.passkeyCount || 0 }}</div>
          </div>
          <div class="admin-card stat">
            <div class="stat-label">{{ t('admin.statNcmCookie') }}</div>
            <div class="stat-value" :class="{ ok: auth.status.value?.hasNcmCookie, warn: !auth.status.value?.hasNcmCookie }">
              {{ auth.status.value?.hasNcmCookie ? t('admin.statCookieActive') : t('admin.statCookieMissing') }}
            </div>
            <div v-if="auth.status.value?.cookieSource" class="stat-sub">{{ auth.status.value.cookieSource === 'qr-login' ? t('admin.cookieFromQr') : auth.status.value.cookieSource === 'env-secret' ? t('admin.cookieFromEnv') : '' }}</div>
          </div>
          <div class="admin-card stat">
            <div class="stat-label">{{ t('admin.statIpAllowlist') }}</div>
            <div class="stat-value">{{ auth.status.value?.ipAllowlist?.length || 0 }}</div>
          </div>
        </div>

        <!-- NCM ACCOUNT -->
        <div v-show="tab === 'ncm'" class="admin-section">
          <!-- QR-code login -->
          <div class="admin-card">
            <h3>{{ t('admin.qrLoginTitle') }}</h3>
            <p v-if="!qrUrl && qrStatus.value !== 'waiting'" class="admin-sub">{{ t('admin.qrLoginHint') }}</p>
            <div v-if="qrDataUrl" class="qr-stage">
              <img :src="qrDataUrl" alt="QR" class="qr-img" />
              <div class="qr-status" :class="qrStatus">{{ t('admin.qrStatus_' + qrStatus) }}</div>
              <button class="link-btn" @click="stopQrLogin">{{ t('admin.qrCancel') }}</button>
            </div>
            <button v-if="!qrDataUrl" class="btn primary" :disabled="qrStatus.value === 'waiting'" @click="startQrLogin">
              {{ qrStatus.value === 'waiting' ? t('admin.qrStarting') : t('admin.qrStart') }}
            </button>
          </div>

          <!-- Paste-cookie fallback -->
          <div class="admin-card">
            <h3>{{ t('admin.pasteCookieTitle') }}</h3>
            <p class="admin-sub">{{ t('admin.pasteCookieHint') }}</p>
            <textarea v-model="ncmCookieDraft" class="admin-textarea" :placeholder="t('admin.cookiePlaceholder')" rows="3"></textarea>
            <button class="btn primary" :disabled="!ncmCookieDraft" @click="saveNcmCookie">{{ t('admin.cookieSave') }}</button>
            <button v-if="auth.status.value?.hasNcmCookie" class="link-btn danger" @click="clearNcm">{{ t('admin.cookieClear') }}</button>
          </div>
        </div>

        <!-- SECURITY -->
        <div v-show="tab === 'security'" class="admin-section">
          <!-- IP allowlist -->
          <div class="admin-card">
            <h3>{{ t('admin.ipAllowlistTitle') }}</h3>
            <p class="admin-sub">{{ t('admin.ipAllowlistHint') }}</p>
            <textarea v-model="ipAllowlistDraft" class="admin-textarea" :placeholder="t('admin.ipPlaceholder')" rows="4"></textarea>
            <button class="btn primary" :disabled="!ipDirty" @click="saveIpAllowlist">{{ t('admin.ipSave') }}</button>
          </div>

          <!-- Passkey management -->
          <div class="admin-card">
            <h3>{{ t('admin.passkeysTitle') }} ({{ auth.status.value?.passkeyCount || 0 }})</h3>
            <ul class="passkey-list">
              <li v-for="pk in (auth.status.value?.passkeys || [])" :key="pk.id" class="passkey-row">
                <div>
                  <div class="passkey-name">{{ pk.nickname }}</div>
                  <div class="passkey-meta">{{ formatTime(pk.addedAt) }}</div>
                </div>
                <button class="link-btn danger" @click="doRemovePasskey(pk.id)" :disabled="(auth.status.value?.passkeyCount || 0) <= 1">{{ t('admin.removePasskey') }}</button>
              </li>
            </ul>
            <button class="btn primary" @click="doAddPasskey">{{ t('admin.addPasskey') }}</button>
          </div>

          <!-- One-time link -->
          <div class="admin-card">
            <h3>{{ t('admin.oneTimeLinkTitle') }}</h3>
            <p class="admin-sub">{{ t('admin.oneTimeLinkHint') }}</p>
            <button class="btn primary" @click="generateOneTimeLink">{{ t('admin.oneTimeLinkGenerate') }}</button>
            <div v-if="oneTimeLink" class="otp-result">
              <code class="otp-url">{{ oneTimeLink.url }}</code>
              <div class="otp-meta">{{ t('admin.oneTimeLinkExpires') }}: {{ formatExpiry(oneTimeLink.expiresAt) }}</div>
              <button class="link-btn" @click="navigator.clipboard.writeText(oneTimeLink.url)">{{ t('admin.copyLink') }}</button>
             </div>
           </div>
        </div>

        <!-- STATISTICS (Phase 4) -->
        <div v-show="tab === 'stats'" class="admin-section">
          <!-- Intercept overview -->
          <div class="admin-card">
            <h3>{{ t('admin.statsOverview') }}</h3>
            <div class="stats-overview">
              <div class="stat-block">
                <div class="stat-num ok">{{ statsData?.totals?.ok || 0 }}</div>
                <div class="stat-lbl">{{ t('admin.statsOk') }}</div>
              </div>
              <div class="stat-block">
                <div class="stat-num warn">{{ statsData?.totals?.blocked_ip || 0 }}</div>
                <div class="stat-lbl">{{ t('admin.statsBlockedIp') }}</div>
              </div>
              <div class="stat-block">
                <div class="stat-num warn">{{ statsData?.totals?.blocked_rate || 0 }}</div>
                <div class="stat-lbl">{{ t('admin.statsBlockedRate') }}</div>
              </div>
              <div class="stat-block">
                <div class="stat-num warn">{{ statsData?.totals?.blocked_auth || 0 }}</div>
                <div class="stat-lbl">{{ t('admin.statsBlockedAuth') }}</div>
              </div>
              <div class="stat-block">
                <div class="stat-num err">{{ statsData?.totals?.errors || 0 }}</div>
                <div class="stat-lbl">{{ t('admin.statsErrors') }}</div>
              </div>
            </div>
            <button class="link-btn" @click="refreshStats">{{ t('admin.statsRefresh') }}</button>
          </div>

          <!-- Per-path bar chart (pure SVG/divs, no chart lib) -->
          <div class="admin-card">
            <h3>{{ t('admin.statsByPath') }}</h3>
            <div v-if="topPaths.length" class="path-chart">
              <div v-for="p in topPaths" :key="p.path" class="path-row">
                <span class="path-name" :title="p.path">{{ p.path }}</span>
                <div class="path-bar-track">
                  <div class="path-bar-fill" :style="{ width: ((p.total / maxTotal) * 100) + '%' }"></div>
                </div>
                <span class="path-count">{{ p.total }}</span>
              </div>
            </div>
            <p v-else class="admin-sub">{{ t('admin.statsNoData') }}</p>
          </div>
        </div>

        <!-- LOGS (Phase 4 — real-time SSE) -->
        <div v-show="tab === 'logs'" class="admin-section">
          <div class="admin-card">
            <div class="logs-head">
              <h3>{{ t('admin.logsTitle') }}</h3>
              <div class="logs-meta">
                <span class="sse-status" :class="{ on: sseConnected }">{{ sseConnected ? t('admin.logsLive') : t('admin.logsOff') }}</span>
                <div class="log-filters">
                  <button v-for="lvl in ['debug', 'info', 'warn', 'error']" :key="lvl"
                    class="log-filter-btn" :class="[lvl, { on: logLevelFilter.has(lvl) }]"
                    @click="toggleLogLevel(lvl)">{{ lvl.toUpperCase() }}</button>
                </div>
              </div>
            </div>
            <div class="logs-stream">
              <div v-if="!filteredFeed.length" class="logs-empty">{{ t('admin.logsEmpty') }}</div>
              <div v-for="(e, i) in filteredFeed" :key="e.ts + '-' + i" class="log-entry" :class="e.type">
                <span class="log-ts">{{ fmtTime(e.ts) }}</span>
                <span v-if="e.type === 'request'" class="log-tag req" :class="{ ok: e.status < 300, blocked: e.status >= 400 }">{{ e.status }}</span>
                <span v-if="e.type === 'log'" class="log-tag" :class="e.level">{{ e.level.toUpperCase() }}</span>
                <span v-if="e.type === 'request'" class="log-msg">{{ e.path }} <span class="log-ip">{{ e.ip }}</span> · {{ e.latencyMs }}ms</span>
                <span v-else class="log-msg">{{ e.msg }}</span>
              </div>
            </div>
          </div>
        </div>
       </div>

      <p v-else class="admin-error">{{ auth.error.value || t('admin.unknownState') }}</p>
    </div>
  </ClientOnly>
  </div>
</template>

<style scoped>
.admin-route { flex: 1; min-height: 0; overflow-y: auto; }
.admin-page { max-width: var(--page-wide); margin: 0 auto; padding: 24px; min-height: 60vh; }
@media (max-width: 768px) { .admin-page { padding: 16px; } }

.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

.admin-loading { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 80px 20px; color: var(--text-tertiary); }
.admin-spinner { width: 28px; height: 28px; border: 3px solid var(--surface-active); border-top-color: var(--accent); border-radius: 50%; animation: tb-spin 0.9s linear infinite; }

.admin-card { background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--radius-lg); padding: 22px 24px; margin-bottom: 14px; }
.admin-card h2, .admin-card h3 { font-size: 18px; font-weight: 700; letter-spacing: -0.3px; margin-bottom: 8px; }
.admin-sub { font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 16px; }
.admin-note { font-size: 11.5px; color: var(--text-tertiary); margin-top: 14px; line-height: 1.5; }

.admin-bind, .admin-login, .admin-no-setup { max-width: 460px; margin: 40px auto; }
.admin-login { text-align: center; }
.admin-login-btn { width: 100%; padding: 12px; font-size: 14px; margin-top: 8px; }
.admin-login-btn svg { width: 18px; height: 18px; margin-right: 8px; vertical-align: middle; }

.admin-label { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; font-size: 12.5px; color: var(--text-secondary); }
.admin-label span { font-weight: 600; }
.admin-label input, .admin-textarea { padding: 9px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); color: var(--text); font-size: 13px; font-family: var(--font-sans); outline: none; transition: border-color 0.15s; }
.admin-label input:focus, .admin-textarea:focus { border-color: var(--accent); }
.admin-textarea { width: 100%; resize: vertical; font-family: var(--font-mono); font-size: 12px; }

.admin-code { background: var(--code-bg); padding: 10px 14px; border-radius: var(--radius); font-family: var(--font-mono); font-size: 12.5px; color: var(--text); overflow-x: auto; }

.admin-error { color: var(--status-warn); font-size: 13px; margin-top: 12px; }

.admin-dashboard { display: flex; flex-direction: column; gap: 14px; }
.admin-header { display: flex; align-items: center; justify-content: space-between; }
.admin-header h2 { font-size: 20px; font-weight: 750; letter-spacing: -0.4px; }
.admin-tabs { align-self: flex-start; }

.admin-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
@media (max-width: 768px) { .admin-grid { grid-template-columns: 1fr; } }

.stat { display: flex; flex-direction: column; gap: 4px; }
.stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.stat-value { font-size: 22px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
.stat-value.ok { color: var(--status-ok); }
.stat-value.warn { color: var(--status-warn); }
.stat-sub { font-size: 11.5px; color: var(--text-secondary); margin-top: 2px; }

.admin-section { display: flex; flex-direction: column; gap: 14px; }

.qr-stage { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 10px; }
.qr-img { width: 240px; height: 240px; border-radius: var(--radius); background: #fff; padding: 8px; }
.qr-status { font-size: 13px; color: var(--text-secondary); }
.qr-status.waiting { color: var(--text-tertiary); }
.qr-status.scanned { color: var(--status-warn); }
.qr-status.done { color: var(--status-ok); }
.qr-status.expired { color: var(--status-warn); }

.passkey-list { list-style: none; padding: 0; margin: 0 0 14px 0; }
.passkey-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--border-light); }
.passkey-row:last-child { border-bottom: none; }
.passkey-name { font-size: 13.5px; font-weight: 600; color: var(--text); }
.passkey-meta { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
.link-btn.danger { color: var(--status-warn); }
.link-btn.danger:disabled { opacity: 0.4; cursor: not-allowed; }

.otp-result { margin-top: 12px; padding: 12px; background: var(--code-bg); border-radius: var(--radius); display: flex; flex-direction: column; gap: 6px; }
.otp-url { font-family: var(--font-mono); font-size: 11.5px; word-break: break-all; color: var(--text); }
.otp-meta { font-size: 11px; color: var(--text-secondary); }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-size: 13px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; }
.btn:hover { border-color: var(--accent); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.primary { background: var(--text); color: var(--bg); border: none; }
.btn.cta { background: var(--accent); color: var(--accent-text); border: none; }
.btn.cta:hover { background: var(--accent-hover); }
.link-btn { background: none; border: none; color: var(--accent); font-family: var(--font-sans); font-size: 12.5px; cursor: pointer; padding: 4px 8px; }
.link-btn:hover { text-decoration: underline; }

.segbar { display: inline-flex; gap: 3px; padding: 3px; background: var(--surface-hover); border-radius: var(--radius); }
.segbar-item { padding: 7px 14px; border: none; border-radius: calc(var(--radius) - 4px); font-size: 12.5px; font-weight: 600; background: transparent; color: var(--text-secondary); cursor: pointer; font-family: var(--font-sans); transition: all 0.15s; }
.segbar-item.active { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }

/* Mobile: stack the tab bar full-width and make stats single-column. */
@media (max-width: 768px) {
  .admin-tabs { align-self: stretch; display: flex; }
  .admin-tabs .segbar-item { flex: 1; }
  .admin-card { padding: 18px 16px; }
  .admin-header h2 { font-size: 18px; }
}

/* Phase 4: Statistics + Logs */
.stats-overview { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 12px; }
@media (max-width: 768px) { .stats-overview { grid-template-columns: repeat(2, 1fr); } }
.stat-block { text-align: center; padding: 12px 6px; background: var(--surface-hover); border-radius: var(--radius); }
.stat-num { font-size: 22px; font-weight: 750; font-variant-numeric: tabular-nums; color: var(--text); }
.stat-num.ok { color: var(--status-ok); }
.stat-num.warn { color: var(--status-warn); }
.stat-num.err { color: var(--status-warn); }
.stat-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); margin-top: 4px; }

.path-chart { display: flex; flex-direction: column; gap: 6px; }
.path-row { display: flex; align-items: center; gap: 10px; font-size: 11.5px; }
.path-name { flex: 0 0 180px; font-family: var(--font-mono); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.path-bar-track { flex: 1; height: 18px; background: var(--surface-hover); border-radius: 4px; overflow: hidden; }
.path-bar-fill { height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.3s var(--ease-out); }
.path-count { flex: 0 0 40px; text-align: right; font-variant-numeric: tabular-nums; color: var(--text); font-weight: 600; }

.logs-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.logs-meta { display: flex; align-items: center; gap: 12px; }
.sse-status { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 99px; background: var(--surface-active); color: var(--text-tertiary); }
.sse-status.on { background: var(--status-ok-bg); color: var(--status-ok); }
.log-filters { display: flex; gap: 4px; }
.log-filter-btn { padding: 3px 7px; border: 1px solid var(--border-light); border-radius: 5px; background: var(--surface); color: var(--text-tertiary); font-size: 9.5px; font-weight: 700; cursor: pointer; font-family: var(--font-mono); opacity: 0.4; }
.log-filter-btn.on { opacity: 1; }
.log-filter-btn.debug.on { border-color: var(--text-tertiary); color: var(--text-tertiary); }
.log-filter-btn.info.on { border-color: var(--accent); color: var(--accent); }
.log-filter-btn.warn.on { border-color: var(--status-warn); color: var(--status-warn); }
.log-filter-btn.error.on { border-color: var(--status-warn); color: var(--status-warn); background: var(--status-warn-bg); }

.logs-stream { max-height: 50vh; overflow-y: auto; background: var(--code-bg); border-radius: var(--radius); padding: 10px; font-family: var(--font-mono); font-size: 11.5px; }
.logs-empty { color: var(--text-tertiary); text-align: center; padding: 20px; }
.log-entry { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; border-bottom: 1px solid color-mix(in srgb, var(--border-light) 50%, transparent); }
.log-entry:last-child { border-bottom: none; }
.log-ts { flex-shrink: 0; color: var(--text-tertiary); font-size: 10.5px; min-width: 60px; }
.log-tag { flex-shrink: 0; font-size: 9.5px; font-weight: 700; padding: 1px 5px; border-radius: 3px; min-width: 36px; text-align: center; }
.log-tag.req { background: var(--surface-active); color: var(--text-secondary); }
.log-tag.req.ok { background: var(--status-ok-bg); color: var(--status-ok); }
.log-tag.req.blocked { background: var(--status-warn-bg); color: var(--status-warn); }
.log-tag.info { background: var(--accent-bg); color: var(--accent); }
.log-tag.warn { background: var(--status-warn-bg); color: var(--status-warn); }
.log-tag.error { background: var(--status-warn-bg); color: var(--status-warn); }
.log-msg { flex: 1; min-width: 0; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.log-ip { color: var(--text-tertiary); }
</style>
