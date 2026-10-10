import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  lock: vi.fn(),
  open: vi.fn(),
  refresh: vi.fn(),
  audit: vi.fn(),
  redirect: vi.fn(),
}))
vi.mock('../../../../lib/auth', () => ({ requireRequestContext: mocks.auth }))
vi.mock('../../../../lib/audit', () => ({ recordAuditInTransaction: mocks.audit }))
vi.mock('../../../../lib/equipment-custody', () => ({
  lockEquipmentCustodyRows: mocks.lock,
  openEquipmentCheckoutItemIds: mocks.open,
  refreshEquipmentAvailability: mocks.refresh,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
import { transferLocation } from './_custody-actions'
const id = '10000000-0000-4000-8000-000000000001',
  customer = '20000000-0000-4000-8000-000000000002',
  site = '30000000-0000-4000-8000-000000000003',
  person = '40000000-0000-4000-8000-000000000004'
const selections: unknown[][] = [],
  conditions: SQL[] = []
const update = vi.fn(),
  insert = vi.fn()
const tx = {
  select: () => ({
    from: () => ({
      where: (condition: SQL) => {
        conditions.push(condition)
        return { limit: async () => selections.shift() ?? [] }
      },
    }),
  }),
  update: () => ({ set: (values: unknown) => ({ where: async () => update(values) }) }),
  insert: () => ({ values: async (values: unknown) => insert(values) }),
}
const ctx = {
  tenantId: 'tenant-a',
  membership: { id: 'member-a' },
  isSuperAdmin: false,
  permissions: new Set(['equipment.manage']),
  db: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
}
function form(location = customer, holder = person) {
  const f = new FormData()
  f.set('id', id)
  f.set('siteOrgUnitId', location)
  f.set('holderPersonId', holder)
  return f
}
beforeEach(() => {
  vi.clearAllMocks()
  selections.length = 0
  conditions.length = 0
  mocks.auth.mockResolvedValue(ctx)
  ctx.permissions = new Set(['equipment.manage'])
  mocks.lock.mockResolvedValue([
    {
      id,
      currentSiteOrgUnitId: customer,
      currentHolderPersonId: null,
      isMissing: false,
      deletedAt: null,
    },
  ])
  mocks.open.mockResolvedValue(new Set())
})
describe('direct equipment custody transfers', () => {
  it('changes the truck holder while preserving its imported customer location', async () => {
    selections.push([{ id: person }])
    await transferLocation(form())
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ currentSiteOrgUnitId: customer, currentHolderPersonId: person }),
    )
    expect(conditions).toHaveLength(1)
    expect(new PgDialect().sqlToQuery(conditions[0]!).params).toContain('active')
    expect(insert).toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(
      tx,
      ctx,
      expect.objectContaining({ before: { siteOrgUnitId: customer, holderPersonId: null } }),
    )
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/equipment/${id}?tab=location&locationView=custody`,
    )
  })
  it('still rejects a newly selected location that is not an active location', async () => {
    selections.push([])
    await expect(transferLocation(form(site))).rejects.toThrow('Select an active location')
    expect(update).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(new PgDialect().sqlToQuery(conditions[0]!).params).toEqual([site])
  })
  it('accepts active customer and project locations without a site-level restriction', async () => {
    selections.push([{ id: site }], [{ id: person }])
    await transferLocation(form(site))
    expect(new PgDialect().sqlToQuery(conditions[0]!).params).toEqual([site])
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ currentSiteOrgUnitId: site }))
    expect(mocks.refresh).toHaveBeenCalledWith(tx, [id])
  })
  it('still rejects a newly selected inactive person', async () => {
    selections.push([])
    await expect(transferLocation(form())).rejects.toThrow('Select an active holder')
    expect(update).not.toHaveBeenCalled()
  })
  it('blocks direct transfers until an open checkout is checked in', async () => {
    selections.push([{ id: person }])
    mocks.open.mockResolvedValue(new Set([id]))
    await expect(transferLocation(form())).rejects.toThrow('Check this item in')
    expect(update).not.toHaveBeenCalled()
  })
  it('rejects unprivileged callers before reading or writing custody', async () => {
    ctx.permissions = new Set(['equipment.read.all'])
    await expect(transferLocation(form())).rejects.toThrow()
    expect(mocks.lock).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
})
