// Converter registry. Each converter declares where it runs (client/backend) and how to
// lazy-load + run. Phase 1 suites register their converters here; the command palette and
// convert pages read from it. Shape:
//   { id, route, inputs: string[], output, where:'client'|'backend'|'auto',
//     needsBackend: bool, lazyLoad?: () => Promise, run: (input, opts) => Promise<Blob|string> }
const converters = new Map()

export function registerConverter(c) { converters.set(c.id, c) }
export function getConverter(id) { return converters.get(id) }
export function convertersFor(inputType) {
  return [...converters.values()].filter(c => c.inputs?.includes(inputType))
}
export function allConverters() { return [...converters.values()] }
export function _resetConverters() { converters.clear() }
