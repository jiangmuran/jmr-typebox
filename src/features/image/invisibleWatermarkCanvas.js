// src/features/image/invisibleWatermarkCanvas.js
// Thin bridge between Blob/canvas and the pure invisibleWatermark codec. All math lives in
// invisibleWatermark.js (unit-tested); this only moves pixels in and out of a canvas.
import { loadImageFromBlob, makeCanvas, canvasToBlob } from './canvasUtils'
import { encode, decodeMultiScale, packRecord, FORMAT_VERSION } from './invisibleWatermark'

async function imageDataOf(blob) {
  const img = await loadImageFromBlob(blob)
  const w = img.naturalWidth, h = img.naturalHeight
  const canvas = makeCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  return { ctx, canvas, data: ctx.getImageData(0, 0, w, h), w, h }
}

export async function embedImageBlob(blob, { content, timestamp, flags = 0, version = FORMAT_VERSION, delta, coefIndex } = {}) {
  const { ctx, canvas, data, w, h } = await imageDataOf(blob)
  const record = packRecord({ version, flags, timestamp, content })
  const marked = encode(data.data, w, h, record, { delta, coefIndex })
  ctx.putImageData(new ImageData(marked, w, h), 0, 0)
  return canvasToBlob(canvas, 'image/png')
}

export async function decodeImageBlob(blob, opts = {}) {
  const { data, w, h } = await imageDataOf(blob)
  return decodeMultiScale(data.data, w, h, opts)
}
