import { describe, expect, it } from 'vitest'
import {
  CUSTOM_FIELD_LIMITS,
  coerceCustomFieldValue,
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
  it('enforces configured number increments from the minimum', () => {
    const d = def({ fieldType: 'number', config: { min: 0.1, step: 0.1 } })
    expect(coerceCustomFieldValue(d, '0.3')).toEqual({ ok: true, value: 0.3 })
    expect(coerceCustomFieldValue(d, '0.35')).toEqual({
      ok: false,
      error: 'Field must use increments of 0.1.',
    })
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
  it('rejects normalized or malformed calendar dates and date-times', () => {
    expect(coerceCustomFieldValue(def({ fieldType: 'date' }), '2026-02-29').ok).toBe(false)
    expect(coerceCustomFieldValue(def({ fieldType: 'date' }), '2024-02-29').ok).toBe(true)
    expect(coerceCustomFieldValue(def({ fieldType: 'datetime' }), '2026-02-31T12:00').ok).toBe(
      false,
    )
    expect(coerceCustomFieldValue(def({ fieldType: 'datetime' }), '06/30/2026 12:00').ok).toBe(
      false,
    )
    expect(coerceCustomFieldValue(def({ fieldType: 'datetime' }), '2026-06-30T12:00').ok).toBe(true)
  })
  it('rejects an oversized adversarial email before regex evaluation', () => {
    const oversized = `${'a'.repeat(50_000)}@example.com`
    expect(coerceCustomFieldValue(def({ fieldType: 'email' }), oversized)).toEqual({
      ok: false,
      error: 'Field must be a valid email address.',
    })
  })
  it('bounds metadata text and multi-select payloads', () => {
    expect(
      coerceCustomFieldValue(def({ fieldType: 'text' }), 'x'.repeat(CUSTOM_FIELD_LIMITS.text + 1)),
    ).toEqual({ ok: false, error: 'Field is too long.' })
    const d = def({
      fieldType: 'multi_select',
      config: { options: [{ value: 'a', label: 'A' }] },
    })
    expect(
      coerceCustomFieldValue(
        d,
        JSON.stringify(Array.from({ length: CUSTOM_FIELD_LIMITS.options + 1 }, () => 'a')),
      ).ok,
    ).toBe(false)
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
      placeholder: 'This control never renders a placeholder',
    })
    expect(cfg?.options).toEqual([{ value: 'a', label: 'A' }])
    expect(cfg).not.toHaveProperty('placeholder')
  })
  it('bounds stored option/config text and rejects non-positive steps', () => {
    const cfg = normalizeCustomFieldConfig('select', {
      options: Array.from({ length: CUSTOM_FIELD_LIMITS.options + 10 }, (_, index) => ({
        value: `${index}-${'v'.repeat(CUSTOM_FIELD_LIMITS.optionValue)}`,
        label: 'L'.repeat(CUSTOM_FIELD_LIMITS.optionLabel + 10),
      })),
    })
    expect(cfg?.options).toHaveLength(CUSTOM_FIELD_LIMITS.options)
    expect(cfg?.options?.[0]?.value).toHaveLength(CUSTOM_FIELD_LIMITS.optionValue)
    expect(cfg?.options?.[0]?.label).toHaveLength(CUSTOM_FIELD_LIMITS.optionLabel)
    expect(normalizeCustomFieldConfig('number', { step: 0 })).toBeNull()
  })
})

describe('readCustomFieldValues', () => {
  it('reads the custom namespace defensively', () => {
    expect(readCustomFieldValues({ custom: { a: 1 } })).toEqual({ a: 1 })
    expect(readCustomFieldValues({})).toEqual({})
    expect(readCustomFieldValues(null)).toEqual({})
  })
})
