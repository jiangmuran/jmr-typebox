// Runtime integration test for the DOCX path. This is the highest-risk part of
// the suite: the @turbodocx browser bundle references a bare `global` and we shim
// it. jsdom provides Blob + DOM, so we can verify the lib loads via Vite's
// "browser" export, the shim prevents `global is not defined`, and a real
// .docx Blob comes back. (Skips automatically if the environment lacks Blob.)
import { describe, it, expect } from 'vitest'
import { markdownToDocxBlob } from '../utils/docx.js'

const hasBlob = typeof Blob !== 'undefined'

describe.skipIf(!hasBlob)('markdownToDocxBlob (browser runtime)', () => {
  it('produces a non-empty DOCX Blob from markdown', async () => {
    const blob = await markdownToDocxBlob(
      '# Title\n\nA paragraph with **bold**.\n\n- a\n- b\n\n| x | y |\n| - | - |\n| 1 | 2 |',
      'Runtime Test'
    )
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toContain('wordprocessingml')
    expect(blob.size).toBeGreaterThan(1000) // a real zipped docx has substance
  }, 30000)

  it('does not throw "global is not defined" (shim works)', async () => {
    await expect(markdownToDocxBlob('hello', 'X')).resolves.toBeInstanceOf(Blob)
  }, 30000)
})
