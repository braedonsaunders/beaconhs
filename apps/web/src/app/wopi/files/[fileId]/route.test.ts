import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

const state = vi.hoisted(() => ({
  validToken: true,
  canWrite: true,
  tenantActive: true,
  authorized: true,
  currentFile: true,
  lock: null as string | null,
  expiresAt: null as Date | null,
  execute: vi.fn(),
  withTenant: vi.fn(),
}))

vi.mock('@/lib/wopi', () => ({
  verifyWopiToken: () =>
    state.validToken ? { tenantId: 'tenant-a', canWrite: state.canWrite } : null,
}))
vi.mock('@/lib/wopi-access', () => ({
  wopiPrincipalIsAuthorized: async () => state.authorized,
  wopiGrantCanAccessFile: async () => state.currentFile,
}))
vi.mock('@/lib/active-tenant', () => ({ tenantIsActive: async () => state.tenantActive }))
vi.mock('@/lib/wopi-protocol', () => import('../../../../lib/wopi-protocol'))
vi.mock('@/lib/list-params', async () => ({
  isUuid: (value: string) => /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(value),
}))
vi.mock('@beaconhs/db', () => ({ db: {}, withTenant: state.withTenant }))

import { POST } from './route'

const FILE_ID = '10000000-0000-4000-8000-000000000001'

function request(override: string, lock?: string, oldLock?: string) {
  const headers = new Headers({ 'X-WOPI-Override': override })
  if (lock !== undefined) headers.set('X-WOPI-Lock', lock)
  if (oldLock !== undefined) headers.set('X-WOPI-OldLock', oldLock)
  return POST(
    new NextRequest(`https://beaconhs.test/wopi/files/${FILE_ID}?access_token=test`, {
      method: 'POST',
      headers,
    }),
    { params: Promise.resolve({ fileId: FILE_ID }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  state.execute.mockImplementation(async (query: SQL) => {
    const compiled = new PgDialect().sqlToQuery(query)
    // Raw SQL has no automatic column encoder: a Date here fails in the
    // production postgres driver before it can acquire the editor lock.
    expect(compiled.params.some((param) => param instanceof Date)).toBe(false)
    return []
  })
  Object.assign(state, {
    validToken: true,
    canWrite: true,
    tenantActive: true,
    authorized: true,
    currentFile: true,
    lock: null,
    expiresAt: null,
  })
  state.withTenant.mockImplementation(async (_db, _tenantId, run) =>
    run({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => ({
              for: async () => [{ wopiLock: state.lock, wopiLockExpiresAt: state.expiresAt }],
            }),
          }),
        }),
      }),
      execute: state.execute,
    }),
  )
})

describe('WOPI file endpoint locks', () => {
  it('accepts the file-level LOCK Collabora requires before enabling editing', async () => {
    const response = await request('LOCK', 'editor-a')
    expect(response.status).toBe(200)
    expect(response.headers.get('X-WOPI-Lock')).toBe('editor-a')
    expect(state.withTenant).toHaveBeenCalledWith({}, 'tenant-a', expect.any(Function))
    expect(state.execute).toHaveBeenCalledOnce()
    const compiled = new PgDialect().sqlToQuery(state.execute.mock.calls[0]![0] as SQL)
    expect(compiled.params).toEqual(['editor-a', expect.any(String), FILE_ID])
    expect(Number.isFinite(Date.parse(compiled.params[1] as string))).toBe(true)
  })

  it.each(['LOCK', 'REFRESH_LOCK', 'UNLOCK'])(
    'handles %s for the current lock holder',
    async (op) => {
      state.lock = 'editor-a'
      state.expiresAt = new Date(Date.now() + 60_000)
      const response = await request(op, 'editor-a')
      expect(response.status).toBe(200)
      expect(response.headers.get('X-WOPI-Lock')).toBe(op === 'UNLOCK' ? '' : 'editor-a')
      expect(state.execute).toHaveBeenCalledOnce()
    },
  )

  it('reads a lock without modifying the file', async () => {
    state.lock = 'editor-a'
    state.expiresAt = new Date(Date.now() + 60_000)
    const response = await request('GET_LOCK')
    expect(response.status).toBe(200)
    expect(response.headers.get('X-WOPI-Lock')).toBe('editor-a')
    expect(state.execute).not.toHaveBeenCalled()
  })

  it('returns the current lock on a conflict and does not overwrite it', async () => {
    state.lock = 'editor-a'
    state.expiresAt = new Date(Date.now() + 60_000)
    const response = await request('LOCK', 'editor-b')
    expect(response.status).toBe(409)
    expect(response.headers.get('X-WOPI-Lock')).toBe('editor-a')
    expect(state.execute).not.toHaveBeenCalled()
  })

  it('allows an atomic unlock-and-relock with the correct old lock', async () => {
    state.lock = 'editor-a'
    state.expiresAt = new Date(Date.now() + 60_000)
    const response = await request('LOCK', 'editor-b', 'editor-a')
    expect(response.status).toBe(200)
    expect(response.headers.get('X-WOPI-Lock')).toBe('editor-b')
  })

  it.each([
    ['validToken', 401],
    ['canWrite', 403],
    ['tenantActive', 403],
    ['authorized', 403],
    ['currentFile', 404],
  ] as const)('rejects a lock when %s is false', async (key, status) => {
    state[key] = false
    expect((await request('LOCK', 'editor-a')).status).toBe(status)
    expect(state.execute).not.toHaveBeenCalled()
  })

  it('rejects missing lock values and unsupported file operations', async () => {
    expect((await request('LOCK')).status).toBe(400)
    expect((await request('PUT', 'editor-a')).status).toBe(501)
    expect(state.execute).not.toHaveBeenCalled()
  })
})
