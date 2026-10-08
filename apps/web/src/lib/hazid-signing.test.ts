import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import type { SigningContext } from './hazid-signing'
vi.mock('server-only', () => ({}))
vi.mock('./flows/adapters/hazid', () => ({ createHazidFlowAdapter: vi.fn() }))
vi.mock('@/app/(app)/apps/_lib/entity-loader', () => ({ loadEntitiesForPickers: vi.fn() }))
vi.mock('./visibility', () => ({ canSeeRecord: vi.fn() }))
import { canSeeRecord } from './visibility'
import { lockHazidForSigning, requireOwnHazidSignature } from './hazid-signing'

const ctx = { tenantId: 'tenant-123', userId: 'user-456', permissions: new Set() } as SigningContext
function query(result: unknown[]) {
  let condition: SQL | undefined
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: (where: SQL) => {
      condition = where
      return chain
    },
    for: () => chain,
    limit: async () => result,
  }
  const tx = { select: () => chain } as unknown as Database
  return { tx, sql: () => new PgDialect().sqlToQuery(condition!) }
}
function row(overrides: Record<string, unknown> = {}) {
  return {
    signature: {
      requestId: 'request-1',
      signedAt: null,
      requestExpiresAt: new Date(Date.now() + 60000),
      ...overrides,
    },
    assessment: { id: 'assessment-1', signingFrozenAt: new Date() },
  }
}

describe('personal signing access', () => {
  it('uses tenant, account, active-person and active-membership predicates without edit permission', async () => {
    const result = row(),
      q = query([result])
    await expect(requireOwnHazidSignature(ctx, q.tx, 'signature-1')).resolves.toBe(result)
    const built = q.sql()
    expect(built.params).toContain('tenant-123')
    expect(built.params).toContain('user-456')
    expect(built.params).toContain('signature-1')
    expect(built.sql).toContain('"people"."user_id"')
    expect(built.sql).toContain('"people"."deleted_at" is null')
    expect(built.sql).toContain('"people"."status"')
    expect(built.sql).toContain('"tenant_users"."status"')
  })
  it('rejects absent, unrequested and expired unsigned slots', async () => {
    await expect(requireOwnHazidSignature(ctx, query([]).tx, 'id')).rejects.toThrow('not found')
    await expect(
      requireOwnHazidSignature(ctx, query([row({ requestId: null })]).tx, 'id'),
    ).rejects.toThrow('not found')
    await expect(
      requireOwnHazidSignature(ctx, query([row({ requestExpiresAt: new Date(0) })]).tx, 'id'),
    ).rejects.toThrow('expired')
  })
  it('lets the signer see their saved confirmation after the request expiry', async () => {
    const signed = row({ signedAt: new Date(), requestExpiresAt: new Date(0) })
    await expect(requireOwnHazidSignature(ctx, query([signed]).tx, 'id')).resolves.toBe(signed)
  })
})

it('locks and authorizes a submitted assessment without blocking crew changes', async () => {
  const parent = {
    id: 'assessment-1',
    locked: true,
    reportedByTenantUserId: 'owner',
    siteOrgUnitId: null,
  }
  vi.mocked(canSeeRecord).mockResolvedValue(true)
  const q = query([parent])
  await expect(lockHazidForSigning(ctx, q.tx, parent.id)).resolves.toBe(parent)
  expect(q.sql().params).toContain(ctx.tenantId)
  expect(q.sql().sql).toContain('"hazid_assessments"."deleted_at" is null')
  vi.mocked(canSeeRecord).mockResolvedValue(false)
  await expect(lockHazidForSigning(ctx, q.tx, parent.id)).rejects.toThrow('not found')
})
