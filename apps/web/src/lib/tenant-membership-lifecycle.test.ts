import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '@beaconhs/db'
import { tenantUsers } from '@beaconhs/db/schema'
import { removeTenantMembership, restoreRemovedMembership } from './tenant-membership-lifecycle'

type Member = typeof tenantUsers.$inferSelect
function transaction(existing: Partial<Member> | null, mutationRows: Partial<Member>[] = []) {
  const dialectDb = drizzle.mock()
  const queries: { sql: string; params: unknown[] }[] = []
  const select = {
    from: () => select,
    where: () => select,
    limit: () => select,
    for: async () => (existing ? [existing] : []),
  }
  const tx = {
    select: () => select,
    update: (table: typeof tenantUsers) => ({
      set: (values: Partial<Member>) => ({
        where: (
          where: Parameters<ReturnType<ReturnType<typeof dialectDb.update>['set']>['where']>[0],
        ) => ({
          returning: () => {
            queries.push(dialectDb.update(table).set(values).where(where).returning().toSQL())
            return Promise.resolve(mutationRows)
          },
        }),
      }),
    }),
    delete: (table: Parameters<typeof dialectDb.delete>[0]) => ({
      where: (where: Parameters<ReturnType<typeof dialectDb.delete>['where']>[0]) => {
        queries.push(dialectDb.delete(table).where(where).toSQL())
        return Promise.resolve([])
      },
    }),
  } as unknown as Database
  return { tx, queries }
}

describe('tenant membership removal and fresh access', () => {
  it('retains historical identity, suspends access and revokes both kinds of grants in the tenant', async () => {
    const { tx, queries } = transaction(null, [{ id: 'member', userId: 'account' }])
    expect(await removeTenantMembership(tx, 'tenant', 'member')).toBe(true)
    expect(queries).toHaveLength(4)
    expect(queries[0]!.sql).toContain('update "tenant_users" set')
    expect(queries[0]!.params).toContain('suspended')
    expect(queries[0]!.sql).toContain('"tenant_users"."removed_at" is null')
    expect(queries[1]!.sql).toContain('update "people" set "user_id" =')
    expect(queries[1]!.params).toContain(null)
    expect(queries[1]!.params).toContain('account')
    expect(queries[1]!.sql).toContain('"people"."tenant_id" =')
    expect(queries[1]!.sql).toContain('"people"."user_id" =')
    expect(queries[2]!.sql).toContain('delete from "role_assignments"')
    expect(queries[3]!.sql).toContain('delete from "user_permission_overrides"')
    expect(queries.every((query) => query.params.includes('tenant'))).toBe(true)
    expect(queries.some((query) => query.sql.startsWith('delete from "tenant_users"'))).toBe(false)
  })
  it('leaves grants untouched when the member was already removed or is outside the tenant', async () => {
    const { tx, queries } = transaction(null)
    expect(await removeTenantMembership(tx, 'tenant', 'member')).toBe(false)
    expect(queries).toHaveLength(1)
  })
  it('reuses a removed identity with fresh invite generation and no old permissions', async () => {
    const previous = new Date('2026-10-01T12:00:00Z')
    const restored = { id: 'member', invitedAt: new Date(previous.getTime() + 1) }
    const { tx, queries } = transaction(
      { id: 'member', removedAt: previous, invitedAt: previous },
      [restored],
    )
    expect(
      await restoreRemovedMembership(tx, {
        tenantId: 'tenant',
        userId: 'account',
        displayName: null,
        invitedBy: 'admin',
        invitedAt: previous,
        status: 'invited',
      }),
    ).toEqual(restored)
    expect(queries).toHaveLength(4)
    expect(queries[0]!.sql).toContain('update "people" set "user_id" =')
    expect(queries[0]!.params).toContain('account')
    expect(queries[1]!.sql).toContain('delete from "role_assignments"')
    expect(queries[2]!.sql).toContain('delete from "user_permission_overrides"')
    expect(queries[3]!.params).toContain('invited')
    expect(queries[3]!.params).toContain(null)
    expect(queries[3]!.params).toContain(restored.invitedAt.toISOString())
    expect(queries[3]!.sql).toContain('"tenant_users"."removed_at" is not null')
  })
  it('never reactivates an existing suspended or active membership through a duplicate invite', async () => {
    const { tx, queries } = transaction({ id: 'member', removedAt: null, status: 'suspended' })
    expect(
      await restoreRemovedMembership(tx, {
        tenantId: 'tenant',
        userId: 'account',
        displayName: null,
        invitedBy: 'admin',
        invitedAt: new Date(),
        status: 'invited',
      }),
    ).toBeNull()
    expect(queries).toHaveLength(0)
  })
})
