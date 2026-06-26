import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// Stub the SEO head + route so pages mount without a router.
vi.mock('../../../composables/useRouteHead.js', () => ({
  useRouteHead: () => ({ meta: { h1: 'Test H1' } }),
}))

import MarkdownToPdfPage from '../MarkdownToPdfPage.vue'
import MarkdownToDocxPage from '../MarkdownToDocxPage.vue'
import MarkdownToHtmlPage from '../MarkdownToHtmlPage.vue'
import PdfToWordPage from '../PdfToWordPage.vue'

const pages = { MarkdownToPdfPage, MarkdownToDocxPage, MarkdownToHtmlPage, PdfToWordPage }

describe('convert pages mount + expose SEO h1', () => {
  for (const [name, Comp] of Object.entries(pages)) {
    it(`${name} mounts and renders sr-only h1`, () => {
      const wrapper = mount(Comp)
      const h1 = wrapper.find('h1.sr-only')
      expect(h1.exists()).toBe(true)
      expect(h1.text()).toBe('Test H1')
      wrapper.unmount()
    })
  }
})
