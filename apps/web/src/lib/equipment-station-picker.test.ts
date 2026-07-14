import { describe, expect, it } from 'vitest'
import {
  equipmentStationPickerKind,
  equipmentStationPickerQuery,
  parseEquipmentStationPickerSearchInput,
} from './equipment-station-picker'

const ID = '10000000-0000-4000-8000-000000000001'

describe('equipment station picker policy', () => {
  it('normalizes a bounded query and selected UUID', () => {
    const parsed = parseEquipmentStationPickerSearchInput({
      query: '  north yard  ',
      selected: ID.toUpperCase(),
    })
    expect(parsed).toEqual({ query: 'north yard', selected: ID })
    expect(equipmentStationPickerQuery(parsed)).toEqual({
      term: '%north yard%',
      selected: ID,
    })
  })

  it('escapes wildcard characters instead of broadening the directory query', () => {
    expect(
      equipmentStationPickerQuery(
        parseEquipmentStationPickerSearchInput({ query: '100%_yard', selected: null }),
      ).term,
    ).toBe('%100\\%\\_yard%')
  })

  it('rejects oversized, malformed, and augmented requests', () => {
    expect(() =>
      parseEquipmentStationPickerSearchInput({
        query: 'x'.repeat(101),
        selected: null,
      }),
    ).toThrow(/100 characters or less/)
    expect(() =>
      parseEquipmentStationPickerSearchInput({ query: 'yard\u0000', selected: null }),
    ).toThrow(/search is invalid/)
    expect(() =>
      parseEquipmentStationPickerSearchInput({ query: '', selected: 'not-a-uuid' }),
    ).toThrow(/Selected station option is invalid/)
    expect(() =>
      parseEquipmentStationPickerSearchInput({ query: '', selected: null, scope: 'all' }),
    ).toThrow(/request is invalid/)
  })

  it('accepts only the two station-specific directory kinds', () => {
    expect(equipmentStationPickerKind('holder')).toBe('holder')
    expect(equipmentStationPickerKind('location')).toBe('location')
    expect(equipmentStationPickerKind('people')).toBeNull()
  })
})
