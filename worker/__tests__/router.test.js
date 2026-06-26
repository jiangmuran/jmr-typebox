// @vitest-environment node
import { describe, it, expect } from 'vitest'
import worker from '../index.js'

const env = { ASSETS: { fetch: async () => new Response('static', { status: 200 }) } }

describe('worker router', () => {
  it('answers /api/health as JSON', async () => {
    const res = await worker.fetch(new Request('https://x/api/health'), env)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.features).toContain('fetch')
  })

  it('404s unknown /api/* routes', async () => {
    const res = await worker.fetch(new Request('https://x/api/nope'), env)
    expect(res.status).toBe(404)
  })

  it('delegates non-api paths to ASSETS', async () => {
    const res = await worker.fetch(new Request('https://x/python'), env)
    expect(await res.text()).toBe('static')
  })
})
