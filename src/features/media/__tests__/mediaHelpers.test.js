import { describe, it, expect } from 'vitest'
import {
  mimeForFormat, extForFormat, buildOutputName, formatSize, isLossyFormat,
  parseBitrate, encodeWav, floatToInt16, MEDIA_CONVERTERS, converterForRoute,
} from '../mediaHelpers'
import { ALL_PATHS } from '../../../router/meta'

describe('media helpers', () => {
  it('mime + ext for known formats', () => {
    expect(mimeForFormat('mp3')).toBe('audio/mpeg')
    expect(mimeForFormat('wav')).toBe('audio/wav')
    expect(extForFormat('.MP3')).toBe('mp3')
  })

  it('output filename swaps extension', () => {
    expect(buildOutputName('song.mp3', 'wav')).toBe('song.wav')
    expect(buildOutputName('a.b.wav', 'mp3')).toBe('a.b.mp3')
  })

  it('lossy detection + bitrate parse', () => {
    expect(isLossyFormat('mp3')).toBe(true)
    expect(isLossyFormat('wav')).toBe(false)
    expect(parseBitrate('192k')).toBe(192)
    expect(parseBitrate('')).toBe(192)
    expect(parseBitrate('320')).toBe(320)
  })

  it('formatSize', () => {
    expect(formatSize(500)).toBe('500 B')
    expect(formatSize(2048)).toBe('2.0 KB')
  })

  it('floatToInt16 clamps to the 16-bit range', () => {
    const i = floatToInt16(new Float32Array([0, 1, -1, 2, -2]))
    expect([...i]).toEqual([0, 32767, -32768, 32767, -32768])
  })

  it('encodeWav writes a valid 16-bit PCM header (mono)', () => {
    const buf = encodeWav([new Float32Array([0, 0.5, -0.5])], 44100)
    const view = new DataView(buf)
    const tag = o => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3))
    expect(tag(0)).toBe('RIFF')
    expect(tag(8)).toBe('WAVE')
    expect(tag(36)).toBe('data')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint16(34, true)).toBe(16)
    expect(buf.byteLength).toBe(44 + 3 * 2)
  })

  it('encodeWav interleaves stereo channels', () => {
    const buf = encodeWav([new Float32Array([0, 0]), new Float32Array([0, 0])], 48000)
    expect(new DataView(buf).getUint16(22, true)).toBe(2)
    expect(buf.byteLength).toBe(44 + 2 * 2 * 2)
  })

  it('every /media/* route has a converter', () => {
    for (const p of ALL_PATHS.filter(x => x.startsWith('/media/')))
      expect(converterForRoute(p), p).toBeTruthy()
    expect(MEDIA_CONVERTERS.length).toBeGreaterThanOrEqual(2)
  })
})
