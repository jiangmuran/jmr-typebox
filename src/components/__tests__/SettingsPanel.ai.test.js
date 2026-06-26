import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SettingsPanel from '../SettingsPanel.vue'
import { useSettings } from '../../composables/useSettings'

describe('SettingsPanel — AI section', () => {
  beforeEach(() => {
    const { settings } = useSettings()
    Object.assign(settings, { aiEnabled: false, aiKey: '', aiBaseUrl: 'https://api.openai.com/v1', aiModel: 'gpt-4o-mini' })
  })

  it('shows the AI section toggle', () => {
    const wrapper = mount(SettingsPanel, { props: { open: true }, global: { stubs: { Teleport: true } } })
    expect(wrapper.html()).toContain('AI')
  })

  it('reveals key/model/baseUrl fields only when AI is enabled', async () => {
    const { settings } = useSettings()
    const wrapper = mount(SettingsPanel, { props: { open: true }, global: { stubs: { Teleport: true } } })
    // Disabled → no text inputs for the key.
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    settings.aiEnabled = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
  })

  it('opens itself when a tb-open-settings event fires', async () => {
    const wrapper = mount(SettingsPanel, { props: { open: false }, global: { stubs: { Teleport: true } } })
    window.dispatchEvent(new CustomEvent('tb-open-settings', { detail: { section: 'ai' } }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:open')?.some(e => e[0] === true)).toBe(true)
  })
})
