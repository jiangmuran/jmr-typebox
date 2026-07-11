// Same-origin client for the optional /api/watermark backend (Phase 3). Callers must handle
// rejection (backend disabled / offline) and fall back to the offline watermark behavior.

export async function registerRecords(records) {
  const res = await fetch('/api/watermark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ records }),
  })
  if (!res.ok) throw new Error('register failed: ' + res.status)
  const data = await res.json()
  if (!Array.isArray(data.ids) || data.ids.length !== records.length) throw new Error('register: unexpected response')
  return data.ids
}

export async function resolveWatermark(id) {
  const res = await fetch('/api/watermark/' + encodeURIComponent(id))
  if (res.status === 404) return null
  if (!res.ok) throw new Error('resolve failed: ' + res.status)
  return res.json()
}
