import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  visible: vi.fn(),
  audit: vi.fn(),
  redirect: vi.fn(),
}))
vi.mock('../../../../lib/auth', () => ({ requireRequestContext: mocks.auth }))
vi.mock('../../../../lib/visibility', () => ({ canSeeRecord: mocks.visible }))
vi.mock('../../../../lib/audit', () => ({ recordAuditInTransaction: mocks.audit }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

import { saveLogEntry } from './_log-actions'

const itemId = '10000000-0000-4000-8000-000000000001'
const entryId = '20000000-0000-4000-8000-000000000002'
const existing = {
  id: entryId,
  entryDate: '2026-09-30',
  kind: 'maintenance',
  amount: '100.00',
  title: 'Service',
  details: 'Original details',
  updatedAt: new Date('2026-09-30T12:00:00Z'),
}
const whereClauses: SQL[] = []
const selections: unknown[][] = []
const update = vi.fn()
const insert = vi.fn()
const tx = {
  select: () => ({
    from: () => ({
      where: (condition: SQL) => {
        whereClauses.push(condition)
        return {
          limit: () => {
            const result = Promise.resolve(selections.shift() ?? [])
            return Object.assign(result, { for: () => result })
          },
        }
      },
    }),
  }),
  update: () => ({
    set: (values: unknown) => ({
      where: (condition: SQL) => {
        update(values)
        whereClauses.push(condition)
        return Promise.resolve()
      },
    }),
  }),
  insert: () => ({
    values: (values: unknown) => ({
      returning: async () => {
        insert(values)
        return [{ id: entryId }]
      },
    }),
  }),
}
const context = {
  tenantId: 'tenant-a',
  membership: { id: 'member-a' },
  isSuperAdmin: false,
  permissions: new Set(['equipment.manage']),
  db: vi.fn(async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx)),
}
function form(overrides: Record<string, string> = {}) {
  const data = new FormData()
  for (const [key, value] of Object.entries({
    itemId,
    entryId,
    expectedUpdatedAt: existing.updatedAt.toISOString(),
    entryDate: '2026-10-01',
    kind: 'maintenance',
    amount: '-25.50',
    title: 'Corrected service',
    details: 'Corrected details',
    returnHref: `/equipment/${itemId}?tab=log&log_q=service&log_p=2&drawer=edit-log&entryId=${entryId}`,
    ...overrides,
  }))
    data.set(key, value)
  return data
}
beforeEach(() => {
  vi.clearAllMocks()
  whereClauses.length = 0
  selections.length = 0
  selections.push([{ id: itemId, siteId: 'site-a', personId: null }], [{ ...existing }])
  context.permissions = new Set(['equipment.manage'])
  mocks.auth.mockResolvedValue(context)
  mocks.visible.mockResolvedValue(true)
})
describe('equipment log edits', () => {
  it('rejects viewers before reading or changing a record', async () => {
    context.permissions = new Set(['equipment.read.all'])
    await expect(saveLogEntry(form())).rejects.toThrow()
    expect(context.db).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
  it('rejects equipment outside the viewer’s site scope', async () => {
    mocks.visible.mockResolvedValue(false)
    await expect(saveLogEntry(form())).rejects.toThrow('Equipment item was not found')
    expect(update).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('only updates editable fields of a log belonging to this equipment and audits before/after', async () => {
    const data = form()
    data.set('tenantId', 'tenant-b')
    data.set('attachmentId', 'replace-file')
    data.set('metadata', '{"source":"replaced"}')
    await saveLogEntry(data)
    expect(new PgDialect().sqlToQuery(whereClauses[1]!).params).toEqual([entryId, itemId])
    expect(update).toHaveBeenCalledExactlyOnceWith({
      entryDate: '2026-10-01',
      kind: 'maintenance',
      amount: '-25.50',
      title: 'Corrected service',
      details: 'Corrected details',
    })
    expect(mocks.audit).toHaveBeenCalledWith(
      tx,
      context,
      expect.objectContaining({
        entityId: entryId,
        action: 'update',
        before: expect.objectContaining({ amount: '100.00' }),
        after: expect.objectContaining({ amount: '-25.50' }),
      }),
    )
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/equipment/${itemId}?tab=log&log_q=service&log_p=2`,
    )
  })
  it('rejects a missing entry or a concurrent edit without writing', async () => {
    selections[1] = []
    await expect(saveLogEntry(form())).rejects.toThrow('Log entry was not found')
    selections.push(
      [{ id: itemId, siteId: 'site-a', personId: null }],
      [{ ...existing, updatedAt: new Date('2026-09-30T12:01:00Z') }],
    )
    await expect(saveLogEntry(form())).rejects.toThrow('This log entry changed')
    expect(update).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('clears the amount when changing to another kind and rejects invalid money or return paths', async () => {
    await saveLogEntry(form({ kind: 'note', amount: '' }))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ kind: 'note', amount: null }))
    await expect(saveLogEntry(form({ amount: '2.555' }))).rejects.toThrow(/decimal places/)
    await expect(
      saveLogEntry(form({ returnHref: 'https://external.example/equipment' })),
    ).rejects.toThrow('Return path is invalid')
  })
  it('still creates entries through the same permission and audit boundary', async () => {
    await saveLogEntry(form({ entryId: '', expectedUpdatedAt: '' }))
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        equipmentItemId: itemId,
        amount: '-25.50',
        createdByTenantUserId: 'member-a',
      }),
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      tx,
      context,
      expect.objectContaining({ action: 'create' }),
    )
  })
})
