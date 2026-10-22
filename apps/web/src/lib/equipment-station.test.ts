import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@beaconhs/db'
import { equipmentCheckouts, equipmentItems } from '@beaconhs/db/schema'
import { parseStationScanInput, stationScanCore, searchStationCore } from './equipment-station'

const PERSON = '00000000-0000-4000-8000-000000000001'

describe('equipment station scan input', () => {
  it('normalizes a valid scan and bounded notes', () => {
    expect(
      parseStationScanInput({
        code: '  EQ-101 ',
        activePersonId: PERSON,
        direction: 'out',
        expectedReturnOn: '2026-07-31',
        returnedNotes: ' ready ',
      }),
    ).toEqual({
      code: 'EQ-101',
      activePersonId: PERSON,
      destinationOrgUnitId: undefined,
      direction: 'out',
      expectedReturnOn: '2026-07-31',
      condition: undefined,
      returnedNotes: 'ready',
    })
  })

  it('rejects malformed ids, dates, directions, oversized codes, and oversized notes', () => {
    expect(parseStationScanInput({ code: 'EQ', activePersonId: 'not-a-uuid' })).toBeNull()
    expect(parseStationScanInput({ code: 'EQ', expectedReturnOn: '2026-02-31' })).toBeNull()
    expect(parseStationScanInput({ code: 'EQ', direction: 'sideways' })).toBeNull()
    expect(parseStationScanInput({ code: 'x'.repeat(201) })).toBeNull()
    expect(parseStationScanInput({ code: 'EQ', returnedNotes: 'x'.repeat(2_001) })).toBeNull()
  })
})

const asset = {
  id: 'truck',
  assetTag: 'TRUCK-1',
  name: 'Foreman truck',
  status: 'in_service',
  isMissing: false,
  isOut: false,
}
function checkoutTx(reads: unknown[][]) {
  const writes: Array<{ table: unknown; values: unknown }> = []
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    for: () => chain,
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
      values: (values: unknown) => {
        writes.push({ table, values })
        return Object.assign(Promise.resolve(), { returning: async () => [{ id: 'checkout' }] })
      },
    }),
  } as unknown as Database
  return { tx, writes }
}
const checkoutArgs = {
  code: 'TRUCK-1',
  tenantId: 'tenant',
  actorTenantUserId: null,
  direction: 'out' as const,
  requireHolderOnCheckout: false,
}
describe('person-only equipment checkout', () => {
  it('issues a truck indefinitely to a person without a fixed destination', async () => {
    const { tx, writes } = checkoutTx([[asset], [{ first: 'Alex', last: 'Foreman' }]])
    expect(await stationScanCore(tx, { ...checkoutArgs, activePersonId: PERSON })).toMatchObject({
      ok: true,
      action: 'checked_out',
      holderName: 'Alex Foreman',
      locationName: null,
    })
    expect(writes.find((w) => w.table === equipmentCheckouts)?.values).toMatchObject({
      holderPersonId: PERSON,
      destinationOrgUnitId: null,
      expectedReturnOn: null,
    })
    expect(writes.find((w) => w.table === equipmentItems)?.values).toMatchObject({
      currentHolderPersonId: PERSON,
      currentSiteOrgUnitId: null,
      isAvailableForCheckout: false,
    })
  })
  it('still requires a person or destination, validates the person and honors mandatory-holder settings', async () => {
    for (const [input, reads, message] of [
      [checkoutArgs, [[asset]], 'Pick a person or a check-out destination before checking out'],
      [
        { ...checkoutArgs, activePersonId: PERSON },
        [[asset], []],
        'Pick a valid holder before checking out',
      ],
      [
        { ...checkoutArgs, requireHolderOnCheckout: true, destinationOrgUnitId: PERSON },
        [[asset]],
        'Scan or pick a person before checking out',
      ],
    ] as const) {
      const { tx, writes } = checkoutTx(reads.map((rows) => [...rows]))
      expect(await stationScanCore(tx, input)).toEqual({ ok: false, error: message })
      expect(writes).toEqual([])
    }
  })
  it('preserves destination-only checkout and rejects invalid destinations', async () => {
    const valid = checkoutTx([[asset], [{ name: 'Site A' }]])
    expect(
      await stationScanCore(valid.tx, { ...checkoutArgs, destinationOrgUnitId: PERSON }),
    ).toMatchObject({ ok: true, holderName: null, locationName: 'Site A' })
    const invalid = checkoutTx([[asset], []])
    expect(
      await stationScanCore(invalid.tx, {
        ...checkoutArgs,
        activePersonId: PERSON,
        destinationOrgUnitId: PERSON,
      }),
    ).toEqual({ ok: false, error: 'Pick a valid check-out destination' })
    expect(invalid.writes).toEqual([])
  })
})

describe('reviewed station movements', () => {
  it('rejects a stale checkout without toggling it into a check-in', async () => {
    const { tx, writes } = checkoutTx([[{ ...asset, isOut: true }]])
    expect(await stationScanCore(tx, { ...checkoutArgs, activePersonId: PERSON })).toEqual({
      ok: false,
      error: 'TRUCK-1 is already checked out',
    })
    expect(writes).toEqual([])
  })
  it('rejects an equipment tag that has been reassigned since review', async () => {
    const { tx, writes } = checkoutTx([[asset]])
    expect(await stationScanCore(tx, { ...checkoutArgs, equipmentItemId: PERSON })).toEqual({
      ok: false,
      error: 'Equipment no longer matches this tag. Remove it and search again.',
    })
    expect(writes).toEqual([])
    expect(parseStationScanInput({ code: 'TRUCK-1', equipmentItemId: 'invalid' })).toBeNull()
    expect(parseStationScanInput({ code: 'TRUCK-1', equipmentItemId: PERSON })).toMatchObject({
      equipmentItemId: PERSON,
    })
  })
  it('enforces the configured return condition before changing custody', async () => {
    const { tx, writes } = checkoutTx([[{ ...asset, isOut: true }]])
    expect(
      await stationScanCore(tx, {
        ...checkoutArgs,
        direction: 'in',
        requireConditionOnCheckin: true,
      }),
    ).toEqual({ ok: false, error: 'Choose a return condition before checking in' })
    expect(writes).toEqual([])
  })
})

describe('station code lookup', () => {
  it('resolves printed scan URLs as equipment tokens without issuing a movement', async () => {
    const conditions: unknown[] = []
    const equipmentRow = { ...asset, typeName: 'Truck', holderFirst: null, holderLast: null }
    const results: unknown[][] = [[equipmentRow], []]
    const chain = {
      from: () => chain,
      leftJoin: () => chain,
      where: (condition: unknown) => {
        conditions.push(condition)
        return chain
      },
      orderBy: () => chain,
      limit: async () => results.shift() ?? [],
    }
    const tx = { select: () => chain, insert: vi.fn(), update: vi.fn() } as unknown as Database
    expect(
      await searchStationCore(tx, 'https://beacon.example/equipment/scan/token-123', 24, 'code'),
    ).toMatchObject({ equipment: [{ id: asset.id, assetTag: asset.assetTag }], people: [] })
    const { PgDialect } = await import('drizzle-orm/pg-core')
    const query = new PgDialect().sqlToQuery(conditions[0] as import('drizzle-orm').SQL)
    expect(query.params).toContain('token-123')
    expect(query.sql).toContain('qr_token')
    expect(query.sql).not.toContain('ilike')
    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalled()
  })
})
