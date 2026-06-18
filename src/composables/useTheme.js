import { ref, watchEffect } from 'vue'
import { load, save } from '../utils/storage'

// SSG-safe: window/document are undefined during prerender.
const systemDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
const theme = ref(load('theme', systemDark ? 'dark' : 'light'))

export function useTheme() {
  function setTheme(t) {
    theme.value = t
    save('theme', t)
    if (typeof document === 'undefined') return
    document.documentElement.classList.add('theme-transition')
    document.documentElement.dataset.theme = t
    requestAnimationFrame(() => {
      setTimeout(() => document.documentElement.classList.remove('theme-transition'), 550)
    })
  }

  function toggleTheme() {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  watchEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme.value
  })

  return { theme, setTheme, toggleTheme }
}
