// Shared client-side hand-off pool that bridges the media sub-tools (Player ↔ Convert/Edit/
// Subtitles). It lets the player "Send to Edit/Convert" the current track, and lets the converter/
// editor "Add to player" their loaded/result file — all in-memory, never uploaded.
//
// Module-singleton refs (created at import — refs are SSG-safe; we never touch window here). The
// actual File objects live only in memory; persistence to IndexedDB happens via the player store.
import { ref } from 'vue'

// A pending hand-off TO a sub-tool: a File the target page should pick up on mount, then clear.
//   { file: File, source: 'player'|'convert'|..., tab?: 'edit'|'convert' }
const pending = ref(null)

// A callback the player exposes so other tools can push a File straight into the library without a
// route change (e.g. "Add result to player" stays on the converter page). Set by the player store
// when the player UI mounts; null otherwise.
let _addToPlayer = null

export function useMediaPool() {
  // Stash a File for a target tool to consume on its next mount.
  function handOff(file, { source = '', tab = '' } = {}) {
    if (!file) return
    pending.value = { file, source, tab }
  }

  // Target tool calls this on mount; returns the pending hand-off (and clears it) or null.
  function takePending() {
    const p = pending.value
    pending.value = null
    return p
  }

  function peekPending() { return pending.value }

  // Register the player's "add a File to my library" sink (used by Add-to-player buttons elsewhere).
  function registerPlayerSink(fn) { _addToPlayer = typeof fn === 'function' ? fn : null }
  function hasPlayerSink() { return !!_addToPlayer }
  // Push a File into the player library if the player has registered a sink; returns true if taken.
  async function addToPlayer(file, opts) {
    if (_addToPlayer && file) { await _addToPlayer(file, opts); return true }
    // No live player sink → fall back to a hand-off the player picks up when it next mounts.
    if (file) { handOff(file, { source: opts?.source || '', tab: '' }); return false }
    return false
  }

  return { pending, handOff, takePending, peekPending, registerPlayerSink, hasPlayerSink, addToPlayer }
}
