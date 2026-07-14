import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@beaconhs/db'
import { complianceDispatches, complianceObligations } from '@beaconhs/db/schema'
import {
  confirmDispatchStillPublishable,
  publishClaimedComplianceDispatch,
} from './compliance-scanner'

const TENANT_ID = '00000000-0000-4000-8000-000000000001'
const OBLIGATION_ID = '00000000-0000-4000-8000-000000000002'
const DISPATCH_ID = '00000000-0000-4000-8000-000000000003'
const LEASE_ID = '00000000-0000-4000-8000-000000000004'

function query<T>(rows: T[], onLock: (mode: string) => void) {
  let value: Promise<T[]> & Record<string, (...args: unknown[]) => unknown>
  const promise = Promise.resolve(rows) as Promise<T[]> &
    Record<string, (...args: unknown[]) => unknown>
  value = promise
  value.where = () => value
  value.limit = () => value
  value.for = (mode) => {
    onLock(String(mode))
    return value
  }
  return value
}

function fakeDatabase(
  obligation: {
    id: string
    status: 'active' | 'paused' | 'archived'
    deletedAt: Date | null
  } | null,
  ownsLease = true,
) {
  const events: string[] = []
  const updates: Array<{ table: unknown; values: Record<string, unknown> }> = []
  const tx = {
    select: vi.fn(() => ({
      from: (table: unknown) => {
        if (table !== complianceObligations) throw new Error('Unexpected selected table')
        return query(obligation ? [obligation] : [], (mode) => events.push(`lock:${mode}`))
      },
    })),
    update: vi.fn((table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table, values })
        events.push('update:dispatch')
        return {
          where: () => ({
            returning: async () => (ownsLease ? [{ id: DISPATCH_ID }] : []),
            then: (resolve: (value: undefined) => unknown, reject?: (reason: unknown) => unknown) =>
              Promise.resolve(undefined).then(resolve, reject),
          }),
        }
      },
    })),
  } as unknown as Database
  return { tx, events, updates }
}

describe('compliance dispatch lifecycle', () => {
  it('locks the obligation before touching its leased dispatch', async () => {
    const fake = fakeDatabase({ id: OBLIGATION_ID, status: 'active', deletedAt: null })

    await expect(
      confirmDispatchStillPublishable(fake.tx, DISPATCH_ID, LEASE_ID, TENANT_ID, OBLIGATION_ID),
    ).resolves.toBe(true)

    expect(fake.events).toEqual(['lock:key share', 'update:dispatch'])
    expect(fake.updates).toContainEqual({
      table: complianceDispatches,
      values: expect.objectContaining({ publishClaimedAt: expect.any(Date) }),
    })
  })

  it.each([
    { label: 'paused', row: { id: OBLIGATION_ID, status: 'paused' as const, deletedAt: null } },
    {
      label: 'deleted',
      row: { id: OBLIGATION_ID, status: 'active' as const, deletedAt: new Date() },
    },
    { label: 'missing', row: null },
  ])('marks a $label obligation dispatch skipped', async ({ row }) => {
    const fake = fakeDatabase(row)

    await expect(
      confirmDispatchStillPublishable(fake.tx, DISPATCH_ID, LEASE_ID, TENANT_ID, OBLIGATION_ID),
    ).resolves.toBe(false)

    expect(fake.updates).toContainEqual({
      table: complianceDispatches,
      values: expect.objectContaining({
        status: 'skipped',
        publishLeaseId: null,
        publishClaimedAt: null,
      }),
    })
  })

  it('refuses an active dispatch after its publication lease is lost', async () => {
    const fake = fakeDatabase({ id: OBLIGATION_ID, status: 'active', deletedAt: null }, false)

    await expect(
      confirmDispatchStillPublishable(fake.tx, DISPATCH_ID, LEASE_ID, TENANT_ID, OBLIGATION_ID),
    ).resolves.toBe(false)

    expect(fake.events).toEqual(['lock:key share', 'update:dispatch'])
  })

  it('keeps validation and terminal dispatch mutation around the queue emission', async () => {
    const fake = fakeDatabase({ id: OBLIGATION_ID, status: 'active', deletedAt: null })
    const emit = vi.fn(async () => {
      fake.events.push('emit')
      return true
    })

    await expect(
      publishClaimedComplianceDispatch(
        fake.tx,
        {
          id: DISPATCH_ID,
          tenantId: TENANT_ID,
          obligationId: OBLIGATION_ID,
          publishLeaseId: LEASE_ID,
          alertPayload: {
            transitions: [
              {
                subjectKey: 'person:worker-1',
                personId: '00000000-0000-4000-8000-000000000005',
                userId: null,
                label: 'Worker One',
                to: 'overdue',
                dueOn: '2026-07-13',
              },
            ],
          },
        },
        emit,
      ),
    ).resolves.toBe('enqueued')

    expect(fake.events).toEqual(['lock:key share', 'update:dispatch', 'emit', 'update:dispatch'])
    expect(fake.updates.at(-1)).toEqual({
      table: complianceDispatches,
      values: expect.objectContaining({
        status: 'enqueued',
        publishLeaseId: null,
        publishClaimedAt: null,
      }),
    })
    expect(emit).toHaveBeenCalledWith(
      TENANT_ID,
      OBLIGATION_ID,
      expect.any(Array),
      DISPATCH_ID,
      LEASE_ID,
      fake.tx,
    )
  })
})
