import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { attachmentUrl } from '../../../../lib/attachment-url'

const state = vi.hoisted(() => ({
  row: null as { r2Key: string } | null,
  authCalls: 0,
  authenticated: true,
}))

vi.mock('../../../../lib/auth', () => ({
  getRequestContext: async () => {
    state.authCalls++
    if (!state.authenticated) return null
    return {
      db: async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          select: () => ({
            from: () => ({
              where: () => ({ limit: async () => (state.row ? [state.row] : []) }),
            }),
          }),
        }),
    }
  },
}))
vi.mock('@beaconhs/storage', () => ({
  presignGet: async () => 'https://storage.example/signed',
}))

import { GET } from './route'

const ID = '10000000-0000-4000-8000-000000000001'

async function request(url: string) {
  return GET(new NextRequest(`http://localhost${url}`), { params: Promise.resolve({ id: ID }) })
}

describe('attachment capability route', () => {
  beforeEach(() => {
    state.row = null
    state.authCalls = 0
    state.authenticated = true
  })

  it('rejects ID-only and invalid capabilities before tenant lookup', async () => {
    expect((await request(`/api/attachments/${ID}`)).status).toBe(404)
    expect((await request(`/api/attachments/${ID}?cap=${'A'.repeat(43)}`)).status).toBe(404)
    expect(state.authCalls).toBe(0)
  })

  it('keeps a valid capability tenant-scoped', async () => {
    expect((await request(attachmentUrl(ID))).status).toBe(404)
    expect(state.authCalls).toBe(1)
  })

  it('requires an authenticated tenant after validating the capability', async () => {
    state.authenticated = false
    expect((await request(attachmentUrl(ID))).status).toBe(401)
    expect(state.authCalls).toBe(1)
  })

  it('redirects only after both capability and tenant lookup succeed', async () => {
    state.row = { r2Key: 't/tenant/private.pdf' }
    const response = await request(attachmentUrl(ID))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://storage.example/signed')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })
})
