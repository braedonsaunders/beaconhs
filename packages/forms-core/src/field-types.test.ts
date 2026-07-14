import { describe, expect, it } from 'vitest'
import { FIELD_TYPES, isResponseValueField, storesResponseValue } from './field-types'
import type { FormField } from './schema'

describe('field type metadata', () => {
  it('classifies computed and display-only fields as non-response values', () => {
    expect(isResponseValueField('formula')).toBe(false)
    expect(isResponseValueField('metric')).toBe(false)
    expect(isResponseValueField('heading')).toBe(false)
    expect(isResponseValueField('paragraph')).toBe(false)
    expect(isResponseValueField('divider')).toBe(false)
  })

  it('describes actual attachment storage shapes', () => {
    for (const type of ['photo', 'photo_upload', 'file', 'video', 'audio'] as const) {
      expect(FIELD_TYPES[type].valueKind).toBe('attachment_array')
    }
    expect(FIELD_TYPES.signature.valueKind).toBe('compound')
  })

  it('keeps an ordinary Likert matrix separate from scored risk matrices', () => {
    expect(FIELD_TYPES.matrix).toMatchObject({ category: 'choice', scoring: false })
    expect(FIELD_TYPES.risk_matrix).toMatchObject({ category: 'computed', scoring: true })
  })

  it('persists data-table values only when row selection is enabled', () => {
    const table = (selectable?: 'none' | 'single' | 'multi'): FormField => ({
      id: 'records',
      type: 'data_table',
      label: { en: 'Records' },
      binding: { sourceKey: 'records', selectable },
    })

    expect(storesResponseValue(table())).toBe(false)
    expect(storesResponseValue(table('none'))).toBe(false)
    expect(storesResponseValue(table('single'))).toBe(true)
    expect(storesResponseValue(table('multi'))).toBe(true)
  })
})
