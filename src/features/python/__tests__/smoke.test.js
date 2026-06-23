import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

// Mock the heavy lazy modules so mounting PythonIDE doesn't pull in CodeMirror/Pyodide.
vi.mock('../cmEditor', () => ({
  createEditor: () => ({ setDoc() {}, getDoc: () => '', setDark() {}, focus() {}, destroy() {} }),
}))
vi.mock('../pythonRunner', () => ({
  runPython: async () => ({ ok: true, result: { kind: 'none', data: '' }, figures: [], error: null, hasApp: false, appKind: '' }),
  setStdinHandlers() {}, clearStdin() {}, feedStdin() {}, setProxyApiBase() {},
  callServer: async () => ({ ok: false, error: 'no-app' }),
  installPackages: async () => true,
  // New worker-proxy surface the overhauled component touches.
  stopRun: () => true,
  isReady: () => false,
  onRuntimeStatus: () => () => {},
  listPackages: async () => [],
  uninstallPackage: async () => true,
  getCacheStatus: async () => ({ runtimeCached: false }),
  PYODIDE_VERSION: '314.0.0',
  PYODIDE_CDN_URL: 'https://cdn.jsdelivr.net/pyodide/v314.0.0/full/',
}))

import PythonIDE from '../PythonIDE.vue'

describe('PythonIDE smoke (mounts without errors, both layouts)', () => {
  beforeEach(() => {
    window.matchMedia = window.matchMedia || ((q) => ({
      matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    }))
  })

  it('mounts the desktop workbench (wide) with toolbar, explorer, panel tabs', async () => {
    window.innerWidth = 1280
    const wrapper = mount(PythonIDE)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.toolbar').exists()).toBe(true)
    expect(wrapper.find('.tb-btn.run').exists()).toBe(true)
    // Desktop layout present, mobile absent.
    expect(wrapper.find('.wb').exists()).toBe(true)
    expect(wrapper.find('.explorer').exists()).toBe(true)
    expect(wrapper.find('.panel-tabs').exists()).toBe(true)
    expect(wrapper.find('.mobile').exists()).toBe(false)
    wrapper.unmount()
  })

  it('switches to the single-column mobile flow at 390px', async () => {
    window.innerWidth = 390
    const wrapper = mount(PythonIDE)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mobile').exists()).toBe(true)
    expect(wrapper.find('.m-run').exists()).toBe(true)
    expect(wrapper.find('.m-files').exists()).toBe(true)
    expect(wrapper.find('.wb').exists()).toBe(false)
    wrapper.unmount()
  })

  it('uses the clean single-column layout at tablet/narrow-desktop widths (768 & 820), no desktop workbench', async () => {
    for (const w of [768, 820, 900, 1000]) {
      window.innerWidth = w
      const wrapper = mount(PythonIDE)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.mobile').exists(), `mobile flow at ${w}`).toBe(true)
      expect(wrapper.find('.wb').exists(), `no workbench at ${w}`).toBe(false)
      wrapper.unmount()
    }
  })

  it('shows a Stop control (not Run) while a run is in flight, and Run otherwise', async () => {
    window.innerWidth = 1280
    const wrapper = mount(PythonIDE)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.tb-btn.run').exists()).toBe(true)
    expect(wrapper.find('.tb-btn.stop').exists()).toBe(false)
    // Simulate an in-flight run.
    wrapper.vm.busy = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.tb-btn.stop').exists()).toBe(true)
    expect(wrapper.find('.tb-btn.run').exists()).toBe(false)
    wrapper.unmount()
  })

  it('renders the package & version manager when toggled open', async () => {
    window.innerWidth = 1280
    const wrapper = mount(PythonIDE)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.pkgmgr').exists()).toBe(false)
    wrapper.vm.pkgManagerOpen = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.pkgmgr').exists()).toBe(true)
    wrapper.unmount()
  })

  it('does not show the web-preview pane before any run (no auto-popup)', async () => {
    window.innerWidth = 1280
    const wrapper = mount(PythonIDE)
    await wrapper.vm.$nextTick()
    // previewVisible starts false; the preview ptab/open-preview should be absent.
    expect(wrapper.vm.previewVisible).toBe(false)
    expect(wrapper.vm.hasApp).toBe(false)
    wrapper.unmount()
  })
})
