import { ref } from 'vue'

// Cross-module file flow. A module "hands off" a File (or text) plus a `kind` hint, then navigates
// to a target route; the target module picks it up on mount via take(). State is a module-level
// singleton, so it survives client-side (SPA) navigation between modules but never persists to disk.
//
//   handoff.send(file, { kind: 'image', from: 'image/compress' })
//   router.push('/')                       // target module
//   const h = handoff.take('image')        // in the target's onMounted
//
// `kind` is a coarse type the target filters on: 'image' | 'audio' | 'video' | 'av' | 'text' | 'subtitle'.

const pending = ref(null) // { payload, kind, from, name } | null

// Which targets make sense for a given kind — drives the "Send to →" menu. Route + i18n key + the
// kind the target expects. Kept here so any module's send menu stays consistent.
export const HANDOFF_TARGETS = {
  image: [
    { route: '/', i18n: 'handoff.toEditor', kind: 'image' },
    { route: '/image/metadata', i18n: 'handoff.toImageMeta', kind: 'image' },
    { route: '/image/edit', i18n: 'handoff.toImageEdit', kind: 'image' },
  ],
  audio: [
    { route: '/media/compress', i18n: 'handoff.toCompress', kind: 'av' },
    { route: '/media/transcribe', i18n: 'handoff.toTranscribe', kind: 'av' },
    { route: '/media/metadata', i18n: 'handoff.toAudioMeta', kind: 'av' },
    { route: '/media/player', i18n: 'handoff.toPlayer', kind: 'av' },
  ],
  video: [
    { route: '/media/convert', i18n: 'handoff.toConvert', kind: 'av' },
    { route: '/media/compress', i18n: 'handoff.toCompress', kind: 'av' },
    { route: '/media/transcribe', i18n: 'handoff.toTranscribe', kind: 'av' },
    { route: '/media/subtitles', i18n: 'handoff.toSubtitles', kind: 'av' },
  ],
  text: [
    { route: '/', i18n: 'handoff.toEditor', kind: 'text' },
  ],
  subtitle: [
    { route: '/media/subtitles', i18n: 'handoff.toSubtitles', kind: 'subtitle' },
    { route: '/', i18n: 'handoff.toEditor', kind: 'text' },
  ],
}

export function useHandoff() {
  // Stage a payload (File | Blob | string) for the next module.
  function send(payload, { kind = '', from = '', name = '' } = {}) {
    pending.value = { payload, kind, from, name: name || payload?.name || '' }
  }
  // Consume the staged payload if its kind matches (or no filter). One-shot: clears after taking.
  function take(kinds) {
    const p = pending.value
    if (!p) return null
    if (kinds) {
      const list = Array.isArray(kinds) ? kinds : [kinds]
      if (p.kind && !list.includes(p.kind)) return null
    }
    pending.value = null
    return p
  }
  function peek() { return pending.value }
  function clear() { pending.value = null }
  function targetsFor(kind) { return HANDOFF_TARGETS[kind] || [] }
  return { send, take, peek, clear, targetsFor, pending }
}
