import { beforeEach, describe, expect, it, vi } from 'vitest'

const getRequestContext = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ getRequestContext }))

import { SYNC_MAX_BODY_BYTES } from './protocol'
import { handleSyncRequest } from './sync-route'

function request(body: string, headers: Record<string, string> = {}) {
  return new Request('https://app.example/api/records/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers },
    body,
  })
}

beforeEach(() => {
  getRequestContext.mockReset()
  getRequestContext.mockResolvedValue({ tenantId: 'tenant-1', userId: 'user-1' })
})

describe('sync route handling', () => {
  it('passes the parsed body to the saver and returns its answer', async () => {
    const run = vi.fn(async () => ({
      ok: true as const,
      kind: 'fields',
      applied: [],
      conflicts: [],
      rejected: [],
    }))
    const response = await handleSyncRequest(
      request('{"scope":"tenant-1:user-1","module":"incidents"}'),
      run,
    )
    expect(response.status).toBe(200)
    expect(run).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1' },
      { scope: 'tenant-1:user-1', module: 'incidents' },
    )
    expect(await response.json()).toMatchObject({ ok: true, kind: 'fields' })
  })

  it('maps each failure reason to the status the client queue classifies', async () => {
    const cases = [
      ['invalid', 400],
      ['forbidden', 403],
      ['not_found', 404],
      ['conflict', 409],
      ['closed', 409],
      ['locked', 423],
      ['unavailable', 503],
    ] as const
    for (const [reason, status] of cases) {
      const response = await handleSyncRequest(
        request('{"scope":"tenant-1:user-1"}'),
        async () => ({
          ok: false,
          reason,
          error: 'Nope.',
        }),
      )
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ ok: false, reason, error: 'Nope.' })
    }
  })

  it('refuses cross-site requests and signed-out callers before reading the body', async () => {
    const run = vi.fn()
    const crossSite = await handleSyncRequest(
      request('{}', { 'sec-fetch-site': 'cross-site' }),
      run,
    )
    expect(crossSite.status).toBe(403)
    getRequestContext.mockResolvedValue(null)
    const signedOut = await handleSyncRequest(request('{}'), run)
    expect(signedOut.status).toBe(401)
    expect(await signedOut.json()).toMatchObject({ reason: 'unauthorized' })
    expect(run).not.toHaveBeenCalled()
  })

  it('never applies work queued under another tenant, account, or impersonation session', async () => {
    const run = vi.fn()
    const otherTenant = await handleSyncRequest(request('{"scope":"tenant-2:user-1"}'), run)
    expect(otherTenant.status).toBe(503)
    expect(await otherTenant.json()).toMatchObject({ reason: 'unavailable' })
    getRequestContext.mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      impersonation: { actor: { userId: 'admin-9' } },
    })
    const impersonating = await handleSyncRequest(request('{"scope":"tenant-1:user-1"}'), run)
    expect(impersonating.status).toBe(503)
    const unscoped = await handleSyncRequest(request('{"module":"incidents"}'), run)
    expect(unscoped.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses malformed and oversized bodies', async () => {
    const run = vi.fn()
    expect((await handleSyncRequest(request('{not json'), run)).status).toBe(400)
    const huge = JSON.stringify({ value: 'x'.repeat(SYNC_MAX_BODY_BYTES) })
    expect((await handleSyncRequest(request(huge), run)).status).toBe(413)
    expect(run).not.toHaveBeenCalled()
  })
})
