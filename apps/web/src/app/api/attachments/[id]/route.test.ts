import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { attachments } from '@beaconhs/db/schema'
import { attachmentUrl } from '../../../../lib/attachment-url'

const state = vi.hoisted(() => ({
  row: null as { r2Key: string } | null,
  authCalls: 0,
  authenticated: true,
  owners: [] as { personId: string }[],
  personId: null as string | null,
  permissions: new Set<string>(),
  presign: vi.fn(async () => 'https://storage.example/signed'),
}))

vi.mock('../../../../lib/auth', () => ({
  getRequestContext: async () => {
    state.authCalls++
    if (!state.authenticated) return null
    return {
      personId: state.personId,
      permissions: state.permissions,
      isSuperAdmin: false,
      db: async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          select: () => ({
            from: (table: unknown) => ({
              where: () =>
                table === attachments
                  ? { limit: async () => (state.row ? [state.row] : []) }
                  : Promise.resolve(state.owners),
            }),
          }),
        }),
    }
  },
}))
vi.mock('@beaconhs/storage', () => ({
  presignGet: state.presign,
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
    state.owners = []
    state.personId = null
    state.permissions = new Set()
    state.presign.mockClear()
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

  it('rejects another person’s private file even with a previously shared capability', async () => {
    state.row = { r2Key: 't/tenant/private.pdf' }
    state.owners = [{ personId: 'other-person' }]
    state.personId = 'self-person'
    expect((await request(attachmentUrl(ID))).status).toBe(404)
    expect(state.presign).not.toHaveBeenCalled()
  })

  it.each(['self', 'manager'])(
    'allows the %s to download a private person file',
    async (audience) => {
      state.row = { r2Key: 't/tenant/private.pdf' }
      state.owners = [{ personId: 'self-person' }]
      if (audience === 'self') state.personId = 'self-person'
      else state.permissions.add('admin.org.manage')
      expect((await request(attachmentUrl(ID))).status).toBe(307)
      expect(state.presign).toHaveBeenCalledOnce()
    },
  )

  it('redirects only after both capability and tenant lookup succeed', async () => {
    state.row = { r2Key: 't/tenant/private.pdf' }
    const response = await request(attachmentUrl(ID))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://storage.example/signed')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })
})
