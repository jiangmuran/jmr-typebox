<script setup>
// PowerPoint (.pptx) PREVIEW — clearly preview-only (editing pptx is out of scope; rendering it
// faithfully is hard). Each slide is drawn into a fixed-aspect stage with text/picture shapes
// positioned as percentages of the slide. If a slide has no positionable shapes, we fall back to
// rendering its extracted paragraph text so it never shows up blank.
import { ref, computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { formatBytes } from './officeHelpers'

const props = defineProps({
  // { slideW, slideH, slides:[{ index, paragraphs, text, shapes }] }
  model: { type: Object, required: true },
  fileName: { type: String, default: 'presentation' },
  fileSize: { type: Number, default: 0 },
})
const emit = defineEmits(['change-file'])

const { t } = useI18n()

const current = ref(0)
const count = computed(() => props.model.slides.length)
const slide = computed(() => props.model.slides[current.value] || props.model.slides[0])
const aspect = computed(() => {
  const w = props.model.slideW || 12192000
  const h = props.model.slideH || 6858000
  return `${w} / ${h}`
})

function go(i) { current.value = Math.max(0, Math.min(count.value - 1, i)) }
function prev() { go(current.value - 1) }
function next() { go(current.value + 1) }

// Does the current slide have any positionable shapes to render? If not → text fallback.
function hasShapes(s) { return s && Array.isArray(s.shapes) && s.shapes.length > 0 }

// A short thumbnail label: first non-empty paragraph, else "Slide N".
function thumbLabel(s) {
  const firstLine = (s.paragraphs || []).find(p => p.trim())
  return firstLine ? firstLine.slice(0, 40) : `${t('office.slide')} ${s.index}`
}

function boxStyle(box) {
  if (!box) return {}
  return {
    left: box.leftPct + '%',
    top: box.topPct + '%',
    width: box.widthPct + '%',
    height: box.heightPct + '%',
  }
}
function alignFor(a) {
  return a === 'ctr' ? 'center' : a === 'r' ? 'right' : a === 'just' ? 'justify' : 'left'
}
function paraText(p) {
  return (p.runs || []).map(r => r.text).join('')
}
</script>

<template>
  <div class="slide-viewer">
    <header class="pv-head">
      <div class="pv-file">
        <svg class="pv-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        <div class="pv-meta">
          <span class="pv-name" :title="fileName">{{ fileName }}.<span class="pv-ext">pptx</span></span>
          <span class="pv-sub">{{ formatBytes(fileSize) }} · {{ count }} {{ count === 1 ? t('office.slide') : t('office.slides') }}</span>
        </div>
      </div>
      <div class="pv-actions">
        <span class="pv-badge">{{ t('office.previewOnly') }}</span>
        <button class="pv-btn ghost" @click="emit('change-file')">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4"/><polyline points="12 1 12.5 4 9.5 4"/><polyline points="4 15 3.5 12 6.5 12"/></svg>
          {{ t('office.openAnother') }}
        </button>
      </div>
    </header>

    <div class="pv-body">
      <!-- Thumbnail rail -->
      <nav class="pv-rail" :aria-label="t('office.slides')">
        <button v-for="(s, i) in model.slides" :key="i" class="pv-thumb" :class="{ on: i === current }" @click="go(i)">
          <span class="pv-thumb-n">{{ i + 1 }}</span>
          <span class="pv-thumb-t">{{ thumbLabel(s) }}</span>
        </button>
      </nav>

      <!-- Stage -->
      <div class="pv-stage-wrap">
        <div class="pv-stage" :style="{ aspectRatio: aspect }">
          <!-- Positioned shapes -->
          <template v-if="hasShapes(slide)">
            <template v-for="(sh, si) in slide.shapes" :key="si">
              <img v-if="sh.type === 'image'" class="pv-img" :style="boxStyle(sh.box)" :src="sh.src" :alt="t('office.image')" loading="lazy" />
              <div v-else class="pv-text" :style="boxStyle(sh.box)">
                <p v-for="(p, pi) in sh.paragraphs" :key="pi" :style="{ textAlign: alignFor(p.align) }">
                  <template v-for="(run, ri) in p.runs" :key="ri"><b v-if="run.bold && run.italic"><i>{{ run.text }}</i></b><b v-else-if="run.bold">{{ run.text }}</b><i v-else-if="run.italic">{{ run.text }}</i><template v-else>{{ run.text }}</template></template><template v-if="!p.runs.length">&nbsp;</template>
                </p>
              </div>
            </template>
          </template>
          <!-- Text-only fallback -->
          <div v-else class="pv-fallback">
            <span class="pv-fallback-tag">{{ t('office.textFallback') }}</span>
            <template v-if="slide.paragraphs.length">
              <p v-for="(line, li) in slide.paragraphs" :key="li">{{ line || ' ' }}</p>
            </template>
            <p v-else class="pv-empty">{{ t('office.emptySlide') }}</p>
          </div>
        </div>

        <!-- Controls -->
        <div class="pv-nav">
          <button class="pv-navbtn" :disabled="current === 0" @click="prev" :title="t('office.prev')">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="10 3 5 8 10 13"/></svg>
          </button>
          <span class="pv-count">{{ current + 1 }} / {{ count }}</span>
          <button class="pv-navbtn" :disabled="current === count - 1" @click="next" :title="t('office.next')">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 3 11 8 6 13"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.slide-viewer { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.pv-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border-light); flex-wrap: wrap; }
.pv-file { display: flex; align-items: center; gap: 11px; min-width: 0; }
.pv-ic { width: 26px; height: 26px; color: #d2691e; flex-shrink: 0; }
.pv-meta { display: flex; flex-direction: column; min-width: 0; }
.pv-name { font-size: 14px; font-weight: 650; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pv-ext { color: var(--text-tertiary); font-weight: 500; }
.pv-sub { font-size: 11px; color: var(--text-secondary); }
.pv-actions { display: flex; align-items: center; gap: 8px; }
.pv-badge { font-size: 11px; font-weight: 600; color: var(--text-secondary); background: var(--surface-hover); border: 1px solid var(--border-light); padding: 4px 9px; border-radius: 99px; }
.pv-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 13px; border-radius: 9px; font-size: 12.5px; font-weight: 600; font-family: var(--font-sans); cursor: pointer; border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary); transition: all 0.15s; }
.pv-btn svg { width: 14px; height: 14px; }
.pv-btn.ghost:hover { background: var(--surface-hover); color: var(--text); }

.pv-body { flex: 1; display: flex; min-height: 0; }
.pv-rail { width: 168px; flex-shrink: 0; overflow-y: auto; border-right: 1px solid var(--border-light); padding: 10px; display: flex; flex-direction: column; gap: 7px; }
.pv-thumb { display: flex; align-items: flex-start; gap: 8px; padding: 9px 10px; border: 1px solid var(--border-light); border-radius: 9px; background: var(--surface); cursor: pointer; text-align: left; transition: all 0.15s; }
.pv-thumb:hover { background: var(--surface-hover); }
.pv-thumb.on { border-color: var(--accent); background: var(--accent-bg); }
.pv-thumb-n { font-size: 11px; font-weight: 700; color: var(--text-tertiary); flex-shrink: 0; min-width: 14px; }
.pv-thumb.on .pv-thumb-n { color: var(--accent); }
.pv-thumb-t { font-size: 11px; line-height: 1.35; color: var(--text-secondary); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

.pv-stage-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 22px; overflow: auto; }
.pv-stage { position: relative; width: 100%; max-width: 880px; background: #fff; color: #1a1a1a; border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow-lg); overflow: hidden; }
.pv-img { position: absolute; object-fit: contain; }
.pv-text { position: absolute; overflow: hidden; display: flex; flex-direction: column; justify-content: center; }
.pv-text p { margin: 0; font-size: clamp(11px, 1.9vw, 19px); line-height: 1.3; word-break: break-word; }
/* When a text box has no geometry, span the slide so it's still readable. */
.pv-text:not([style*="left"]) { position: static; padding: 6%; height: 100%; }

.pv-fallback { position: absolute; inset: 0; padding: 7% 8%; overflow: auto; display: flex; flex-direction: column; gap: 4px; }
.pv-fallback-tag { align-self: flex-start; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #b45309; background: #fff7ed; border: 1px solid #fed7aa; padding: 2px 7px; border-radius: 5px; margin-bottom: 8px; }
.pv-fallback p { margin: 0; font-size: clamp(12px, 1.8vw, 17px); line-height: 1.4; color: #222; word-break: break-word; }
.pv-empty { color: #888 !important; font-style: italic; }

.pv-nav { display: flex; align-items: center; gap: 14px; }
.pv-navbtn { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); cursor: pointer; transition: all 0.15s; }
.pv-navbtn svg { width: 16px; height: 16px; }
.pv-navbtn:hover:not(:disabled) { background: var(--surface-hover); }
.pv-navbtn:disabled { opacity: 0.4; cursor: default; }
.pv-count { font-size: 13px; font-weight: 600; color: var(--text-secondary); font-variant-numeric: tabular-nums; min-width: 56px; text-align: center; }

@media (max-width: 700px) {
  .pv-body { flex-direction: column; }
  .pv-rail { width: 100%; flex-direction: row; border-right: none; border-bottom: 1px solid var(--border-light); overflow-x: auto; overflow-y: hidden; }
  .pv-thumb { flex-shrink: 0; width: 130px; }
  .pv-stage-wrap { padding: 16px; }
}
</style>
