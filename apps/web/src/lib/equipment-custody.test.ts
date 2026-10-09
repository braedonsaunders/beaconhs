import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Database } from '@beaconhs/db'
import { equipmentCheckouts, equipmentItems, equipmentLocationHistory } from '@beaconhs/db/schema'
import {
  checkInEquipmentInTx,
  equipmentIsCheckedOutSql,
  isEquipmentAvailableForCheckout,
  openCheckoutConflictMessage,
} from './equipment-custody'

describe('equipment custody policy', () => {
  it('separates physical custody from service availability', () => {
    const base = { status: 'in_service' as const, isMissing: false, isCheckedOut: false }
    expect(isEquipmentAvailableForCheckout(base)).toBe(true)
    for (const status of ['out_of_service', 'in_repair', 'lost', 'retired'] as const) {
      expect(isEquipmentAvailableForCheckout({ ...base, status })).toBe(false)
    }
    expect(isEquipmentAvailableForCheckout({ ...base, isMissing: true })).toBe(false)
    expect(isEquipmentAvailableForCheckout({ ...base, isCheckedOut: true })).toBe(false)
    expect(isEquipmentAvailableForCheckout({ ...base, deletedAt: new Date() })).toBe(false)
    const sql = new PgDialect().sqlToQuery(equipmentIsCheckedOutSql).sql
    expect(sql).toContain('co.returned_at IS NULL')
    expect(sql).toContain('"equipment_items"."current_holder_person_id" IS NOT NULL')
    expect(sql).toContain('location.is_equipment_base')
    expect(sql).toContain('station.default_check_in_org_unit_id = location.id')
    expect(sql).not.toContain('"status"')
    expect(sql).not.toContain('"is_available_for_checkout"')
  })

  it('names direct-custody conflicts without producing an unbounded error', () => {
    expect(openCheckoutConflictMessage([{ assetTag: 'EQ-1' }])).toBe(
      'Check in this item before changing direct custody: EQ-1.',
    )
    expect(
      openCheckoutConflictMessage(
        ['EQ-1', 'EQ-2', 'EQ-3', 'EQ-4'].map((assetTag) => ({ assetTag })),
      ),
    ).toBe('Check in these items before changing direct custody: EQ-1, EQ-2, EQ-3 and 1 more.')
  })
})

const item = {
  id: 'item-a',
  assetTag: 'EWR9',
  typeId: null,
  status: 'in_service',
  currentSiteOrgUnitId: 'apotex',
  currentHolderPersonId: null,
  isMissing: false,
  deletedAt: null,
  isCheckedOut: true,
}
const args = {
  tenantId: 'tenant-a',
  itemId: item.id,
  actorTenantUserId: 'member-a',
  actorPersonId: null,
  canManage: true,
  condition: 'good' as const,
  notes: 'Returned to the shop',
}

/** Queue reads, retaining every mutation for assertions about authorization and atomic custody. */
function transaction(reads: unknown[][]) {
  const writes: Array<{ table: unknown; values: unknown }> = []
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    for: () => chain,
    innerJoin: () => chain,
    then: (resolve: (rows: unknown[]) => unknown) =>
      Promise.resolve(reads.shift() ?? []).then(resolve),
  }
  const tx = {
    select: () => chain,
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: async () => {
          writes.push({ table, values })
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        writes.push({ table, values })
      },
    }),
  } as unknown as Database
  return { tx, writes }
}

describe('equipment check-in', () => {
  it('returns imported off-base equipment without manufacturing a checkout', async () => {
    const { tx, writes } = transaction([
      [item],
      [],
      [{ id: 'home', name: 'Shop' }],
      [{ ...item, isCheckedOut: false }],
    ])
    const result = await checkInEquipmentInTx(tx, args)
    expect(result).toMatchObject({ itemId: item.id, checkoutId: null, returnSiteOrgUnitId: 'home' })
    expect(writes.filter((w) => w.table === equipmentCheckouts)).toEqual([])
    expect(writes.filter((w) => w.table === equipmentItems)).toEqual([
      {
        table: equipmentItems,
        values: expect.objectContaining({
          currentSiteOrgUnitId: 'home',
          currentHolderPersonId: null,
          lastSeenHolderPersonId: null,
        }),
      },
      { table: equipmentItems, values: { isAvailableForCheckout: true } },
    ])
    expect(writes.filter((w) => w.table === equipmentLocationHistory)).toEqual([
      {
        table: equipmentLocationHistory,
        values: expect.objectContaining({
          movementKind: 'check_in',
          condition: 'good',
          note: args.notes,
          siteOrgUnitId: 'home',
          holderPersonId: null,
        }),
      },
    ])
  })

  it('closes the open checkout and preserves the return condition', async () => {
    const { tx, writes } = transaction([
      [item],
      [{ id: 'checkout-a', holderPersonId: 'person-a' }],
      [{ id: 'home', name: 'Shop' }],
      [{ ...item, isCheckedOut: false }],
    ])
    await checkInEquipmentInTx(tx, {
      ...args,
      expectedCheckoutId: 'checkout-a',
      canManage: false,
      actorPersonId: 'person-a',
      condition: 'damaged',
    })
    expect(writes.find((w) => w.table === equipmentCheckouts)?.values).toMatchObject({
      returnedAt: expect.any(Date),
      returnedCondition: 'damaged',
      returnedNotes: args.notes,
      checkedInByTenantUserId: 'member-a',
    })
    expect(writes.find((w) => w.table === equipmentLocationHistory)?.values).toMatchObject({
      condition: 'damaged',
    })
  })

  it('lets the current holder return equipment without a checkout ledger row', async () => {
    const { tx } = transaction([
      [{ ...item, currentHolderPersonId: 'person-a' }],
      [],
      [{ id: 'home', name: 'Shop' }],
      [{ ...item, isCheckedOut: false }],
    ])
    await expect(
      checkInEquipmentInTx(tx, { ...args, canManage: false, actorPersonId: 'person-a' }),
    ).resolves.toMatchObject({ itemId: item.id })
  })

  it('rejects other workers before any mutation', async () => {
    const { tx, writes } = transaction([[{ ...item, currentHolderPersonId: 'person-a' }], []])
    await expect(
      checkInEquipmentInTx(tx, { ...args, canManage: false, actorPersonId: 'person-b' }),
    ).rejects.toThrow('Forbidden')
    expect(writes).toEqual([])
  })

  it('does not let a stale checkout form close a newer loan', async () => {
    const { tx, writes } = transaction([[item], [{ id: 'new-checkout' }]])
    await expect(
      checkInEquipmentInTx(tx, { ...args, expectedCheckoutId: 'old-checkout' }),
    ).resolves.toBeNull()
    expect(writes).toEqual([])
  })

  it('does not duplicate a return when equipment is already checked in', async () => {
    const { tx, writes } = transaction([
      [{ ...item, currentSiteOrgUnitId: 'home', isCheckedOut: false }],
      [],
    ])
    await expect(checkInEquipmentInTx(tx, args)).resolves.toBeNull()
    expect(writes).toEqual([])
  })

  it('does not clear custody when the configured return location is missing or deleted', async () => {
    const { tx, writes } = transaction([[item], [], []])
    await expect(checkInEquipmentInTx(tx, args)).rejects.toThrow('valid default check-in location')
    expect(writes).toEqual([])
  })
})
