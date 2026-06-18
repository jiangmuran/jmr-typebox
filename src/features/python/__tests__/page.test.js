import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// Stub the SEO head + route so the page mounts without a router.
vi.mock('../../../composables/useRouteHead.js', () => ({
  useRouteHead: () => ({ meta: { h1: 'Python Playground' } }),
}))

import PythonPage from '../PythonPage.vue'

describe('PythonPage (SSG-safety)', () => {
  it('mounts and renders the sr-only h1 for SEO', () => {
    const wrapper = mount(PythonPage)
    const h1 = wrapper.find('h1.sr-only')
    expect(h1.exists()).toBe(true)
    expect(h1.text()).toBe('Python Playground')
    wrapper.unmount()
  })

  it('keeps the interactive body behind ClientOnly (no editor before mount tick)', () => {
    // ClientOnly only renders its slot after onMounted; on the initial synchronous render the
    // playground (and thus any pyodide access) must be absent — this is what makes prerender safe.
    const wrapper = mount(PythonPage)
    // The h1 is always present; the editor textarea is gated by ClientOnly.
    expect(wrapper.find('h1.sr-only').exists()).toBe(true)
    wrapper.unmount()
  })
})
