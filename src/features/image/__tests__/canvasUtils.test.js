import { describe, it, expect } from 'vitest'
import { imageFilesFromEvent, imageFileFromEvent } from '../canvasUtils'

// Minimal stand-ins — the helpers only touch .type/.kind/.getAsFile, no real File needed.
const img = (name) => ({ type: 'image/png', name })
const txt = () => ({ type: 'text/plain' })
const item = (f) => ({ kind: 'file', type: f.type, getAsFile: () => f })

describe('imageFilesFromEvent', () => {
  it('collects image files from a drop event (dataTransfer.files)', () => {
    const a = img('a.png'), b = img('b.png')
    expect(imageFilesFromEvent({ dataTransfer: { files: [a, txt(), b] } })).toEqual([a, b])
  })
  it('collects image files from a paste event (clipboardData.files)', () => {
    // Regression: the batch helper used to read only dataTransfer, so window-paste
    // on batch pages (invisible watermark, convert, compose) silently did nothing.
    const a = img('shot.png')
    expect(imageFilesFromEvent({ clipboardData: { files: [a] } })).toEqual([a])
  })
  it('falls back to clipboardData.items when files is empty (screenshot paste)', () => {
    const a = img('screenshot.png')
    const e = { clipboardData: { files: [], items: [{ kind: 'string', type: 'text/html' }, item(a)] } }
    expect(imageFilesFromEvent(e)).toEqual([a])
  })
  it('returns [] when nothing image-like is present', () => {
    expect(imageFilesFromEvent({ clipboardData: { files: [txt()], items: [] } })).toEqual([])
    expect(imageFilesFromEvent({})).toEqual([])
  })
  it('stays consistent with the single-file helper on paste events', () => {
    const a = img('one.png')
    const e = { clipboardData: { files: [a] } }
    expect(imageFileFromEvent(e)).toBe(a)
    expect(imageFilesFromEvent(e)[0]).toBe(a)
  })
})
