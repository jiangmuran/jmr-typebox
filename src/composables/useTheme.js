import { useSettings } from './useSettings'

// Thin wrapper over useSettings so existing callers keep { theme, toggleTheme, setTheme }.
// `theme` is the RESOLVED scheme ('light' | 'dark'); appearance is applied by useSettings.
export function useTheme() {
  const { resolvedTheme, setSetting } = useSettings()

  function setTheme(t) { setSetting('theme', t) }
  function toggleTheme() { setSetting('theme', resolvedTheme.value === 'dark' ? 'light' : 'dark') }

  return { theme: resolvedTheme, setTheme, toggleTheme }
}
