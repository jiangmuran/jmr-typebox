import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  useImageUpload,
  validateImageFile,
  resolveEndpoint,
  parseUploadResponse,
  ImageUploadError,
  MAX_IMAGE_BYTES,
} from '../useImageUpload'
import { useSettings } from '../useSettings'

function imageFile({ type = 'image/png', size = 1024, name = 'pic.png' } = {}) {
  // A real File (jsdom) so FormData.append accepts it; bytes give it a deterministic size.
  return new File([new Uint8Array(size)], name, { type })
}

describe('validateImageFile', () => {
  it('accepts an image under the limit', () => {
    expect(validateImageFile(imageFile())).toBe(true)
  })
  it('rejects a non-image with code "type"', () => {
    try { validateImageFile(imageFile({ type: 'application/pdf' })); throw new Error('should throw') }
    catch (e) { expect(e).toBeInstanceOf(ImageUploadError); expect(e.code).toBe('type') }
  })
  it('rejects an oversized image with code "size"', () => {
    try { validateImageFile(imageFile({ size: MAX_IMAGE_BYTES + 1 })); throw new Error('should throw') }
    catch (e) { expect(e.code).toBe('size') }
  })
  it('rejects a missing file with code "empty"', () => {
    try { validateImageFile(null); throw new Error('should throw') }
    catch (e) { expect(e.code).toBe('empty') }
  })
})

describe('resolveEndpoint', () => {
  it('uses the same-origin proxy when no custom host is set', () => {
    expect(resolveEndpoint({})).toEqual({ url: '/api/upload', direct: false, key: '' })
  })
  it('uses a direct upload with the user key when a custom host is set', () => {
    expect(resolveEndpoint({ imageHostUrl: ' https://h/up ', imageHostKey: ' k ' }))
      .toEqual({ url: 'https://h/up', direct: true, key: 'k' })
  })
})

describe('parseUploadResponse', () => {
  it('reads {url}', () => expect(parseUploadResponse({ url: 'https://h/a.png' })).toBe('https://h/a.png'))
  it('reads {data:{url}}', () => expect(parseUploadResponse({ data: { url: 'https://h/b.png' } })).toBe('https://h/b.png'))
  it('reads {link}', () => expect(parseUploadResponse({ link: 'https://h/c.png' })).toBe('https://h/c.png'))
  it('parses a JSON string body', () => expect(parseUploadResponse('{"url":"https://h/d.png"}')).toBe('https://h/d.png'))
  it('accepts a bare URL string', () => expect(parseUploadResponse('https://h/e.png')).toBe('https://h/e.png'))
  it('returns empty for unknown shapes', () => expect(parseUploadResponse({ foo: 1 })).toBe(''))
})

// ── XHR-driven upload flow ──────────────────────────────────────────────────────────────
// Install a fake XMLHttpRequest so we can drive upload.onprogress + load deterministically.
class FakeXHR {
  constructor() { this.upload = {}; this.headers = {}; this.status = 200; this.responseText = '' }
  open(method, url) { this.method = method; this.url = url }
  setRequestHeader(k, v) { this.headers[k] = v }
  send(body) {
    FakeXHR.last = this
    this.body = body
    // Emit progress then load on the next tick.
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 })
      this.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 })
      this.responseText = FakeXHR.responseText
      this.status = FakeXHR.status
      if (FakeXHR.status >= 200 && FakeXHR.status < 300) this.onload?.()
      else this.onload?.() // non-2xx is still delivered via onload (per spec)
    })
  }
  abort() { this.onabort?.() }
}

let OriginalXHR
beforeEach(() => {
  OriginalXHR = globalThis.XMLHttpRequest
  globalThis.XMLHttpRequest = FakeXHR
  FakeXHR.responseText = JSON.stringify({ url: 'https://files.muran.tech/z.png' })
  FakeXHR.status = 200
  FakeXHR.last = null
  // Reset settings to defaults between tests.
  const { settings } = useSettings()
  settings.imageHostUrl = ''
  settings.imageHostKey = ''
})
afterEach(() => { globalThis.XMLHttpRequest = OriginalXHR; vi.restoreAllMocks() })

describe('useImageUpload.uploadImage', () => {
  it('uploads to the proxy by default, reports progress, and resolves the url', async () => {
    const { uploadImage } = useImageUpload()
    const seen = []
    const url = await uploadImage(imageFile(), { onProgress: p => seen.push(p) })
    expect(url).toBe('https://files.muran.tech/z.png')
    expect(FakeXHR.last.url).toBe('/api/upload')
    expect(FakeXHR.last.headers.Authorization).toBeUndefined() // proxy adds the key server-side
    expect(seen).toEqual([0.5, 1])
    expect(FakeXHR.last.body).toBeInstanceOf(FormData)
  })

  it('uploads directly with a Bearer header when a custom host is configured', async () => {
    const { settings } = useSettings()
    settings.imageHostUrl = 'https://my.host/up'
    settings.imageHostKey = 'mykey'
    const { uploadImage } = useImageUpload()
    await uploadImage(imageFile())
    expect(FakeXHR.last.url).toBe('https://my.host/up')
    expect(FakeXHR.last.headers.Authorization).toBe('Bearer mykey')
  })

  it('rejects a non-image before sending any request', async () => {
    const { uploadImage } = useImageUpload()
    await expect(uploadImage(imageFile({ type: 'text/plain' }))).rejects.toMatchObject({ code: 'type' })
    expect(FakeXHR.last).toBeNull()
  })

  it('rejects an oversized image before sending any request', async () => {
    const { uploadImage } = useImageUpload()
    await expect(uploadImage(imageFile({ size: MAX_IMAGE_BYTES + 1 }))).rejects.toMatchObject({ code: 'size' })
    expect(FakeXHR.last).toBeNull()
  })

  it('surfaces an upstream error body as an ImageUploadError', async () => {
    FakeXHR.status = 502
    FakeXHR.responseText = JSON.stringify({ error: 'upstream boom' })
    const { uploadImage } = useImageUpload()
    await expect(uploadImage(imageFile())).rejects.toThrow(/upstream boom/)
  })
})
