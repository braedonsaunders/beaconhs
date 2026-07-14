import { describe, expect, it } from 'vitest'
import {
  optionalDateInput,
  optionalNumberInput,
  optionalTextInput,
  optionalUuidInput,
  requiredDateInput,
  requireRecordInput,
  requireUuidArrayInput,
  requiredTextInput,
  requireEnumInput,
  requireUuidInput,
} from './mutation-input'

const ID = '10000000-0000-4000-8000-000000000001'

describe('mutation input', () => {
  it('accepts only plain record-shaped action payloads', () => {
    expect(requireRecordInput({ id: ID }, 'Request')).toEqual({ id: ID })
    for (const value of [null, undefined, 'value', [], 4]) {
      expect(() => requireRecordInput(value, 'Request')).toThrow(/Request is invalid/)
    }
  })

  it('validates required and optional UUID values', () => {
    expect(requireUuidInput(` ${ID} `, 'Record')).toBe(ID)
    expect(optionalUuidInput('', 'Record')).toBeNull()
    expect(() => requireUuidInput('not-a-uuid', 'Record')).toThrow(/Record is invalid/)
    expect(() => optionalUuidInput(4, 'Record')).toThrow(/Record is invalid/)
  })

  it('validates bounded UUID batches without truncating or duplicating them', () => {
    const second = '20000000-0000-4000-8000-000000000002'
    expect(requireUuidArrayInput([ID, second], 'Records', { max: 2 })).toEqual([ID, second])
    expect(() => requireUuidArrayInput([], 'Records', { max: 2 })).toThrow(/required/)
    expect(() => requireUuidArrayInput([ID, second], 'Records', { max: 1 })).toThrow(/too many/)
    expect(() => requireUuidArrayInput([ID, ID], 'Records', { max: 2 })).toThrow(/duplicate/)
    expect(() => requireUuidArrayInput([ID, 'bad'], 'Records', { max: 2 })).toThrow(/invalid/)
  })

  it('normalizes bounded text without silently truncating it', () => {
    expect(requiredTextInput('  Ready  ', 'Summary', 10)).toBe('Ready')
    expect(optionalTextInput('  ', 'Notes', 10)).toBeNull()
    expect(() => requiredTextInput('x'.repeat(11), 'Summary', 10)).toThrow(/too long/)
    expect(() => optionalTextInput('x'.repeat(11), 'Notes', 10)).toThrow(/too long/)
    expect(() => optionalTextInput({ value: 'hidden' }, 'Notes', 10)).toThrow(/invalid/)
  })

  it('accepts only an allow-listed enum value', () => {
    expect(requireEnumInput('high', ['low', 'high'] as const, 'Priority')).toBe('high')
    expect(() => requireEnumInput('urgent', ['low', 'high'] as const, 'Priority')).toThrow(
      /invalid/,
    )
  })

  it('validates optional numeric ranges, integrality, and scale', () => {
    expect(optionalNumberInput('', 'Hours')).toBeNull()
    expect(optionalNumberInput(' 8.25 ', 'Hours', { min: 0, max: 24, maxScale: 2 })).toBe(8.25)
    expect(optionalNumberInput(12, 'Crew', { min: 0, integer: true })).toBe(12)
    expect(() => optionalNumberInput('NaN', 'Hours')).toThrow(/invalid/)
    expect(() => optionalNumberInput({ valueOf: () => 4 }, 'Hours')).toThrow(/invalid/)
    expect(() => optionalNumberInput(-1, 'Hours', { min: 0 })).toThrow(/range/)
    expect(() => optionalNumberInput(1.5, 'Crew', { integer: true })).toThrow(/whole number/)
    expect(() => optionalNumberInput('1.234', 'Hours', { maxScale: 2 })).toThrow(/decimal/)
  })

  it('validates real ISO calendar dates rather than regex shape alone', () => {
    expect(requiredDateInput('2028-02-29', 'Date')).toBe('2028-02-29')
    expect(optionalDateInput('', 'Date')).toBeNull()
    expect(() => optionalDateInput(20260101, 'Date')).toThrow(/invalid/)
    for (const value of ['2027-02-29', '2026-13-01', '2026-00-10', 'not-a-date']) {
      expect(() => requiredDateInput(value, 'Date')).toThrow(/invalid/)
    }
  })
})
