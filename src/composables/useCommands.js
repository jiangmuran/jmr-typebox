import { reactive } from 'vue'

// Global command registry — the source of truth for the ⌘K palette and tool grids.
// Command: { id, title, aliases?:string[], group, icon?, run:()=>void, needsBackend?:bool, keywords?:string }
const commands = reactive([])
export const allCommands = commands

export function registerCommand(cmd) {
  const i = commands.findIndex(c => c.id === cmd.id)
  if (i >= 0) commands.splice(i, 1, cmd)
  else commands.push(cmd)
}
export function registerCommands(arr) { arr.forEach(registerCommand) }

export function searchCommands(query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return [...commands]
  const score = c => {
    const title = (c.title || '').toLowerCase()
    const hay = `${title} ${(c.aliases || []).join(' ')} ${c.keywords || ''} ${c.group || ''}`.toLowerCase()
    if (title.startsWith(q)) return 3
    if (title.includes(q)) return 2
    if (hay.includes(q)) return 1
    return 0
  }
  return commands
    .map(c => [c, score(c)])
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c)
}

export function _resetCommands() { commands.splice(0, commands.length) }
