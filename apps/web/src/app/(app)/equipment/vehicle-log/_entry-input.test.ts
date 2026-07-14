import { describe, expect, it } from 'vitest'
import { normalizeVehicleLogEntryInput } from './_entry-input'

const VEHICLE_ID = '10000000-0000-4000-8000-000000000001'
const DRIVER_ID = '10000000-0000-4000-8000-000000000002'

function validInput() {
  return {
    equipmentItemId: VEHICLE_ID,
    driverPersonId: DRIVER_ID,
    entryDate: '2028-02-29',
    entryMode: 'odometer',
  }
}

describe('vehicle-log entry input', () => {
  it('normalizes a bounded manual entry and never accepts import provenance', () => {
    expect(
      normalizeVehicleLogEntryInput({
        ...validInput(),
        startOdometer: 100,
        endOdometer: 125,
        hoursOnSite: '8.5',
        notes: '  complete  ',
        importStatus: 'imported',
        sourceExternalId: 'spoofed',
      }),
    ).toMatchObject({
      startOdometer: 100,
      endOdometer: 125,
      hoursOnSite: '8.50',
      notes: 'complete',
    })
    expect(normalizeVehicleLogEntryInput(validInput())).not.toHaveProperty('importStatus')
    expect(normalizeVehicleLogEntryInput(validInput())).not.toHaveProperty('sourceExternalId')
  })

  it('rejects malformed identity, mode, and calendar values', () => {
    expect(() =>
      normalizeVehicleLogEntryInput({ ...validInput(), equipmentItemId: 'bad' }),
    ).toThrow(/Equipment item is invalid/)
    expect(() => normalizeVehicleLogEntryInput({ ...validInput(), entryMode: 'other' })).toThrow(
      /Entry mode is invalid/,
    )
    expect(() =>
      normalizeVehicleLogEntryInput({ ...validInput(), entryDate: '2027-02-29' }),
    ).toThrow(/Entry date is invalid/)
  })

  it('rejects reversed, negative, fractional, oversized, and unbounded values', () => {
    for (const patch of [
      { startOdometer: 100, endOdometer: 99 },
      { businessKm: -1 },
      { manpowerCount: 1.5 },
      { hoursOnSite: '24.01' },
      { notes: 'x'.repeat(5_001) },
    ]) {
      expect(() => normalizeVehicleLogEntryInput({ ...validInput(), ...patch })).toThrow()
    }
  })
})
