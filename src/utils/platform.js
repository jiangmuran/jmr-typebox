// Platform-aware keyboard-shortcut labels. The handlers accept both metaKey and
// ctrlKey everywhere; only the LABELS were hardcoded to ⌘, which reads as noise
// on Windows/Linux. SSG-safe: navigator is absent at prerender, so default to
// the non-Mac label there (hydration corrects it before anyone reads a tooltip).
export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')

// '⌘' on Apple platforms, 'Ctrl+' elsewhere — concatenate with the key: MOD + 'K'.
export const MOD = isMac ? '⌘' : 'Ctrl+'

export function combo(key) {
  return MOD + key
}
