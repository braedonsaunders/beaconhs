import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@beaconhs/db'
import {
  complianceAudience,
  complianceDispatches,
  complianceObligations,
  complianceStatus,
  tenantNotificationPolicy,
} from '@beaconhs/db/schema'
import type { ComplianceObligation, EvalResult } from './evaluate'

const { evaluateObligation } = vi.hoisted(() => ({ evaluateObligation: vi.fn() }))

vi.mock('./evaluate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./evaluate')>()),
  evaluateObligation,
}))

import { actionableComplianceTransitions, materializeObligation } from './materialize'

const TENANT_ID = '00000000-0000-4000-8000-000000000001'
const OBLIGATION_ID = '00000000-0000-4000-8000-000000000002'
const DISPATCH_ID = '00000000-0000-4000-8000-000000000003'
const NOW = new Date('2026-07-14T12:00:00.000Z')

function obligation(values: Partial<ComplianceObligation> = {}): ComplianceObligation {
  return {
    id: OBLIGATION_ID,
    tenantId: TENANT_ID,
    sourceModule: 'document',
    subjectKind: 'per_person',
    title: 'Current requirement',
    notes: null,
    status: 'active',
    targetRef: { documentId: '00000000-0000-4000-8000-000000000010' },
    recurrence: { kind: 'one_time' },
    recurrenceKind: 'one_time',
    lastScannedAt: null,
    nextDueAt: null,
    sourceKey: null,
    sourceId: null,
    createdByTenantUserId: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    deletedAt: null,
    ...values,
  }
}

function result(rows: EvalResult['rows'] = []): EvalResult {
  return {
    rows,
    totals: {
      total: rows.length,
      completed: rows.filter((row) => row.status === 'completed').length,
      overdue: rows.filter((row) => row.status === 'overdue' || row.status === 'expiring').length,
      pending: rows.filter((row) => row.status === 'pending').length,
    },
    percent: 0,
    nextDueAt: null,
  }
}

type FakeDatabase = {
  tx: Database
  events: string[]
  inserts: Array<{ table: unknown; values: unknown }>
  updates: Array<{ table: unknown; values: unknown }>
  deletes: unknown[]
}

function query<T>(rows: T[], onLock?: (mode: string) => void) {
  let value: Promise<T[]> & Record<string, (...args: unknown[]) => unknown>
  const promise = Promise.resolve(rows) as Promise<T[]> &
    Record<string, (...args: unknown[]) => unknown>
  value = promise
  value.where = () => value
  value.limit = () => value
  value.orderBy = () => value
  value.for = (mode) => {
    onLock?.(String(mode))
    return value
  }
  return value
}

function fakeDatabase(options: {
  locked: ComplianceObligation | null
  prior?: Array<{
    subjectKey: string
    status: string
    periodStart: string | null
    periodEnd: string | null
  }>
  queuedDispatches?: Array<{
    id: string
    occurredAt: Date
    alertPayload: typeof complianceDispatches.$inferSelect.alertPayload
  }>
  dispatchId?: string | null
}): FakeDatabase {
  const events: string[] = []
  const inserts: Array<{ table: unknown; values: unknown }> = []
  const updates: Array<{ table: unknown; values: unknown }> = []
  const deletes: unknown[] = []

  const rowsFor = (table: unknown): unknown[] => {
    if (table === complianceObligations) return options.locked ? [options.locked] : []
    if (table === tenantNotificationPolicy) return [{ timezone: 'UTC' }]
    if (table === complianceAudience) return []
    if (table === complianceStatus) return options.prior ?? []
    if (table === complianceDispatches) return options.queuedDispatches ?? []
    throw new Error('Unexpected selected table in materializer test')
  }

  const tx = {
    select: vi.fn(() => ({
      from: (table: unknown) =>
        query<unknown>(rowsFor(table), (mode) => {
          if (table === complianceObligations) events.push(`lock:${mode}`)
        }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values })
        return {
          onConflictDoUpdate: async () => undefined,
          onConflictDoNothing: () => ({
            returning: async () =>
              table === complianceDispatches && options.dispatchId
                ? [{ id: options.dispatchId }]
                : [],
          }),
        }
      },
    })),
    update: vi.fn((table: unknown) => ({
      set: (values: unknown) => {
        updates.push({ table, values })
        return { where: async () => undefined }
      },
    })),
    delete: vi.fn((table: unknown) => ({
      where: async () => {
        deletes.push(table)
      },
    })),
  } as unknown as Database

  return { tx, events, inserts, updates, deletes }
}

describe('materializeObligation serialization and durable transitions', () => {
  beforeEach(() => {
    evaluateObligation.mockReset()
  })

  it('locks first and evaluates the current row rather than a stale caller snapshot', async () => {
    const stale = obligation({ title: 'Stale requirement' })
    const current = obligation({ title: 'Current requirement' })
    const fake = fakeDatabase({ locked: current })
    evaluateObligation.mockImplementation(async () => {
      fake.events.push('evaluate')
      return result()
    })

    const materialized = await materializeObligation(fake.tx, TENANT_ID, stale, {
      now: NOW,
      timezone: 'UTC',
    })

    expect(fake.events).toEqual(['lock:update', 'evaluate'])
    expect(evaluateObligation).toHaveBeenCalledWith(fake.tx, TENANT_ID, current, [], {
      now: NOW,
      timezone: 'UTC',
    })
    expect(materialized.obligation?.title).toBe('Current requirement')
    expect(materialized.materialized).toBe(true)
  })

  it('purges status and skips queued work instead of evaluating a paused row', async () => {
    const paused = obligation({ status: 'paused' })
    const fake = fakeDatabase({ locked: paused })

    const materialized = await materializeObligation(fake.tx, TENANT_ID, paused, {
      now: NOW,
      timezone: 'UTC',
    })

    expect(fake.events).toEqual(['lock:update'])
    expect(evaluateObligation).not.toHaveBeenCalled()
    expect(fake.deletes).toContain(complianceStatus)
    expect(fake.updates).toContainEqual({
      table: complianceDispatches,
      values: expect.objectContaining({ status: 'skipped', publishLeaseId: null }),
    })
    expect(materialized).toMatchObject({
      obligation: paused,
      transitions: [],
      dispatchId: null,
      materialized: false,
    })
  })

  it('writes an actionable transition to the durable dispatch ledger', async () => {
    const current = obligation()
    const fake = fakeDatabase({ locked: current, dispatchId: DISPATCH_ID })
    evaluateObligation.mockResolvedValue(
      result([
        {
          key: 'person:worker-1',
          label: 'Worker One',
          personId: '00000000-0000-4000-8000-000000000020',
          userId: null,
          subjectRef: null,
          status: 'overdue',
          dueOn: '2026-07-13',
          completedOn: null,
        },
      ]),
    )

    const materialized = await materializeObligation(fake.tx, TENANT_ID, current, {
      now: NOW,
      timezone: 'UTC',
    })

    const dispatch = fake.inserts.find((insert) => insert.table === complianceDispatches)
    expect(dispatch?.values).toMatchObject({
      tenantId: TENANT_ID,
      obligationId: OBLIGATION_ID,
      occurredAt: NOW,
      status: 'queued',
      alertPayload: {
        transitions: [expect.objectContaining({ subjectKey: 'person:worker-1', to: 'overdue' })],
      },
    })
    expect(materialized.dispatchId).toBe(DISPATCH_ID)
  })

  it('retires a queued overdue alert contradicted by newly completed evidence', async () => {
    const current = obligation()
    const fake = fakeDatabase({
      locked: current,
      prior: [
        {
          subjectKey: 'person:worker-1',
          status: 'overdue',
          periodStart: null,
          periodEnd: null,
        },
      ],
      queuedDispatches: [
        {
          id: '00000000-0000-4000-8000-000000000004',
          occurredAt: NOW,
          alertPayload: {
            transitions: [
              {
                subjectKey: 'person:worker-1',
                personId: '00000000-0000-4000-8000-000000000020',
                userId: null,
                label: 'Worker One',
                to: 'overdue',
                dueOn: '2026-07-13',
              },
            ],
          },
        },
      ],
    })
    evaluateObligation.mockResolvedValue(
      result([
        {
          key: 'person:worker-1',
          label: 'Worker One',
          personId: '00000000-0000-4000-8000-000000000020',
          userId: null,
          subjectRef: null,
          status: 'completed',
          dueOn: '2026-07-13',
          completedOn: '2026-07-14',
        },
      ]),
    )

    const materialized = await materializeObligation(fake.tx, TENANT_ID, current, {
      now: NOW,
      timezone: 'UTC',
    })

    expect(fake.updates).toContainEqual({
      table: complianceDispatches,
      values: expect.objectContaining({
        status: 'skipped',
        error: 'Superseded by newer compliance evidence',
        publishLeaseId: null,
      }),
    })
    expect(fake.inserts.some((insert) => insert.table === complianceDispatches)).toBe(false)
    expect(materialized.dispatchId).toBeNull()
  })

  it('replaces a mixed stale dispatch with only its still-current actionable subjects', async () => {
    const current = obligation()
    const personOne = '00000000-0000-4000-8000-000000000020'
    const personTwo = '00000000-0000-4000-8000-000000000021'
    const fake = fakeDatabase({
      locked: current,
      prior: [
        {
          subjectKey: 'person:worker-1',
          status: 'overdue',
          periodStart: null,
          periodEnd: null,
        },
        {
          subjectKey: 'person:worker-2',
          status: 'overdue',
          periodStart: null,
          periodEnd: null,
        },
      ],
      queuedDispatches: [
        {
          id: '00000000-0000-4000-8000-000000000004',
          occurredAt: NOW,
          alertPayload: {
            transitions: [
              {
                subjectKey: 'person:worker-1',
                personId: personOne,
                userId: null,
                label: 'Worker One',
                to: 'overdue',
                dueOn: '2026-07-13',
              },
              {
                subjectKey: 'person:worker-2',
                personId: personTwo,
                userId: null,
                label: 'Worker Two',
                to: 'overdue',
                dueOn: '2026-07-13',
              },
            ],
          },
        },
      ],
      dispatchId: DISPATCH_ID,
    })
    evaluateObligation.mockResolvedValue(
      result([
        {
          key: 'person:worker-1',
          label: 'Worker One',
          personId: personOne,
          userId: null,
          subjectRef: null,
          status: 'completed',
          dueOn: '2026-07-13',
          completedOn: '2026-07-14',
        },
        {
          key: 'person:worker-2',
          label: 'Worker Two',
          personId: personTwo,
          userId: null,
          subjectRef: null,
          status: 'overdue',
          dueOn: '2026-07-13',
          completedOn: null,
        },
      ]),
    )

    const materialized = await materializeObligation(fake.tx, TENANT_ID, current, {
      now: NOW,
      timezone: 'UTC',
    })

    const replacement = fake.inserts.find((insert) => insert.table === complianceDispatches)
    expect(replacement?.values).toMatchObject({
      occurredAt: new Date(NOW.getTime() + 1),
      alertPayload: {
        transitions: [expect.objectContaining({ subjectKey: 'person:worker-2', to: 'overdue' })],
      },
    })
    expect(
      (replacement?.values as { alertPayload?: { transitions?: unknown[] } }).alertPayload
        ?.transitions,
    ).toHaveLength(1)
    expect(materialized.dispatchId).toBe(DISPATCH_ID)
  })

  it('refreshes stale queued labels without duplicating an unchanged status edge', async () => {
    const current = obligation()
    const personId = '00000000-0000-4000-8000-000000000020'
    const fake = fakeDatabase({
      locked: current,
      prior: [
        {
          subjectKey: 'person:worker-1',
          status: 'overdue',
          periodStart: null,
          periodEnd: null,
        },
      ],
      queuedDispatches: [
        {
          id: '00000000-0000-4000-8000-000000000004',
          occurredAt: NOW,
          alertPayload: {
            transitions: [
              {
                subjectKey: 'person:worker-1',
                personId,
                userId: null,
                label: 'Old worker name',
                to: 'overdue',
                dueOn: '2026-07-13',
              },
            ],
          },
        },
      ],
      dispatchId: DISPATCH_ID,
    })
    evaluateObligation.mockResolvedValue(
      result([
        {
          key: 'person:worker-1',
          label: 'Current worker name',
          personId,
          userId: null,
          subjectRef: null,
          status: 'overdue',
          dueOn: '2026-07-13',
          completedOn: null,
        },
      ]),
    )

    await materializeObligation(fake.tx, TENANT_ID, current, {
      now: NOW,
      timezone: 'UTC',
    })

    const replacement = fake.inserts.find((insert) => insert.table === complianceDispatches)
    expect(replacement?.values).toMatchObject({
      alertPayload: {
        transitions: [expect.objectContaining({ label: 'Current worker name' })],
      },
    })
  })

  it('leaves an already-current queued alert untouched', async () => {
    const current = obligation({ title: 'Cosmetic title change' })
    const personId = '00000000-0000-4000-8000-000000000020'
    const fake = fakeDatabase({
      locked: current,
      prior: [
        {
          subjectKey: 'person:worker-1',
          status: 'overdue',
          periodStart: null,
          periodEnd: null,
        },
      ],
      queuedDispatches: [
        {
          id: '00000000-0000-4000-8000-000000000004',
          occurredAt: NOW,
          alertPayload: {
            transitions: [
              {
                subjectKey: 'person:worker-1',
                personId,
                userId: null,
                label: 'Worker One',
                to: 'overdue',
                dueOn: '2026-07-13',
              },
            ],
          },
        },
      ],
    })
    evaluateObligation.mockResolvedValue(
      result([
        {
          key: 'person:worker-1',
          label: 'Worker One',
          personId,
          userId: null,
          subjectRef: null,
          status: 'overdue',
          dueOn: '2026-07-13',
          completedOn: null,
        },
      ]),
    )

    const materialized = await materializeObligation(fake.tx, TENANT_ID, current, {
      now: NOW,
      timezone: 'UTC',
    })

    expect(
      fake.updates.some(
        (update) =>
          update.table === complianceDispatches &&
          (update.values as { status?: string }).status === 'skipped',
      ),
    ).toBe(false)
    expect(fake.inserts.some((insert) => insert.table === complianceDispatches)).toBe(false)
    expect(materialized.dispatchId).toBeNull()
  })

  it('retires duplicate queued alerts while preserving one current snapshot', async () => {
    const current = obligation()
    const personId = '00000000-0000-4000-8000-000000000020'
    const alertPayload = {
      transitions: [
        {
          subjectKey: 'person:worker-1',
          personId,
          userId: null,
          label: 'Worker One',
          to: 'overdue' as const,
          dueOn: '2026-07-13',
        },
      ],
    }
    const fake = fakeDatabase({
      locked: current,
      prior: [
        {
          subjectKey: 'person:worker-1',
          status: 'overdue',
          periodStart: null,
          periodEnd: null,
        },
      ],
      queuedDispatches: [
        {
          id: '00000000-0000-4000-8000-000000000004',
          occurredAt: NOW,
          alertPayload,
        },
        {
          id: '00000000-0000-4000-8000-000000000005',
          occurredAt: new Date(NOW.getTime() + 1),
          alertPayload,
        },
      ],
    })
    evaluateObligation.mockResolvedValue(
      result([
        {
          key: 'person:worker-1',
          label: 'Worker One',
          personId,
          userId: null,
          subjectRef: null,
          status: 'overdue',
          dueOn: '2026-07-13',
          completedOn: null,
        },
      ]),
    )

    await materializeObligation(fake.tx, TENANT_ID, current, {
      now: NOW,
      timezone: 'UTC',
    })

    expect(fake.updates).toContainEqual({
      table: complianceDispatches,
      values: expect.objectContaining({
        status: 'skipped',
        error: 'Superseded by newer compliance evidence',
      }),
    })
    expect(fake.inserts.some((insert) => insert.table === complianceDispatches)).toBe(false)
  })

  it('only treats pending as actionable for scheduled forms', () => {
    const pending = {
      subjectKey: 'person:worker-1',
      personId: null,
      userId: null,
      label: 'Worker One',
      from: null,
      to: 'pending' as const,
      dueOn: null,
    }
    expect(actionableComplianceTransitions(obligation(), [pending])).toEqual([])
    expect(
      actionableComplianceTransitions(obligation({ sourceModule: 'form' }), [pending]),
    ).toEqual([pending])
  })
})
