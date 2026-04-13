import { ref, watchEffect } from 'vue'
import { load, save } from '../utils/storage'

const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
const theme = ref(load('theme', systemDark ? 'dark' : 'light'))

export function useTheme() {
  function setTheme(t) {
    document.documentElement.classList.add('theme-transition')
    theme.value = t
    document.documentElement.dataset.theme = t
    save('theme', t)
    requestAnimationFrame(() => {
      setTimeout(() => document.documentElement.classList.remove('theme-transition'), 550)
    })
  }

  function toggleTheme() {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  // Apply on init
  watchEffect(() => {
    document.documentElement.dataset.theme = theme.value
  })

  return { theme, setTheme, toggleTheme }
}
