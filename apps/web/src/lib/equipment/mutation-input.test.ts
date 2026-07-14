import { describe, expect, it } from 'vitest'
import {
  EQUIPMENT_FILE_KINDS,
  EQUIPMENT_LOG_KINDS,
  mergeEquipmentFileMetadata,
  parseEquipmentAutosaveInput,
  WORK_ORDER_PRIORITIES,
} from './mutation-input'

describe('equipment mutation input', () => {
  it('accepts only registered fields and bounded base values', () => {
    expect(parseEquipmentAutosaveInput('name', '  Crane  ')).toEqual({
      field: 'name',
      value: 'Crane',
    })
    expect(() => parseEquipmentAutosaveInput('tenantId', 'other')).toThrow(/not editable/)
    expect(() => parseEquipmentAutosaveInput('assetTag', 'x'.repeat(121))).toThrow(/too long/)
  })

  it('validates UUID, enum, boolean, and real calendar values', () => {
    expect(parseEquipmentAutosaveInput('categoryId', '')).toEqual({
      field: 'categoryId',
      value: null,
    })
    expect(parseEquipmentAutosaveInput('requiresPreUseInspection', 'on').value).toBe(true)
    expect(parseEquipmentAutosaveInput('purchaseDate', '2028-02-29').value).toBe('2028-02-29')
    expect(() => parseEquipmentAutosaveInput('categoryId', 'not-a-uuid')).toThrow(/invalid/)
    expect(() => parseEquipmentAutosaveInput('status', 'deleted')).toThrow(/invalid/)
    expect(() => parseEquipmentAutosaveInput('purchaseDate', '2027-02-29')).toThrow(/invalid/)
  })

  it('enforces each numeric column precision and domain', () => {
    expect(parseEquipmentAutosaveInput('modelYear', '2026').value).toBe(2026)
    expect(parseEquipmentAutosaveInput('purchasePrice', '123.45').value).toBe('123.45')
    expect(parseEquipmentAutosaveInput('currentHours', '123.4').value).toBe('123.4')
    expect(parseEquipmentAutosaveInput('currentOdometer', '123').value).toBe(123)
    for (const [field, value] of [
      ['modelYear', '1700'],
      ['purchasePrice', '-1'],
      ['purchasePrice', '1.234'],
      ['currentHours', '1.23'],
      ['currentOdometer', '-1'],
    ] as const) {
      expect(() => parseEquipmentAutosaveInput(field, value)).toThrow()
    }
  })

  it('keeps operational enum sets explicit and duplicate-free', () => {
    expect(new Set(EQUIPMENT_LOG_KINDS).size).toBe(EQUIPMENT_LOG_KINDS.length)
    expect(new Set(EQUIPMENT_FILE_KINDS).size).toBe(EQUIPMENT_FILE_KINDS.length)
    expect(new Set(WORK_ORDER_PRIORITIES).size).toBe(WORK_ORDER_PRIORITIES.length)
  })

  it('never reassigns an equipment file and deliberately clears a stale label', () => {
    expect(
      mergeEquipmentFileMetadata(
        { equipmentId: 'item-a', label: 'Old', camera: 'phone' },
        { itemId: 'item-a', kind: 'manual', label: null },
      ),
    ).toEqual({ equipmentId: 'item-a', kind: 'manual', label: null, camera: 'phone' })
    expect(() =>
      mergeEquipmentFileMetadata(
        { equipmentId: 'item-b' },
        { itemId: 'item-a', kind: 'manual', label: null },
      ),
    ).toThrow(/another equipment item/)
  })
})
