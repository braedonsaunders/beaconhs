import { describe, expect, it } from 'vitest'
import {
  coerceCustomFieldValue,
  formatCustomFieldValue,
  normalizeCustomFieldConfig,
  readCustomFieldValues,
  slugifyCustomFieldKey,
  type CustomFieldDefinition,
} from './custom-fields'

function def(partial: Partial<CustomFieldDefinition>): CustomFieldDefinition {
  return {
    key: 'f',
    label: 'Field',
    fieldType: 'text',
    required: false,
    config: null,
    ...partial,
  }
}

describe('slugifyCustomFieldKey', () => {
  it('lower-cases and underscores', () => {
    expect(slugifyCustomFieldKey('Sensor Channel #1')).toBe('sensor_channel_1')
  })
  it('prefixes a leading digit', () => {
    expect(slugifyCustomFieldKey('4 Gas')).toBe('f_4_gas')
  })
  it('falls back for empty input', () => {
    expect(slugifyCustomFieldKey('!!!')).toBe('field')
  })
})

describe('coerceCustomFieldValue', () => {
  it('clears optional fields on empty', () => {
    expect(coerceCustomFieldValue(def({}), '')).toEqual({ ok: true, value: null })
  })
  it('rejects empty required fields', () => {
    const r = coerceCustomFieldValue(def({ required: true }), '   ')
    expect(r.ok).toBe(false)
  })
  it('parses numbers and enforces range', () => {
    const d = def({ fieldType: 'number', config: { min: 0, max: 100 } })
    expect(coerceCustomFieldValue(d, '23.5')).toEqual({ ok: true, value: 23.5 })
    expect(coerceCustomFieldValue(d, '500').ok).toBe(false)
    expect(coerceCustomFieldValue(d, 'abc').ok).toBe(false)
  })
  it('treats booleans as never-missing', () => {
    const d = def({ fieldType: 'boolean', required: true })
    expect(coerceCustomFieldValue(d, '')).toEqual({ ok: true, value: false })
    expect(coerceCustomFieldValue(d, 'true')).toEqual({ ok: true, value: true })
  })
  it('validates select against options', () => {
    const d = def({
      fieldType: 'select',
      config: { options: [{ value: 'co', label: 'CO' }] },
    })
    expect(coerceCustomFieldValue(d, 'co')).toEqual({ ok: true, value: 'co' })
    expect(coerceCustomFieldValue(d, 'xx').ok).toBe(false)
  })
  it('parses + dedupes multi_select and validates membership', () => {
    const d = def({
      fieldType: 'multi_select',
      config: {
        options: [
          { value: 'co', label: 'CO' },
          { value: 'o2', label: 'O2' },
        ],
      },
    })
    expect(coerceCustomFieldValue(d, '["co","o2","co"]')).toEqual({
      ok: true,
      value: ['co', 'o2'],
    })
    expect(coerceCustomFieldValue(d, '["bad"]').ok).toBe(false)
    expect(coerceCustomFieldValue(d, '')).toEqual({ ok: true, value: null })
  })
  it('validates email / url / date shapes', () => {
    expect(coerceCustomFieldValue(def({ fieldType: 'email' }), 'a@b.com').ok).toBe(true)
    expect(coerceCustomFieldValue(def({ fieldType: 'email' }), 'nope').ok).toBe(false)
    expect(coerceCustomFieldValue(def({ fieldType: 'url' }), 'https://x.io').ok).toBe(true)
    expect(coerceCustomFieldValue(def({ fieldType: 'url' }), 'ftp://x').ok).toBe(false)
    expect(coerceCustomFieldValue(def({ fieldType: 'date' }), '2026-06-30').ok).toBe(true)
    expect(coerceCustomFieldValue(def({ fieldType: 'date' }), '06/30/26').ok).toBe(false)
  })
})

describe('formatCustomFieldValue', () => {
  it('renders unit, booleans, and option labels', () => {
    expect(formatCustomFieldValue(def({ fieldType: 'number', config: { unit: 'ppm' } }), 35)).toBe(
      '35 ppm',
    )
    expect(formatCustomFieldValue(def({ fieldType: 'boolean' }), true)).toBe('Yes')
    const sel = def({
      fieldType: 'select',
      config: { options: [{ value: 'co', label: 'Carbon monoxide' }] },
    })
    expect(formatCustomFieldValue(sel, 'co')).toBe('Carbon monoxide')
    expect(formatCustomFieldValue(def({}), null)).toBe('—')
  })
})

describe('normalizeCustomFieldConfig', () => {
  it('drops irrelevant keys per type', () => {
    const cfg = normalizeCustomFieldConfig('text', {
      options: [{ value: 'a', label: 'A' }],
      unit: 'kg',
      min: 1,
    })
    expect(cfg).toBeNull()
  })
  it('keeps + dedupes options for choice types', () => {
    const cfg = normalizeCustomFieldConfig('select', {
      options: [
        { value: 'a', label: 'A' },
        { value: 'a', label: 'dup' },
        { value: '', label: 'blank' },
      ],
    })
    expect(cfg?.options).toEqual([{ value: 'a', label: 'A' }])
  })
})

describe('readCustomFieldValues', () => {
  it('reads the custom namespace defensively', () => {
    expect(readCustomFieldValues({ custom: { a: 1 } })).toEqual({ a: 1 })
    expect(readCustomFieldValues({})).toEqual({})
    expect(readCustomFieldValues(null)).toEqual({})
  })
})
