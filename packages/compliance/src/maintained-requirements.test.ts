import { afterEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  complianceAudience,
  complianceObligations,
  documentAcknowledgments,
  documentVersions,
  people,
  tenantNotificationPolicy,
  trainingEnrollments,
  trainingRecords,
  trainingSkillAssignments,
} from '@beaconhs/db/schema'
import { evaluateObligation, type ComplianceObligation } from './evaluate'
import { currentDocumentAcknowledgment } from './document-acknowledgment'

const tenantId = '10000000-0000-4000-8000-000000000001'
const personId = '10000000-0000-4000-8000-000000000002'
const targetId = '10000000-0000-4000-8000-000000000003'
const versionId = '10000000-0000-4000-8000-000000000004'
const audience = [{ kind: 'person' as const, entityKey: personId }]

function obligation(
  sourceModule: 'cert_requirement' | 'skill_requirement' | 'document',
): ComplianceObligation {
  return {
    id: '10000000-0000-4000-8000-000000000005',
    tenantId,
    sourceModule,
    subjectKind: 'per_person',
    title: 'Maintained requirement',
    notes: null,
    status: 'active',
    targetRef:
      sourceModule === 'document'
        ? { documentId: targetId }
        : sourceModule === 'skill_requirement'
          ? { skillTypeId: targetId }
          : { courseId: targetId },
    recurrence:
      sourceModule === 'document'
        ? { kind: 'frequency', frequency: 'year', cron: '0 8 1 1 *', dueOffsetMinutes: 1440 }
        : { kind: 'expiry', remindBeforeDays: 30 },
    recurrenceKind: sourceModule === 'document' ? 'frequency' : 'expiry',
    lastScannedAt: null,
    nextDueAt: null,
    sourceKey: null,
    sourceId: null,
    createdByTenantUserId: null,
    deletedAt: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  }
}

function database(rows: Map<unknown, unknown[]>) {
  const predicates: SQL[] = []
  const tx = {
    select: () => ({
      from: (table: unknown) => {
        if (!rows.has(table)) throw new Error('Unexpected compliance evidence table')
        const query = Promise.resolve(rows.get(table)!) as Promise<unknown[]> & {
          where: (clause: SQL) => unknown
          orderBy: () => unknown
          limit: () => unknown
        }
        query.where = (clause) => {
          predicates.push(clause)
          return query
        }
        query.orderBy = () => query
        query.limit = () => query
        return query
      },
    }),
  } as unknown as Database
  return { tx, predicates }
}

function personRows(): Map<unknown, unknown[]> {
  return new Map([[people, [{ id: personId, userId: null, first: 'Alex', last: 'Worker' }]]])
}

afterEach(() => vi.useRealTimers())

describe('maintained credential compliance', () => {
  it.each(['cert_requirement', 'skill_requirement'] as const)(
    '%s expires and a replacement restores compliance',
    async (sourceModule) => {
      const rows = personRows()
      const table =
        sourceModule === 'skill_requirement' ? trainingSkillAssignments : trainingRecords
      const evidence = {
        personId,
        completedOn: '2025-06-01',
        grantedOn: '2025-06-01',
        expiresOn: '2026-06-01',
      }
      rows.set(table, [evidence])
      rows.set(trainingEnrollments, [])
      const fake = database(rows)
      const evaluate = (date: string) =>
        evaluateObligation(fake.tx, tenantId, obligation(sourceModule), audience, {
          now: new Date(date),
          timezone: 'America/Toronto',
        })
      expect((await evaluate('2026-04-01T12:00:00Z')).rows[0]?.status).toBe('completed')
      expect((await evaluate('2026-05-15T12:00:00Z')).rows[0]?.status).toBe('expiring')
      expect((await evaluate('2026-06-01T12:00:00Z')).rows[0]?.status).toBe('expiring')
      expect((await evaluate('2026-06-02T12:00:00Z')).rows[0]?.status).toBe('overdue')
      rows.set(table, [
        {
          ...evidence,
          completedOn: '2026-05-01',
          grantedOn: '2026-05-01',
          expiresOn: '2027-05-01',
        },
        evidence,
      ])
      expect((await evaluate('2026-06-02T12:00:00Z')).rows[0]).toMatchObject({
        status: 'completed',
        dueOn: '2027-05-01',
      })
      const sql = fake.predicates.map((p) => new PgDialect().sqlToQuery(p))
      expect(
        sql.some(
          (q) =>
            q.sql.includes('"deleted_at" is null') &&
            q.params.includes(targetId) &&
            q.params.includes(tenantId),
        ),
      ).toBe(true)
      if (sourceModule === 'skill_requirement') {
        expect(sql.some((q) => q.sql.includes('"status"') && q.params.includes('complete'))).toBe(
          true,
        )
      }
    },
  )
  it('keeps explicitly expired skill tickets overdue and accepts a valid replacement', async () => {
    const rows = personRows()
    rows.set(trainingSkillAssignments, [
      { personId, grantedOn: '2025-01-01', expiresOn: null, status: 'expired' },
    ])
    const fake = database(rows)
    const clock = { now: new Date('2026-06-02T12:00:00Z'), timezone: 'America/Toronto' }
    expect(
      (
        await evaluateObligation(
          fake.tx,
          tenantId,
          obligation('skill_requirement'),
          audience,
          clock,
        )
      ).rows[0]?.status,
    ).toBe('overdue')
    rows.set(trainingSkillAssignments, [
      { personId, grantedOn: '2025-01-01', expiresOn: null, status: 'expired' },
      { personId, grantedOn: '2026-06-01', expiresOn: '2027-06-01', status: 'complete' },
    ])
    expect(
      (
        await evaluateObligation(
          fake.tx,
          tenantId,
          obligation('skill_requirement'),
          audience,
          clock,
        )
      ).rows[0]?.status,
    ).toBe('completed')
  })
})

describe('recurring document acknowledgment', () => {
  function fixture(at: Date | null) {
    const rows = personRows()
    rows.set(documentVersions, [{ id: versionId }])
    rows.set(documentAcknowledgments, at ? [{ personId, at, acknowledgedAt: at }] : [])
    rows.set(tenantNotificationPolicy, [{ timezone: 'America/Toronto' }])
    rows.set(complianceObligations, [obligation('document')])
    rows.set(complianceAudience, audience)
    return database(rows)
  }

  it('requires a new signature for an unchanged version in the new year', async () => {
    const fake = fixture(new Date('2025-08-01T15:00:00Z'))
    const clock = { now: new Date('2026-01-03T15:00:00Z'), timezone: 'America/Toronto' }
    const result = await evaluateObligation(
      fake.tx,
      tenantId,
      obligation('document'),
      audience,
      clock,
    )
    expect(result.rows[0]).toMatchObject({
      status: 'overdue',
      completedOn: null,
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
    })
    expect(result.nextDueAt).toEqual(new Date('2027-01-02T13:00:00Z'))
    vi.useFakeTimers()
    vi.setSystemTime(clock.now)
    expect(
      await currentDocumentAcknowledgment(fake.tx, tenantId, targetId, versionId, personId),
    ).toBeNull()
  })

  it('accepts current-period evidence and suppresses a duplicate signing attempt', async () => {
    const at = new Date('2026-01-02T03:00:00Z')
    const fake = fixture(at)
    const clock = { now: new Date('2026-01-03T15:00:00Z'), timezone: 'America/Toronto' }
    const result = await evaluateObligation(
      fake.tx,
      tenantId,
      obligation('document'),
      audience,
      clock,
    )
    expect(result.rows[0]).toMatchObject({ status: 'completed', completedOn: '2026-01-01' })
    vi.useFakeTimers()
    vi.setSystemTime(clock.now)
    expect(
      await currentDocumentAcknowledgment(fake.tx, tenantId, targetId, versionId, personId),
    ).toMatchObject({ acknowledgedAt: at })
    const query = fake.predicates.map((p) => new PgDialect().sqlToQuery(p))
    expect(query.some((q) => q.params.includes(versionId) && q.params.includes(tenantId))).toBe(
      true,
    )
  })

  it('continues accepting historical acknowledgment for a one-time requirement', async () => {
    const fake = fixture(new Date('2025-08-01T15:00:00Z'))
    const ob = {
      ...obligation('document'),
      recurrence: { kind: 'one_time' as const },
      recurrenceKind: 'one_time' as const,
    }
    const result = await evaluateObligation(fake.tx, tenantId, ob, audience, {
      now: new Date('2026-01-03T15:00:00Z'),
      timezone: 'America/Toronto',
    })
    expect(result.rows[0]?.status).toBe('completed')
  })

  it('does not satisfy a requirement when no published version exists', async () => {
    const rows = personRows()
    rows.set(documentVersions, [])
    const result = await evaluateObligation(
      database(rows).tx,
      tenantId,
      obligation('document'),
      audience,
      { now: new Date('2026-01-03T15:00:00Z'), timezone: 'America/Toronto' },
    )
    expect(result.rows[0]?.status).toBe('overdue')
  })
})
