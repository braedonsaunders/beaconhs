import { beforeEach, describe, expect, it, vi } from 'vitest'

const TENANT_A = '10000000-0000-4000-8000-000000000001'
const TENANT_B = '10000000-0000-4000-8000-000000000002'
const NOW = new Date('2026-07-13T12:00:00.000Z')

const mocks = vi.hoisted(() => ({
  claimed: [] as Array<{
    id: string
    tenantId: string
    attachmentId: string
    objectKey: string
    attempts: number
    leaseId: string
    claimedAt: Date
  }>,
  claim: vi.fn(),
  complete: vi.fn(),
  retry: vi.fn(),
  deleteObject: vi.fn(),
}))

vi.mock('@beaconhs/db', () => ({
  db: {},
  withSuperAdmin: async (_db: unknown, run: (tx: unknown) => Promise<unknown>) => run({}),
  claimStorageObjectDeletionBatch: async (...args: unknown[]) => {
    mocks.claim(...args)
    return mocks.claimed
  },
  completeStorageObjectDeletion: async (...args: unknown[]) => mocks.complete(...args),
  retryStorageObjectDeletion: async (...args: unknown[]) => mocks.retry(...args),
}))

vi.mock('@beaconhs/storage', () => ({
  assertTenantObjectKey: ({ tenantId, key }: { tenantId: string; key: string }) => {
    if (!key.startsWith(`t/${tenantId}/`)) throw new Error('cross-tenant key')
  },
  deleteObject: async (...args: unknown[]) => mocks.deleteObject(...args),
}))

import { drainStorageObjectDeletionOutbox } from './storage-object-deletion-outbox'

function intent(id: string, tenantId: string) {
  return {
    id,
    tenantId,
    attachmentId: `${id.slice(0, -1)}a`,
    objectKey: `t/${tenantId}/image/${id}.png`,
    attempts: 1,
    leaseId: `${id.slice(0, -1)}b`,
    claimedAt: NOW,
  }
}

describe('storage object deletion outbox worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.claimed = []
    mocks.complete.mockResolvedValue(true)
    mocks.retry.mockResolvedValue(true)
    mocks.deleteObject.mockResolvedValue(undefined)
  })

  it('claims a bounded batch, completes successes, and durably retries failures', async () => {
    const first = intent('20000000-0000-4000-8000-000000000001', TENANT_A)
    const second = intent('20000000-0000-4000-8000-000000000002', TENANT_B)
    mocks.claimed = [first, second]
    mocks.deleteObject
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined)

    await expect(drainStorageObjectDeletionOutbox(NOW)).resolves.toEqual({
      claimed: 2,
      deleted: 1,
      retried: 1,
    })
    expect(mocks.claim).toHaveBeenCalledWith({}, { now: NOW, limit: 50 })
    expect(mocks.complete).toHaveBeenCalledOnce()
    expect(mocks.complete.mock.calls[0]![1]).toEqual({
      id: second.id,
      leaseId: second.leaseId,
    })
    expect(mocks.retry).toHaveBeenCalledOnce()
    expect(mocks.retry.mock.calls[0]![1]).toMatchObject({
      id: first.id,
      leaseId: first.leaseId,
      attempts: 1,
    })
  })

  it('never sends a cross-tenant key to storage and retains it for operator-safe retry', async () => {
    const bad = intent('20000000-0000-4000-8000-000000000003', TENANT_A)
    bad.objectKey = `t/${TENANT_B}/image/bad.png`
    mocks.claimed = [bad]

    await expect(drainStorageObjectDeletionOutbox(NOW)).resolves.toEqual({
      claimed: 1,
      deleted: 0,
      retried: 1,
    })
    expect(mocks.deleteObject).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.retry).toHaveBeenCalledOnce()
  })

  it('does not report a stale completion after the exact lease was superseded', async () => {
    mocks.claimed = [intent('20000000-0000-4000-8000-000000000004', TENANT_A)]
    mocks.complete.mockResolvedValue(false)

    await expect(drainStorageObjectDeletionOutbox(NOW)).resolves.toEqual({
      claimed: 1,
      deleted: 0,
      retried: 0,
    })
    expect(mocks.retry).not.toHaveBeenCalled()
    expect(mocks.complete.mock.calls[0]![1]).toMatchObject({
      leaseId: mocks.claimed[0]!.leaseId,
    })
  })
})
