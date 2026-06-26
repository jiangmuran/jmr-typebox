import { describe, it, expect } from 'vitest'
import {
  VIDEO_FORMATS, VIDEO_OUTPUT_FORMATS, videoFormatDef, isVideoOutputFormat,
  mimeForFormat, extForFormat,
  VIDEO_SCALES, scaleFilter,
  buildVideoConvertArgs, buildVideoCompressArgs, buildAudioCompressArgs, buildAsrExtractArgs,
  estimateVideoSize, estimateAudioSize, bitrateKbps,
  CRF_RANGE, COMPRESS_VCODECS,
} from '../mediaHelpers'

describe('video format catalog', () => {
  it('knows the output containers + their codecs + mime/ext', () => {
    expect(VIDEO_OUTPUT_FORMATS).toEqual(expect.arrayContaining(['mp4', 'webm', 'mov', 'mkv', 'gif']))
    expect(videoFormatDef('mp4')).toMatchObject({ vcodec: 'libx264', acodec: 'aac', hasAudio: true })
    expect(videoFormatDef('webm')).toMatchObject({ vcodec: 'libvpx-vp9', acodec: 'libopus' })
    expect(videoFormatDef('gif')).toMatchObject({ hasAudio: false })
    expect(isVideoOutputFormat('mp4')).toBe(true)
    expect(isVideoOutputFormat('mp3')).toBe(false)
    // mime/ext helpers now resolve video formats too (not just audio).
    expect(mimeForFormat('mp4')).toBe('video/mp4')
    expect(mimeForFormat('webm')).toBe('video/webm')
    expect(extForFormat('mkv')).toBe('mkv')
  })
})

describe('scaleFilter', () => {
  it('builds a -2 (even, aspect-preserving) scale for a target height', () => {
    expect(scaleFilter(720)).toBe('scale=-2:720')
    expect(scaleFilter(1080)).toBe('scale=-2:1080')
  })
  it('returns empty for keep-source / invalid heights', () => {
    expect(scaleFilter(0)).toBe('')
    expect(scaleFilter('')).toBe('')
    expect(scaleFilter(-5)).toBe('')
    expect(scaleFilter(NaN)).toBe('')
  })
  it('VIDEO_SCALES leads with keep-source', () => {
    expect(VIDEO_SCALES[0].id).toBe('')
    expect(VIDEO_SCALES.some(s => s.height === 720)).toBe(true)
  })
})

describe('buildVideoConvertArgs', () => {
  it('mp4: x264 + crf + faststart + audio aac', () => {
    const a = buildVideoConvertArgs({ input: 'in.mov', output: 'out.mp4', format: 'mp4', crf: 23, audioBitrate: '160k' })
    expect(a[0]).toBe('-i'); expect(a[1]).toBe('in.mov')
    expect(a).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-crf', '23', '-c:a', 'aac', '-b:a', '160k']))
    expect(a).toEqual(expect.arrayContaining(['-movflags', '+faststart', '-pix_fmt', 'yuv420p']))
    expect(a[a.length - 1]).toBe('out.mp4')
  })
  it('applies a scale filter + fps when requested', () => {
    const a = buildVideoConvertArgs({ format: 'mp4', height: 720, fps: 30 })
    const vfIdx = a.indexOf('-vf')
    expect(vfIdx).toBeGreaterThan(-1)
    expect(a[vfIdx + 1]).toContain('scale=-2:720')
    expect(a).toEqual(expect.arrayContaining(['-r', '30']))
  })
  it('webm uses vp9 + opus + constant-quality (-b:v 0)', () => {
    const a = buildVideoConvertArgs({ format: 'webm', crf: 31 })
    expect(a).toEqual(expect.arrayContaining(['-c:v', 'libvpx-vp9', '-crf', '31', '-b:v', '0', '-c:a', 'libopus']))
  })
  it('gif builds a palette filtergraph and carries no audio', () => {
    const a = buildVideoConvertArgs({ format: 'gif', height: 480, fps: 12 })
    const vf = a[a.indexOf('-vf') + 1]
    expect(vf).toContain('palettegen')
    expect(vf).toContain('paletteuse')
    expect(vf).toContain('fps=12')
    expect(vf).toContain('scale=-2:480')
    expect(a).not.toContain('-c:a')
  })
  it('throws for an unknown video format', () => {
    expect(() => buildVideoConvertArgs({ format: 'avi-bogus' })).toThrow()
  })
})

describe('buildVideoCompressArgs', () => {
  it('h264 default: crf + medium preset + faststart + aac audio', () => {
    const a = buildVideoCompressArgs({ input: 'in.mp4', output: 'out.mp4', crf: 26, audioBitrate: '128k' })
    expect(a).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-crf', '26', '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k']))
    expect(a[a.length - 1]).toBe('out.mp4')
  })
  it('vp9 codec → opus audio + -b:v 0', () => {
    const a = buildVideoCompressArgs({ vcodec: 'vp9', crf: 30 })
    expect(a).toEqual(expect.arrayContaining(['-c:v', 'libvpx-vp9', '-b:v', '0', '-c:a', 'libopus']))
  })
  it('honors scale, fps, and a max-bitrate ceiling', () => {
    const a = buildVideoCompressArgs({ height: 480, fps: 24, maxBitrate: '2000k' })
    expect(a[a.indexOf('-vf') + 1]).toContain('scale=-2:480')
    expect(a).toEqual(expect.arrayContaining(['-r', '24', '-maxrate', '2000k', '-bufsize', '2000k']))
  })
  it('clamps a wild CRF into the codec range', () => {
    const a = buildVideoCompressArgs({ crf: 999 })
    const crf = Number(a[a.indexOf('-crf') + 1])
    expect(crf).toBeLessThanOrEqual(63)
    expect(crf).toBeGreaterThanOrEqual(0)
  })
  it('exposes the codec + CRF UI metadata', () => {
    expect(COMPRESS_VCODECS.map(c => c.id)).toEqual(['h264', 'vp9'])
    expect(CRF_RANGE.min).toBeLessThan(CRF_RANGE.default)
    expect(CRF_RANGE.default).toBeLessThan(CRF_RANGE.max)
  })
})

describe('buildAudioCompressArgs', () => {
  it('re-encodes to a lossy format at a target bitrate, dropping video', () => {
    const a = buildAudioCompressArgs({ input: 'in.wav', output: 'out.mp3', format: 'mp3', bitrate: '96k', channels: 1 })
    expect(a).toContain('-vn')
    expect(a).toEqual(expect.arrayContaining(['-c:a', 'libmp3lame', '-b:a', '96k', '-ac', '1']))
    expect(a[a.length - 1]).toBe('out.mp3')
  })
})

describe('buildAsrExtractArgs', () => {
  it('downsamples to mono 16k low-bitrate mp3 and strips video', () => {
    const a = buildAsrExtractArgs({ input: 'in.mp4', output: 'asr.mp3' })
    expect(a).toEqual(expect.arrayContaining(['-i', 'in.mp4', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame']))
    expect(a[a.length - 1]).toBe('asr.mp3')
  })
  it('adds a time window (-ss / -t) for chunked long media, in order', () => {
    const a = buildAsrExtractArgs({ input: 'in.mp4', output: 'asr.mp3', startSec: 600, durSec: 600 })
    const ssIdx = a.indexOf('-ss')
    const iIdx = a.indexOf('-i')
    const tIdx = a.indexOf('-t')
    expect(ssIdx).toBeGreaterThan(-1)
    expect(ssIdx).toBeLessThan(iIdx)            // -ss before -i (fast seek)
    expect(a[ssIdx + 1]).toBe('600')
    expect(tIdx).toBeGreaterThan(iIdx)          // -t after -i
    expect(a[tIdx + 1]).toBe('600')
  })
  it('omits the window for a single (whole-file) pass', () => {
    const a = buildAsrExtractArgs({ input: 'in.mp3', output: 'asr.mp3' })
    expect(a).not.toContain('-ss')
    expect(a).not.toContain('-t')
  })
})

describe('size estimate', () => {
  it('audio: bytes ≈ kbps × sec ÷ 8', () => {
    // 128 kbps × 60 s = 7,680,000 bits = 960,000 bytes.
    expect(estimateAudioSize({ durationSec: 60, bitrateKbps: 128 })).toBe(960000)
    expect(estimateAudioSize({ durationSec: 0 })).toBe(0)
    expect(estimateAudioSize({ durationSec: -1 })).toBe(0)
  })
  it('video estimate is finite, positive, and scales sensibly', () => {
    const small = estimateVideoSize({ durationSec: 60, crf: 30, width: 854, height: 480, fps: 30, audioBitrateKbps: 128 })
    const big = estimateVideoSize({ durationSec: 60, crf: 20, width: 1920, height: 1080, fps: 30, audioBitrateKbps: 128 })
    expect(small).toBeGreaterThan(0)
    expect(Number.isFinite(small)).toBe(true)
    // Lower CRF + higher resolution → meaningfully larger.
    expect(big).toBeGreaterThan(small)
  })
  it('video estimate respects a max-bitrate ceiling', () => {
    const capped = estimateVideoSize({ durationSec: 60, crf: 18, width: 1920, height: 1080, fps: 60, maxBitrateKbps: 1000, audioBitrateKbps: 0 })
    // 1000 kbps × 60 s ÷ 8 = 7,500,000 bytes — the cap dominates the huge-quality estimate.
    expect(capped).toBeLessThanOrEqual(7_500_000 + 1)
  })
  it('returns 0 when duration is unknown', () => {
    expect(estimateVideoSize({ durationSec: 0, crf: 23, width: 1920, height: 1080 })).toBe(0)
  })
  it('bitrateKbps parses tokens', () => {
    expect(bitrateKbps('128k')).toBe(128)
    expect(bitrateKbps('192')).toBe(192)
    expect(bitrateKbps(256)).toBe(256)
    expect(bitrateKbps('')).toBe(128)
    expect(bitrateKbps('320000')).toBe(320)
  })
})
