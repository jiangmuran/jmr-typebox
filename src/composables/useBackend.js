import { ref, computed } from 'vue'
import { useSettings } from './useSettings'

// Same-origin Worker. Optional: when the master toggle is off or the probe fails,
// `available` is false and backend-dependent UI hides/degrades.
const apiBase = ''
const REPO_URL = 'https://github.com/jiangmuran/jmr-typebox/tree/main/worker'

const lastProbeOk = ref(false)
let probed = false

export function _resetBackend() { lastProbeOk.value = false; probed = false }

export function useBackend() {
  const { settings } = useSettings()
  const available = computed(() => settings.backendEnabled && lastProbeOk.value)

  async function probe(force = false) {
    if (!settings.backendEnabled) { lastProbeOk.value = false; return }
    if (probed && !force) return
    probed = true
    try {
      const r = await fetch(`${apiBase}/api/health`, { method: 'GET' })
      lastProbeOk.value = !!r.ok
    } catch {
      lastProbeOk.value = false
    }
  }

  return { available, probe, apiBase, repoUrl: REPO_URL }
}
