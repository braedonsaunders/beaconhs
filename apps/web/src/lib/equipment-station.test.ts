import { describe, expect, it } from 'vitest'
import type { Database } from '@beaconhs/db'
import { equipmentCheckouts, equipmentItems } from '@beaconhs/db/schema'
import { parseStationScanInput, stationScanCore } from './equipment-station'

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
