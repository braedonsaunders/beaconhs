import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  origin: vi.fn(),
  audit: vi.fn(),
  reconcile: vi.fn(),
  lock: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireRequestContext: mocks.auth }))
vi.mock('@/lib/people-sync', () => ({ getPersonSyncOrigin: mocks.origin }))
vi.mock('@/lib/audit', () => ({ recordAuditInTransaction: mocks.audit }))
vi.mock('@/lib/person-group-memberships', () => ({ lockPersonGroupMembershipGraph: mocks.lock }))
vi.mock('@beaconhs/compliance', () => ({ materializeIdentityAudienceObligations: mocks.reconcile }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
import { deletePerson } from './people'

const id = 'ac5947eb-21b4-4a2b-b787-6f40573c8567'
const before = { id, firstName: 'Ryan', lastName: 'Stirtzinger', userId: 'login', deletedAt: null }
const after = { ...before, deletedAt: new Date('2026-10-05T18:00:00Z') }
const conditions: SQL[] = []
const update = vi.fn()
let selected: unknown[] = []
const tx = {
  select: () => ({
    from: () => ({
      where: (condition: SQL) => {
        conditions.push(condition)
        return { limit: () => ({ for: async () => selected }) }
      },
    }),
  }),
  update: () => ({
    set: (values: unknown) => {
      update(values)
      return {
        where: (condition: SQL) => {
          conditions.push(condition)
          return { returning: async () => [after] }
        },
      }
    },
  }),
}
const ctx = {
  tenantId: 'tenant-a',
  permissions: new Set(['admin.org.manage']),
  isSuperAdmin: false,
  db: vi.fn(async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx)),
}
beforeEach(() => {
  vi.clearAllMocks()
  conditions.length = 0
  selected = [before]
  ctx.permissions = new Set(['admin.org.manage'])
  mocks.auth.mockResolvedValue(ctx)
  mocks.origin.mockResolvedValue(null)
  mocks.audit.mockResolvedValue(undefined)
  mocks.reconcile.mockResolvedValue(undefined)
})

describe('manual person deletion', () => {
  it('rejects ordinary readers before accessing the database', async () => {
    ctx.permissions = new Set(['people.read.all'])
    await expect(deletePerson(id)).rejects.toThrow('Forbidden')
    expect(ctx.db).not.toHaveBeenCalled()
  })
  it('validates the person id before database access', async () => {
    expect(await deletePerson('bad-id')).toEqual({ ok: false, error: 'Person not found.' })
    expect(ctx.db).not.toHaveBeenCalled()
  })
  it('refuses missing and already-deleted identities', async () => {
    selected = []
    expect(await deletePerson(id)).toEqual({ ok: false, error: 'Person not found.' })
    expect(update).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    const query = new PgDialect().sqlToQuery(conditions[0]!)
    expect(query.sql).toContain('"people"."deleted_at" is null')
    expect(query.params).toEqual([ctx.tenantId, id])
  })
  it('refuses any sync-owned person, including paused and manual-only sources', async () => {
    mocks.origin.mockResolvedValue({ connectionId: 'manual-only-connection' })
    expect(await deletePerson(id)).toEqual({
      ok: false,
      error: 'This person is managed by an external sync. Remove them in the source system.',
    })
    expect(update).not.toHaveBeenCalled()
    expect(mocks.reconcile).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('soft deletes only the selected tenant identity, preserving login and historical details', async () => {
    expect(await deletePerson(id)).toEqual({ ok: true })
    expect(update).toHaveBeenCalledExactlyOnceWith({ deletedAt: expect.any(Date) })
    expect(new PgDialect().sqlToQuery(conditions[1]!).params).toEqual([ctx.tenantId, id])
    expect(mocks.reconcile).toHaveBeenCalledWith(tx, ctx.tenantId, [id])
    expect(mocks.audit).toHaveBeenCalledWith(tx, ctx, {
      entityType: 'person',
      entityId: id,
      action: 'delete',
      summary: 'Deleted person Ryan Stirtzinger',
      before,
      after,
    })
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.origin.mock.invocationCallOrder[0]!,
    )
    expect(mocks.revalidate).toHaveBeenCalledWith('/people', 'layout')
    expect(mocks.revalidate).toHaveBeenCalledWith('/compliance', 'layout')
  })
  it('does not report success or revalidate if the transactional audit fails', async () => {
    mocks.audit.mockRejectedValueOnce(new Error('Audit unavailable'))
    await expect(deletePerson(id)).rejects.toThrow('Audit unavailable')
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
