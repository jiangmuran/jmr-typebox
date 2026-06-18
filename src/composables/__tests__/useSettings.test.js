import { beforeEach, describe, it, expect } from 'vitest'
import { useSettings, DEFAULT_SETTINGS } from '../useSettings'

beforeEach(() => localStorage.clear())

describe('useSettings', () => {
  it('exposes defaults', () => {
    const { settings } = useSettings()
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(settings.backendEnabled).toBe(true)
    expect(Array.isArray(settings.tabsVisible)).toBe(true)
  })

  it('persists a changed setting to tb-settings', () => {
    const { setSetting } = useSettings()
    setSetting('density', 'compact')
    expect(JSON.parse(localStorage.getItem('tb-settings')).density).toBe('compact')
  })

  it('clearAllData removes tb- keys and restores defaults', () => {
    const s = useSettings()
    s.setSetting('accent', '#ff0000')
    localStorage.setItem('tb-doc', 'x')
    s.clearAllData()
    expect(localStorage.getItem('tb-doc')).toBe(null)
    expect(s.settings.accent).toBe(DEFAULT_SETTINGS.accent)
  })

  it('resolvedTheme turns system into light/dark', () => {
    const { settings, resolvedTheme } = useSettings()
    settings.theme = 'dark'
    expect(resolvedTheme.value).toBe('dark')
    settings.theme = 'light'
    expect(resolvedTheme.value).toBe('light')
  })
})
