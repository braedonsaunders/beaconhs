import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rate: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getRequestContext: mocks.auth }))
vi.mock('@beaconhs/jobs/rate-limit', () => ({ consumeRateLimit: mocks.rate }))
import { POST } from './route'

const payload = {
  kind: 'smoke',
  routeFamily: 'journals',
  deviceId: '7f8f52ed-870d-42bf-b7a7-99fb722b181d',
  errorType: 'Other',
  positions: [],
}
function request(body: unknown = payload, headers: Record<string, string> = {}) {
  return new Request('https://app.example.test/api/diagnostics', {
    method: 'POST',
    headers: { origin: 'https://app.example.test', 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubEnv('APP_URL', 'https://app.example.test')
  vi.stubEnv('PUBLIC_APP_URL', undefined)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined)
  mocks.auth.mockReset().mockResolvedValue({
    userId: 'peter',
    tenantId: 'external-training',
    impersonation: { actor: { userId: 'real-admin' } },
  } as RequestContext)
  mocks.rate.mockReset().mockResolvedValue({ allowed: true })
})

describe('authenticated browser diagnostic ingestion', () => {
  it('requires authentication, same origin, JSON and a shared rate limit', async () => {
    expect((await POST(request(payload, { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await POST(request(payload, { origin: '' }))).status).toBe(403)
    expect((await POST(request(payload, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect((await POST(request(payload, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect(mocks.auth).not.toHaveBeenCalled()
    mocks.auth.mockResolvedValueOnce(null)
    expect((await POST(request())).status).toBe(401)
    mocks.rate.mockResolvedValueOnce({ allowed: false })
    expect((await POST(request())).status).toBe(429)
    expect(mocks.rate).toHaveBeenCalledWith({
      key: 'browser-diagnostics:external-training:real-admin',
      limit: 30,
      windowSeconds: 60,
    })
  })

  it('rejects unknown fields, error text, unsafe positions/digests and oversized streamed bodies', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    for (const body of [
      { ...payload, actorUserId: 'forged' },
      { ...payload, kind: 'event_loop_delay' },
      { ...payload, kind: 'event_loop_delay', delayMs: 999_999 },
      { ...payload, delayMs: 5_000 },
      { ...payload, message: 'SECRET SQL' },
      { ...payload, digest: 'SECRET' },
      { ...payload, positions: ['https://host/_next/static/abc.js:1:1?token=secret'] },
      { ...payload, positions: ['/_next/static/../secret.js:1:1'] },
      '{bad json',
      'x'.repeat(4097),
    ])
      expect((await POST(request(body))).status).toBe(400)
    expect((await POST(request(payload, { 'content-length': '99999' }))).status).toBe(400)
    expect(log).not.toHaveBeenCalled()
  })

  it('attributes events to the verified actor and tenant without request contents', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const response = await POST(
      request(payload, { cookie: 'super-secret', 'user-agent': 'Chrome/123 SECRET' }),
    )
    expect(response.status).toBe(204)
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      event: 'browser_diagnostic',
      kind: 'smoke',
      actorUserId: 'real-admin',
      effectiveUserId: 'peter',
      tenantId: 'external-training',
      browser: 'chrome',
    })
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET|super-secret|cookie/)
  })

  it('fails softly when authentication, the rate limiter or log sink is unavailable', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('sensitive DB data'))
    expect((await POST(request())).status).toBe(503)
    mocks.rate.mockRejectedValueOnce(new Error('redis password'))
    expect((await POST(request())).status).toBe(503)
    vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('sink unavailable')
    })
    expect((await POST(request())).status).toBe(503)
  })
})

it('accepts the configured public origin when standalone reconstructs an internal request URL', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  const response = await POST(
    new Request('http://0.0.0.0:3000/api/diagnostics', {
      method: 'POST',
      headers: { origin: 'https://app.example.test', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  expect(response.status).toBe(204)
})

it('accepts a bounded delayed-heartbeat event without treating it as proof of a crash', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  expect(
    (await POST(request({ ...payload, kind: 'event_loop_delay', delayMs: 5_000 }))).status,
  ).toBe(204)
  expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
    kind: 'event_loop_delay',
    delayMs: 5_000,
  })
})
