// Feature registry. Each feature lives in src/features/<name>/index.js and default-exports:
//   {
//     components?: { '/route/path': () => import('./SomePage.vue'), ... },  // overrides ToolStub
//     i18n?: { en: {...}, zh: {...} },                                     // merged into useI18n
//     register?: () => void,                                              // runs at app start (commands, etc.)
//   }
// Adding a feature is drop-in: create the folder — no edits to routes.js/useI18n.js needed.
// Keep this index file side-effect-free EXCEPT exporting data; do NOT import useI18n here (circular).
const modules = import.meta.glob('./*/index.js', { eager: true })

export const featureComponents = {}
export const featureI18n = { en: {}, zh: {} }
const registrars = []

for (const mod of Object.values(modules)) {
  const f = mod.default || mod
  if (f.components) Object.assign(featureComponents, f.components)
  if (f.i18n?.en) Object.assign(featureI18n.en, f.i18n.en)
  if (f.i18n?.zh) Object.assign(featureI18n.zh, f.i18n.zh)
  if (typeof f.register === 'function') registrars.push(f.register)
}

export function registerFeatures() { registrars.forEach(fn => fn()) }
