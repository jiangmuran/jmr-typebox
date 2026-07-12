<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../composables/useI18n'
import { combo } from '../utils/platform'

const emit = defineEmits(['close', 'set-locale'])
const { t, setLocale, locale } = useI18n()

const visible = ref(false)
const step = ref('lang') // 'lang' → 'intro'

onMounted(() => {
  if (!localStorage.getItem('tb-welcomed')) {
    visible.value = true
    document.addEventListener('keydown', onEscape)
  }
})

onUnmounted(() => document.removeEventListener('keydown', onEscape))

function onEscape(e) { if (e.key === 'Escape' && step.value === 'intro') dismiss() }

function chooseLang(lang) {
  setLocale(lang)
  emit('set-locale', lang)
  step.value = 'intro'
}

function dismiss() {
  localStorage.setItem('tb-welcomed', '1')
  visible.value = false
  document.removeEventListener('keydown', onEscape)
  emit('close')
}
</script>

<template>
  <Transition name="modal">
    <div v-if="visible" class="backdrop" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div class="card">

        <!-- ===== Step 1: Language ===== -->
        <Transition name="step" mode="out-in">
          <div v-if="step === 'lang'" key="lang" class="step-lang">
            <div class="lang-logo">
              <svg viewBox="0 0 48 48">
                <rect width="48" height="48" rx="12" class="logo-bg"/>
                <path d="M14 16h20M24 16v18" class="logo-t" stroke-width="4" stroke-linecap="round" fill="none"/>
              </svg>
            </div>
            <h2 id="welcome-title">{{ t('welcome.title') }}</h2>
            <p class="lang-sub">{{ t('welcome.chooseLang') }} / Choose your language</p>
            <div class="lang-btns">
              <button class="lang-btn" @click="chooseLang('en')">
                <span class="lang-flag">EN</span>
                <span class="lang-name">English</span>
              </button>
              <button class="lang-btn" @click="chooseLang('zh')">
                <span class="lang-flag">中</span>
                <span class="lang-name">中文</span>
              </button>
            </div>
          </div>

          <!-- ===== Step 2: Intro (i18n) ===== -->
          <div v-else key="intro" class="step-intro">
            <div class="intro-logo">
              <svg viewBox="0 0 40 40">
                <rect width="40" height="40" rx="10" class="logo-bg"/>
                <path d="M12 14h16M20 14v14" class="logo-t" stroke-width="3.2" stroke-linecap="round" fill="none"/>
              </svg>
            </div>

            <p class="intro-title">{{ t('welcome.intro') }}</p>
            <div class="features">
              <div class="feat">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2.5l3 3L7 16H4v-3z"/></svg>
                <div><strong>{{ t('welcome.tip.write.t') }}</strong><span>{{ t('welcome.tip.write.d') }}</span></div>
              </div>
              <div class="feat">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3l13 5-5 2-2 5z"/></svg>
                <div><strong>{{ t('welcome.tip.rc.t') }}</strong><span>{{ t('welcome.tip.rc.d') }}</span></div>
              </div>
              <div class="feat">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="9" cy="9" r="5.5"/><line x1="13" y1="13" x2="17.5" y2="17.5"/></svg>
                <div><strong>{{ t('welcome.tip.k.t').replace('{k}', combo('K')) }}</strong><span>{{ t('welcome.tip.k.d') }}</span></div>
              </div>
            </div>

            <div class="privacy-pill">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
                <rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/>
              </svg>
              {{ t('welcome.privacy') }}
            </div>

            <button class="go-btn" @click="dismiss">
              {{ t('welcome.start') }}
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="3" y1="8" x2="13" y2="8"/><polyline points="9 4 13 8 9 12"/></svg>
            </button>
          </div>
        </Transition>

      </div>
    </div>
  </Transition>
</template>

<style scoped>
.backdrop {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.5); backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px); padding: 16px;
}

.card {
  background: var(--surface); border-radius: 20px;
  padding: 36px 30px 28px; max-width: 400px; width: 100%;
  box-shadow: var(--shadow-lg); text-align: center;
  max-height: 90vh; overflow-y: auto;
}

.logo-bg { fill: var(--text); transition: fill 0.5s cubic-bezier(0.16,1,0.3,1); }
.logo-t { stroke: var(--bg); transition: stroke 0.5s cubic-bezier(0.16,1,0.3,1); }

/* Step: Language */
.step-lang { display: flex; flex-direction: column; align-items: center; }
.lang-logo { margin-bottom: 20px; }
.lang-logo svg { width: 56px; height: 56px; }
.step-lang h2 { font-size: 26px; font-weight: 800; letter-spacing: -0.8px; margin-bottom: 6px; }
.lang-sub { font-size: 14px; color: var(--text-secondary); margin-bottom: 28px; }

.lang-btns { display: flex; gap: 12px; width: 100%; }
.lang-btn {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 24px 16px; border: 2px solid var(--border-light); border-radius: 16px;
  background: var(--surface); cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16,1,0.3,1); font-family: var(--font-sans);
}
.lang-btn:hover { border-color: var(--accent); background: var(--accent-bg); transform: translateY(-3px); box-shadow: var(--shadow-md); }
.lang-btn:active { transform: translateY(0) scale(0.97); }
.lang-flag {
  width: 44px; height: 44px; border-radius: 12px; background: var(--surface-hover);
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 800; color: var(--text); transition: all 0.2s;
}
.lang-btn:hover .lang-flag { background: var(--accent); color: var(--accent-text); }
.lang-name { font-size: 14px; font-weight: 600; color: var(--text); }

/* Step: Intro */
.step-intro { display: flex; flex-direction: column; align-items: center; }
.intro-logo { margin-bottom: 20px; }
.intro-logo svg { width: 44px; height: 44px; }
.intro-title { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 14px; }
.features { text-align: left; display: flex; flex-direction: column; gap: 14px; width: 100%; margin-bottom: 20px; }
.feat { display: flex; gap: 10px; align-items: flex-start; }
.feat svg { width: 18px; height: 18px; color: var(--accent); flex-shrink: 0; margin-top: 2px; }
.feat strong { display: block; font-size: 13px; font-weight: 600; margin-bottom: 1px; }
.feat span { font-size: 11px; color: var(--text-secondary); line-height: 1.4; }

.privacy-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 999px;
  background: var(--status-ok-bg); color: var(--status-ok);
  font-size: 11px; font-weight: 500; margin-bottom: 20px;
}
.privacy-pill svg { width: 13px; height: 13px; }

.go-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 11px 32px; border: none; border-radius: 12px;
  background: var(--text); color: var(--bg);
  font-size: 14px; font-weight: 600; font-family: var(--font-sans);
  cursor: pointer; transition: all 0.2s;
}
.go-btn:hover { opacity: 0.9; transform: translateY(-1px); }
.go-btn:active { transform: scale(0.97); }
.go-btn svg { width: 14px; height: 14px; }

/* Transitions */
.modal-enter-active { transition: all 0.35s cubic-bezier(0.16,1,0.3,1); }
.modal-leave-active { transition: all 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .card { transform: scale(0.92) translateY(20px); opacity: 0; }
.modal-leave-to .card { transform: scale(0.95); opacity: 0; }
.modal-enter-active .card { transition: all 0.4s cubic-bezier(0.16,1,0.3,1) 0.05s; }
.modal-leave-active .card { transition: all 0.2s ease; }

.step-enter-active { transition: all 0.3s cubic-bezier(0.16,1,0.3,1); }
.step-leave-active { transition: all 0.15s ease; }
.step-enter-from { opacity: 0; transform: translateX(20px); }
.step-leave-to { opacity: 0; transform: translateX(-20px); }

@media (max-width: 420px) {
  .card { padding: 28px 20px 22px; border-radius: 16px; }
  .lang-btn { padding: 18px 12px; }
  .lang-flag { width: 38px; height: 38px; font-size: 16px; }
}
</style>
