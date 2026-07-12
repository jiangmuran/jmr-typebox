// /api/admin/stats + /api/admin/stats/stream — the admin dashboard's observability surface.
//
// GET /api/admin/stats         → JSON snapshot { counters, totals, recent, logs }
// GET /api/admin/stats/stream  → Server-Sent Events: one 'request' / 'log' event per live action
//
// Both require a valid admin session (gated centrally in worker/index.js BEFORE this handler).
// The SSE stream sends a heartbeat comment every 30s to keep the connection alive through proxies
// that close idle connections.

import { getStats, subscribe, logEvent } from '../lib/metrics.js'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function json(obj, status = 200) {
  return Response.json(obj, { status, headers: { ...cors, 'cache-control': 'no-store' } })
}

export async function stats(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const url = new URL(request.url)
  const path = url.pathname

  // ---- GET /api/admin/stats — snapshot ----
  if (path === '/api/admin/stats' && request.method === 'GET') {
    return json(getStats())
  }

  // ---- GET /api/admin/stats/stream — SSE live feed ----
  if (path === '/api/admin/stats/stream' && request.method === 'GET') {
    const stream = new ReadableStream({
      start(controller) {
        // Send an initial hello so the client knows the connection is live + gets the current
        // snapshot in one round-trip (instead of having to GET /stats separately on mount).
        try {
          const hello = `event: hello\ndata: ${JSON.stringify(getStats())}\n\n`
          controller.enqueue(new TextEncoder().encode(hello))
        } catch { /* controller already closed */ }

        const unsubscribe = subscribe(controller)

        // Heartbeat every 30s. SSE comments start with `:` and are silently dropped by the
        // browser's EventSource API — perfect for keep-alive without surfacing as an event.
        const heartbeat = setInterval(() => {
          try { controller.enqueue(new TextEncoder().encode(': heartbeat\n\n')) } catch { /* closed */ }
        }, 30000)

        // Cleanup when the client disconnects (closes the tab / navigates away).
        const cleanup = () => {
          clearInterval(heartbeat)
          unsubscribe()
          try { controller.close() } catch { /* already closed */ }
        }
        // Workers expose request.signal for abort detection (AbortSignal).
        if (request.signal) {
          request.signal.addEventListener('abort', cleanup, { once: true })
        }
        // Safety: auto-close after 5 minutes to prevent zombie streams (client will reconnect).
        setTimeout(cleanup, 5 * 60 * 1000)
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no', // disable proxy buffering (nginx-style)
        ...cors,
      },
    })
  }

  return json({ error: 'not_found' }, 404)
}
