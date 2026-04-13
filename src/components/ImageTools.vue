<script setup>
import { ref, computed } from 'vue'
import { useToast } from '../composables/useToast'

const props = defineProps({ t: Function })
const { showToast } = useToast()

const imageFile = ref(null)
const imageName = ref('')
const imageUrl = ref('')
const imageSize = ref(0)
const outputFormat = ref('png')
const quality = ref(85)
const maxWidth = ref(0)
const base64Output = ref('')

function formatSize(b) {
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / (1024 * 1024)).toFixed(2) + ' MB'
}

function handleFile(file) {
  if (!file?.type.startsWith('image/')) return
  imageFile.value = file; imageName.value = file.name; imageSize.value = file.size
  base64Output.value = ''
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = URL.createObjectURL(file)
}

function pickFile() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'
  input.onchange = e => { if (e.target.files[0]) handleFile(e.target.files[0]) }; input.click()
}

function onDrop(e) { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f) }

async function convertAndDownload() {
  if (!imageFile.value) return
  const img = new Image(); img.crossOrigin = 'anonymous'; img.src = imageUrl.value
  await new Promise(r => { img.onload = r })
  const w = maxWidth.value > 0 ? Math.min(maxWidth.value, img.naturalWidth) : img.naturalWidth
  const h = Math.round(img.naturalHeight * (w / img.naturalWidth))
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
  canvas.getContext('2d').drawImage(img, 0, 0, w, h)
  const mime = outputFormat.value === 'jpg' ? 'image/jpeg' : outputFormat.value === 'webp' ? 'image/webp' : 'image/png'
  const q = outputFormat.value === 'png' ? undefined : quality.value / 100
  canvas.toBlob(blob => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `${imageName.value.replace(/\.\w+$/, '')}.${outputFormat.value}`; a.click()
    URL.revokeObjectURL(a.href)
    showToast(`${formatSize(blob.size)} ${outputFormat.value.toUpperCase()}`)
  }, mime, q)
}

async function toBase64() {
  if (!imageFile.value) return
  const reader = new FileReader()
  reader.onload = async () => {
    base64Output.value = reader.result
    try { await navigator.clipboard.writeText(reader.result); showToast(props.t('toast.copied')) }
    catch { showToast('Base64 generated') }
  }
  reader.readAsDataURL(imageFile.value)
}

function reset() {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageFile.value = null; imageName.value = ''; imageUrl.value = ''; base64Output.value = ''
}
</script>

<template>
  <div class="tool-panel" @dragover.prevent @drop="onDrop">
    <div class="tool-inner">
      <!-- Empty -->
      <div v-if="!imageFile" class="upload-zone" @click="pickFile">
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="8" width="40" height="32" rx="4"/>
          <circle cx="16" cy="20" r="4"/>
          <path d="M44 32l-12-10-10 8-6-4L4 34"/>
        </svg>
        <h3>{{ t('img.drop') }}</h3>
        <p>{{ t('img.browse') }}</p>
      </div>

      <!-- Image loaded -->
      <template v-if="imageFile">
        <div class="preview-card">
          <img :src="imageUrl" :alt="imageName" />
          <div class="preview-meta">
            <span>{{ imageName }}</span>
            <span>{{ formatSize(imageSize) }}</span>
            <button class="link-btn" @click="reset">{{ t('img.change') }}</button>
          </div>
        </div>

        <div class="controls-card">
          <div class="ctrl">
            <label>{{ t('img.format') }}</label>
            <div class="seg">
              <button :class="{on: outputFormat==='png'}" @click="outputFormat='png'">PNG</button>
              <button :class="{on: outputFormat==='jpg'}" @click="outputFormat='jpg'">JPG</button>
              <button :class="{on: outputFormat==='webp'}" @click="outputFormat='webp'">WebP</button>
            </div>
          </div>
          <div v-if="outputFormat !== 'png'" class="ctrl">
            <label>{{ t('img.quality') }}: {{ quality }}%</label>
            <input type="range" v-model.number="quality" min="10" max="100" step="5" />
          </div>
          <div class="ctrl">
            <label>{{ t('img.maxWidth') }}</label>
            <input type="number" v-model.number="maxWidth" min="0" max="8000" step="100" class="num-input" placeholder="0" />
          </div>
          <div class="ctrl-row">
            <button class="btn primary" @click="convertAndDownload">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M14 10v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V10"/><polyline points="5 7 8 10 11 7"/><line x1="8" y1="10" x2="8" y2="2"/></svg>
              {{ t('img.download') }}
            </button>
            <button class="btn" @click="toBase64">{{ t('img.base64') }}</button>
          </div>
        </div>

        <div v-if="base64Output" class="base64-card">
          <div class="base64-head">
            <span>Base64 ({{ formatSize(base64Output.length) }})</span>
            <button class="link-btn" @click="navigator.clipboard.writeText(base64Output).then(() => showToast(t('toast.copied')))">Copy</button>
          </div>
          <textarea readonly :value="base64Output"></textarea>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tool-panel { flex: 1; overflow-y: auto; background: var(--bg); }
.tool-inner { max-width: 520px; margin: 0 auto; padding: 24px 20px 40px; animation: toolIn 0.35s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes toolIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

.upload-zone {
  display: flex; flex-direction: column; align-items: center; padding: 52px 40px;
  border: 2px dashed var(--border); border-radius: 14px; background: var(--surface);
  cursor: pointer; text-align: center; transition: all 0.25s;
}
.upload-zone:hover { border-color: var(--accent); background: var(--accent-bg); transform: translateY(-2px); }
.upload-zone svg { width: 48px; height: 48px; color: var(--text-tertiary); margin-bottom: 14px; }
.upload-zone h3 { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
.upload-zone p { font-size: 13px; color: var(--text-secondary); }

.preview-card { background: var(--surface); border: 1px solid var(--border-light); border-radius: 12px; overflow: hidden; }
.preview-card img { width: 100%; max-height: 280px; object-fit: contain; background: var(--code-bg); display: block; }
.preview-meta { display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 11px; color: var(--text-secondary); border-top: 1px solid var(--border-light); }
.preview-meta span:first-child { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.link-btn { border: none; background: none; color: var(--accent); font-size: 11px; cursor: pointer; font-family: var(--font-sans); }
.link-btn:hover { text-decoration: underline; }

.controls-card { background: var(--surface); border: 1px solid var(--border-light); border-radius: 12px; padding: 14px; margin-top: 12px; display: flex; flex-direction: column; gap: 12px; }
.ctrl label { display: block; font-size: 11px; font-weight: 500; color: var(--text-secondary); margin-bottom: 5px; }

.seg { display: flex; background: var(--surface-hover); border-radius: 7px; padding: 2px; gap: 2px; }
.seg button { flex: 1; padding: 5px; border: none; border-radius: 5px; font-size: 11px; font-weight: 500; background: transparent; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; font-family: var(--font-sans); }
.seg button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }

input[type="range"] { width: 100%; accent-color: var(--accent); }
.num-input { width: 100%; padding: 7px 10px; border: 1px solid var(--border-light); border-radius: 6px; background: var(--surface-hover); color: var(--text); font-size: 12px; font-family: var(--font-mono); outline: none; }
.num-input:focus { border-color: var(--accent); }

.ctrl-row { display: flex; gap: 8px; }
.btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 12px; font-weight: 500; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; }
.btn:hover { background: var(--surface-hover); }
.btn:active { transform: scale(0.98); }
.btn svg { width: 14px; height: 14px; }
.btn.primary { background: var(--text); color: var(--bg); border-color: var(--text); }
.btn.primary:hover { opacity: 0.9; }

.base64-card { background: var(--surface); border: 1px solid var(--border-light); border-radius: 12px; overflow: hidden; margin-top: 12px; }
.base64-head { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border-light); font-size: 11px; color: var(--text-secondary); }
.base64-card textarea { width: 100%; height: 80px; padding: 10px; border: none; background: transparent; color: var(--text); font-family: var(--font-mono); font-size: 10px; resize: vertical; outline: none; }
</style>
