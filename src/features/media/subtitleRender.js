// Client-only canvas rendering + recording for the Subtitle Studio. Draws a styled subtitle frame
// (background gradient / blurred cover + the active caption with fade, outline, shadow) and records
// audio + the canvas to a WebM via captureStream() + MediaRecorder. NO top-level side effects: every
// browser global (canvas, MediaRecorder, AudioContext) is touched only inside these functions, which
// are reached via dynamic import() from client-only handlers — so importing this during SSG is safe.
//
// Chinese renders with the browser's own system fonts (the v1 decision) because the canvas uses a
// system font stack; nothing is shipped. drawFrame is shared by the live preview and the recorder so
// what you see is what you export.
import { BASE_HEIGHT, activeSegmentIndex, fadeAlpha, wrapLines } from './subtitleStudio'

// ---------------------------------------------------------------------------
// Frame drawing (pure w.r.t. the passed 2D context; caller owns canvas sizing / DPR transform)
// ---------------------------------------------------------------------------

// Draw the full frame into `ctx` at logical size width×height.
//   drawFrame(ctx, { width, height, time, segments, style, cover, duration, activeIndex, forceAlpha })
// `cover` is an optional drawable (Image/ImageBitmap/Canvas) for the blurred-artwork background.
// `activeIndex` overrides the time→segment lookup (used to preview a chosen segment while paused);
// `forceAlpha` overrides the fade (so a paused preview shows the caption fully).
export function drawFrame(ctx, {
  width, height, time = 0, segments = [], style = {}, cover = null, duration = 0,
  activeIndex = null, forceAlpha = null,
} = {}) {
  if (!ctx || !width || !height) return
  drawBackground(ctx, { width, height, style, cover })

  const idx = activeIndex != null ? activeIndex : activeSegmentIndex(segments, time)
  const seg = idx >= 0 ? segments[idx] : null
  const text = seg ? String(seg.text || '').trim() : ''
  if (!seg || !text) return

  const alpha = forceAlpha != null ? forceAlpha : fadeAlpha(time, seg.start, seg.end, style.fade)
  if (alpha <= 0) return
  drawCaption(ctx, { width, height, text, style, alpha })
}

function drawBackground(ctx, { width, height, style, cover }) {
  ctx.save()
  ctx.clearRect(0, 0, width, height)

  const wantCover = style.background === 'cover' && cover
  if (wantCover) {
    // Cover-fit the artwork with a slight overscan so the blur's soft edge stays off-canvas.
    try {
      const iw = cover.width || cover.videoWidth || width
      const ih = cover.height || cover.videoHeight || height
      const scale = Math.max(width / iw, height / ih) * 1.14
      const dw = iw * scale
      const dh = ih * scale
      ctx.filter = 'blur(28px)'
      ctx.drawImage(cover, (width - dw) / 2, (height - dh) / 2, dw, dh)
      ctx.filter = 'none'
    } catch { /* fall through to a dark wash */ }
    // Darken for caption legibility.
    ctx.fillStyle = 'rgba(0,0,0,0.42)'
    ctx.fillRect(0, 0, width, height)
  } else {
    const [a, b] = Array.isArray(style.gradient) && style.gradient.length === 2 ? style.gradient : ['#26262b', '#050506']
    const g = ctx.createLinearGradient(0, 0, width * 0.35, height)
    g.addColorStop(0, a)
    g.addColorStop(1, b)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, width, height)
    // Soft radial glow toward the center for a little depth (monochrome, subtle).
    const r = ctx.createRadialGradient(width / 2, height * 0.42, height * 0.05, width / 2, height * 0.5, height * 0.85)
    r.addColorStop(0, 'rgba(255,255,255,0.06)')
    r.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = r
    ctx.fillRect(0, 0, width, height)
  }

  // Bottom scrim helps a lower-third caption read over any background.
  if (style.position === 'lower') {
    const s = ctx.createLinearGradient(0, height * 0.55, 0, height)
    s.addColorStop(0, 'rgba(0,0,0,0)')
    s.addColorStop(1, 'rgba(0,0,0,0.5)')
    ctx.fillStyle = s
    ctx.fillRect(0, height * 0.55, width, height * 0.45)
  }
  ctx.restore()
}

function drawCaption(ctx, { width, height, text, style, alpha }) {
  const scale = height / BASE_HEIGHT
  const fontPx = Math.max(10, Math.round((Number(style.fontSize) || 34) * scale))
  const weight = style.bold ? '700' : '400'
  ctx.save()
  ctx.font = `${weight} ${fontPx}px ${style.fontFamily || 'sans-serif'}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha))

  const maxWidth = width * 0.86
  const lines = wrapLines(text, maxWidth, (s) => ctx.measureText(s).width)
  const lineHeight = fontPx * 1.3
  const blockH = lines.length * lineHeight

  let top
  const pos = style.position || 'lower'
  if (pos === 'top') top = height * 0.10
  else if (pos === 'center') top = height / 2 - blockH / 2
  else top = height * 0.9 - blockH // lower third: block bottom near 90%

  const x = width / 2
  const outlineW = Math.max(2, fontPx * 0.14)

  lines.forEach((line, i) => {
    const y = top + i * lineHeight + lineHeight / 2
    // Shadow pass (soft drop) — applied under the stroke/fill.
    if (style.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)'
      ctx.shadowBlur = fontPx * 0.35
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = fontPx * 0.06
    }
    if (style.outline) {
      ctx.lineJoin = 'round'
      ctx.lineWidth = outlineW
      ctx.strokeStyle = style.outlineColor || 'rgba(0,0,0,0.85)'
      ctx.strokeText(line, x, y)
    }
    // Crisp fill on top, without the shadow doubling up.
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
    ctx.fillStyle = style.color || '#ffffff'
    ctx.fillText(line, x, y)
  })
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Capability detection
// ---------------------------------------------------------------------------

// The best-supported WebM mime type for MediaRecorder, or '' if none / no MediaRecorder.
export function pickWebmMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  const cands = [
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
  ]
  for (const c of cands) { try { if (MediaRecorder.isTypeSupported(c)) return c } catch { /* ignore */ } }
  return ''
}

// True when the browser can record a canvas stream to WebM (canvas.captureStream + MediaRecorder +
// a supported webm type). False on browsers that lack these (some mobile Safari) so the UI can
// degrade to subtitle export / ffmpeg burn with a clear message.
export function isRecordingSupported() {
  if (typeof document === 'undefined') return false
  const canCapture = typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
  return canCapture && typeof MediaRecorder !== 'undefined' && !!pickWebmMimeType()
}

// ---------------------------------------------------------------------------
// Recording (real-time)
// ---------------------------------------------------------------------------

function waitEvent(el, name, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); el.removeEventListener(name, done); resolve() }
    const timer = setTimeout(done, timeoutMs)
    el.addEventListener(name, done, { once: true })
  })
}

// Record audio (from `file`) + the styled canvas to a WebM Blob, in REAL TIME (a 3-minute song takes
// ~3 minutes). Drives the canvas via requestAnimationFrame off the media element's clock. Supports
// cancellation via an AbortSignal. Resolves to a Blob; rejects with Error('recording-unsupported'),
// Error('play-failed'), or a DOMException('AbortError') on cancel.
//   renderSubtitledVideo({ file, segments, style, width, height, cover, duration, fps, onProgress, signal })
export async function renderSubtitledVideo({
  file, segments = [], style = {}, width, height, cover = null, duration = 0, fps = 30, onProgress, signal,
} = {}) {
  if (!isRecordingSupported()) throw new Error('recording-unsupported')
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  const url = URL.createObjectURL(file)
  const media = document.createElement('audio')
  media.src = url
  media.preload = 'auto'
  media.muted = false
  // Attach off-screen: some engines (and headless) won't advance a fully-detached media element.
  media.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
  document.body.appendChild(media)
  try { media.load() } catch { /* ignore */ }
  await waitEvent(media, 'loadedmetadata')
  const dur = duration > 0 ? duration : (Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0)

  // Audio track: prefer a WebAudio MediaStreamDestination (reliable, and keeps the render silent
  // since we don't connect to the speakers). Fall back to the element's own captureStream.
  let ac = null
  let audioTracks = []
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (AC) {
      ac = new AC()
      const srcNode = ac.createMediaElementSource(media)
      const dest = ac.createMediaStreamDestination()
      srcNode.connect(dest) // full-level tap for the recording
      // Silent monitor to a real sink: without a route to ac.destination the graph doesn't pull, so
      // the media element stalls (currentTime stuck at 0) and never plays. gain 0 keeps it silent.
      const monitor = ac.createGain()
      monitor.gain.value = 0
      srcNode.connect(monitor)
      monitor.connect(ac.destination)
      await ac.resume().catch(() => {})
      audioTracks = dest.stream.getAudioTracks()
    }
  } catch { audioTracks = [] }
  if (!audioTracks.length) {
    try { const ms = media.captureStream?.() || media.mozCaptureStream?.(); if (ms) audioTracks = ms.getAudioTracks() } catch { /* none */ }
  }

  const canvasStream = canvas.captureStream(fps)
  const stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks])
  const mimeType = pickWebmMimeType()
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: Math.round(width * height * fps * 0.12) })
  const chunks = []
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
  const stopped = new Promise((res) => { rec.onstop = res })

  let raf = 0
  let aborted = false
  const onAbort = () => { aborted = true }
  signal?.addEventListener?.('abort', onAbort)

  const drawAt = (t) => drawFrame(ctx, { width, height, time: t, segments, style, cover, duration: dur })
  drawAt(0)

  const cleanup = () => {
    cancelAnimationFrame(raf)
    try { media.pause() } catch { /* ignore */ }
    try { media.remove() } catch { /* ignore */ }
    try { canvasStream.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
    try { audioTracks.forEach((t) => t.stop()) } catch { /* ignore */ }
    try { ac?.close() } catch { /* ignore */ }
    try { URL.revokeObjectURL(url) } catch { /* ignore */ }
    signal?.removeEventListener?.('abort', onAbort)
  }

  try {
    rec.start(1000) // periodic chunks; reassembled into one Blob at stop
    try { media.currentTime = 0 } catch { /* ignore */ }
    await media.play().catch(() => { throw new Error('play-failed') })

    await new Promise((resolve) => {
      const finish = () => resolve()
      media.addEventListener('ended', finish, { once: true })
      const loop = () => {
        const t = media.currentTime
        drawAt(t)
        if (onProgress && dur > 0) onProgress(Math.max(0, Math.min(1, t / dur)))
        if (aborted || media.ended || (dur > 0 && t >= dur - 0.02)) { resolve(); return }
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    })

    cancelAnimationFrame(raf)
    drawAt(dur || media.currentTime) // final frame (last caption faded out)
    try { rec.requestData?.() } catch { /* ignore */ }
    if (rec.state !== 'inactive') rec.stop()
    await stopped
  } finally {
    cleanup()
  }

  if (aborted) throw new DOMException('aborted', 'AbortError')
  return new Blob(chunks, { type: mimeType || 'video/webm' })
}

// Load an image File/Blob or object URL into an HTMLImageElement usable as a cover background.
// Resolves to the Image (decoded), or null on failure. Client-only.
export async function loadCoverImage(source) {
  if (!source || typeof document === 'undefined') return null
  const url = typeof source === 'string' ? source : URL.createObjectURL(source)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await (img.decode ? img.decode() : waitEvent(img, 'load'))
    return img
  } catch {
    return null
  } finally {
    if (typeof source !== 'string') setTimeout(() => { try { URL.revokeObjectURL(url) } catch { /* ignore */ } }, 0)
  }
}
