import { describe, expect, it } from 'vitest'
import { parseStationBaseLocationInput, parseStationSettingsInput } from './_policy'

const ID = '10000000-0000-4000-8000-000000000001'

describe('equipment station settings policy', () => {
  it('accepts exact, typed settings and normalizes identifiers', () => {
    expect(
      parseStationSettingsInput({
        defaultCheckInOrgUnitId: ID.toUpperCase(),
        stationPin: ' 4821 ',
        clearStationPin: false,
        scanMode: 'explicit',
        requireHolderOnCheckout: true,
        requireConditionOnCheckin: false,
        soundEnabled: true,
      }),
    ).toEqual({
      defaultCheckInOrgUnitId: ID,
      stationPin: '4821',
      clearStationPin: false,
      scanMode: 'explicit',
      requireHolderOnCheckout: true,
      requireConditionOnCheckin: false,
      soundEnabled: true,
    })
  })

  it('rejects silent coercions, augmented objects, and conflicting PIN actions', () => {
    const valid = {
      defaultCheckInOrgUnitId: null,
      stationPin: null,
      clearStationPin: false,
      scanMode: 'toggle',
      requireHolderOnCheckout: false,
      requireConditionOnCheckin: false,
      soundEnabled: true,
    }
    expect(() => parseStationSettingsInput({ ...valid, scanMode: 'automatic' })).toThrow(
      /scan mode is invalid/,
    )
    expect(() => parseStationSettingsInput({ ...valid, soundEnabled: 1 })).toThrow(
      /Sound setting is invalid/,
    )
    expect(() => parseStationSettingsInput({ ...valid, extra: true })).toThrow(
      /Station settings is invalid/,
    )
    expect(() =>
      parseStationSettingsInput({ ...valid, stationPin: '4821', clearStationPin: true }),
    ).toThrow(/either a new kiosk PIN or disable/)
  })

  it('validates home and base location UUIDs and exact booleans', () => {
    expect(() =>
      parseStationSettingsInput({
        defaultCheckInOrgUnitId: 'north-yard',
        stationPin: null,
        clearStationPin: false,
        scanMode: 'toggle',
        requireHolderOnCheckout: false,
        requireConditionOnCheckin: false,
        soundEnabled: true,
      }),
    ).toThrow(/Default check-in location is invalid/)
    expect(parseStationBaseLocationInput({ id: ID, isBase: true })).toEqual({
      id: ID,
      isBase: true,
    })
    expect(() => parseStationBaseLocationInput({ id: 'bad', isBase: true })).toThrow(
      /Location is invalid/,
    )
    expect(() => parseStationBaseLocationInput({ id: ID, isBase: 'true' })).toThrow(
      /Base location setting is invalid/,
    )
  })
})
