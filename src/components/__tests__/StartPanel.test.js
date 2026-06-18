import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StartPanel from '../StartPanel.vue'

describe('StartPanel', () => {
  it('renders a feature card per tool group', () => {
    const wrapper = mount(StartPanel, { global: { stubs: { 'router-link': true } } })
    expect(wrapper.findAll('[data-card]').length).toBeGreaterThanOrEqual(4)
  })

  it('emits write when start-writing is clicked', async () => {
    const wrapper = mount(StartPanel, { global: { stubs: { 'router-link': true } } })
    await wrapper.find('.write-btn').trigger('click')
    expect(wrapper.emitted('write')).toBeTruthy()
  })
})
