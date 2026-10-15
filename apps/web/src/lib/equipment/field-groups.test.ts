import { describe, expect, it } from 'vitest'
import { EQUIPMENT_FIELD_GROUPS, equipmentFieldWireValue } from './field-groups'

const field = (name: string) => {
  const found = EQUIPMENT_FIELD_GROUPS.flatMap((group) => group.fields).find(
    (candidate) => candidate.field === name,
  )
  if (!found) throw new Error(`No equipment field ${name}`)
  return found
}

describe('equipment field wire values', () => {
  it('renders empty values as blank', () => {
    expect(equipmentFieldWireValue(field('manufacturer'), null)).toBe('')
    expect(equipmentFieldWireValue(field('purchasePrice'), undefined)).toBe('')
  })

  it('drops the zero padding numeric columns come back with', () => {
    // So a value saved as "1234.5" compares equal to the stored "1234.50".
    expect(equipmentFieldWireValue(field('purchasePrice'), '1234.50')).toBe('1234.5')
    expect(equipmentFieldWireValue(field('purchasePrice'), '1234.5')).toBe('1234.5')
    expect(equipmentFieldWireValue(field('currentHours'), '120.0')).toBe('120')
  })

  it('keeps whole numbers, dates, text, and selects as stored', () => {
    expect(equipmentFieldWireValue(field('modelYear'), 2026)).toBe('2026')
    expect(equipmentFieldWireValue(field('currentOdometer'), 12_000)).toBe('12000')
    expect(equipmentFieldWireValue(field('purchaseDate'), '2026-02-01')).toBe('2026-02-01')
    expect(equipmentFieldWireValue(field('vin'), '1FT 0012')).toBe('1FT 0012')
    expect(equipmentFieldWireValue(field('ownership'), 'rented')).toBe('rented')
  })
})
