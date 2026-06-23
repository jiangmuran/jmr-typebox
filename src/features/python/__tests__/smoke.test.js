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
  installPackages: async () => [],
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
