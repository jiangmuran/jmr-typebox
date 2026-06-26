// GET /api/health — lets the frontend probe backend availability.
export function health() {
  return Response.json(
    { ok: true, features: ['fetch', 'preview'] },
    { headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } }
  )
}
