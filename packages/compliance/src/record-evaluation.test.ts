import { describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Database } from '@beaconhs/db'
import { equipmentItems, ppeItems } from '@beaconhs/db/schema'
import { evaluateObligation, type ComplianceObligation } from './evaluate'

const TENANT_ID = '00000000-0000-4000-8000-000000000001'
const TYPE_ID = '00000000-0000-4000-8000-000000000002'

function obligation(sourceModule: 'equipment_inspection' | 'ppe_inspection'): ComplianceObligation {
  return {
    id: '00000000-0000-4000-8000-000000000003',
    tenantId: TENANT_ID,
    sourceModule,
    subjectKind: 'per_record',
    title: 'Inspection policy',
    notes: null,
    status: 'active',
    targetRef:
      sourceModule === 'equipment_inspection'
        ? { equipmentTypeId: TYPE_ID }
        : { ppeTypeId: TYPE_ID },
    recurrence: { kind: 'expiry', remindBeforeDays: 30 },
    recurrenceKind: 'expiry',
    lastScannedAt: null,
    nextDueAt: null,
    sourceKey: null,
    sourceId: null,
    createdByTenantUserId: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    deletedAt: null,
  }
}

function fakeDatabase(table: unknown, rows: unknown[]) {
  let whereClause: SQL | null = null
  const query = Promise.resolve(rows) as Promise<unknown[]> & {
    leftJoin: () => unknown
    where: (where: SQL) => unknown
  }
  query.leftJoin = () => query
  query.where = (where: SQL) => {
    whereClause = where
    return query
  }
  const tx = {
    select: vi.fn(() => ({
      from: (selectedTable: unknown) => {
        if (selectedTable !== table) throw new Error('Unexpected evaluation table')
        return query
      },
    })),
  } as unknown as Database
  return { tx, whereClause: () => whereClause }
}

describe('per-record compliance evaluation', () => {
  it('excludes draft and retired/lost equipment from inspection obligations', async () => {
    const fake = fakeDatabase(equipmentItems, [
      {
        id: '00000000-0000-4000-8000-000000000004',
        name: 'Telehandler',
        tag: 'EQ-42',
        due: '2026-07-20',
      },
    ])

    const evaluated = await evaluateObligation(
      fake.tx,
      TENANT_ID,
      obligation('equipment_inspection'),
      [],
      { now: new Date('2026-07-14T12:00:00.000Z'), timezone: 'UTC' },
    )

    expect(evaluated.rows[0]).toMatchObject({
      label: 'Telehandler (EQ-42)',
      status: 'expiring',
      dueOn: '2026-07-20',
    })
    const predicate = new PgDialect().sqlToQuery(fake.whereClause()!)
    expect(predicate.sql).toContain('"equipment_items"."is_draft" = $3')
    expect(predicate.sql).toContain('"equipment_items"."status" not in ($4, $5)')
    expect(predicate.params).toEqual([TENANT_ID, TYPE_ID, false, 'retired', 'lost'])
  })

  it('uses the earliest PPE inspection, annual inspection, or expiry date', async () => {
    const fake = fakeDatabase(ppeItems, [
      {
        id: '00000000-0000-4000-8000-000000000005',
        serial: 'HAR-17',
        type: 'Harness',
        inspection: '2026-09-01',
        annualInspection: '2026-07-20',
        expiresOn: '2026-10-01',
      },
    ])

    const evaluated = await evaluateObligation(
      fake.tx,
      TENANT_ID,
      obligation('ppe_inspection'),
      [],
      { now: new Date('2026-07-14T12:00:00.000Z'), timezone: 'UTC' },
    )

    expect(evaluated.rows[0]).toMatchObject({
      label: 'Harness · HAR-17',
      status: 'expiring',
      dueOn: '2026-07-20',
    })
    const predicate = new PgDialect().sqlToQuery(fake.whereClause()!)
    expect(predicate.sql).toContain('"ppe_items"."status" not in ($3, $4)')
    expect(predicate.params).toEqual([TENANT_ID, TYPE_ID, 'discarded', 'expired'])
  })
})
