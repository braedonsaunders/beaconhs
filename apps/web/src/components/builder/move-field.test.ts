import { describe, expect, it } from 'vitest'
import type { FormSchemaV1 } from '@beaconhs/forms-core'
import { moveFieldToSection } from './move-field'

const schema = (repeating = false): FormSchemaV1 => ({
  schemaVersion: 1,
  title: { en: 'Form' },
  sections: [
    {
      id: 'a',
      title: { en: 'A' },
      fields: [{ id: 'q', type: 'text', label: { en: 'Q' } }],
      canvas: { cols: 12, rowHeight: 40, items: [{ i: 'q', x: 2, y: 3, w: 4, h: 2 }] },
    },
    {
      id: 'b',
      title: { en: 'B' },
      fields: [],
      ...(repeating ? { repeating: true } : {}),
      canvas: { cols: 12, rowHeight: 40, items: [] },
    },
  ],
  workflow: { steps: [] },
})

describe('moveFieldToSection', () => {
  it('moves a field and its canvas layout entry without changing the source', () => {
    const original = schema()
    const result = moveFieldToSection(original, 'q', 'a', 'b', 0)
    expect(result).toMatchObject({ moved: true, blocked: false })
    expect(result.schema.sections[0]?.fields).toHaveLength(0)
    expect(result.schema.sections[0]?.canvas?.items).toEqual([])
    expect(result.schema.sections[1]?.fields.map((field) => field.id)).toEqual(['q'])
    expect(result.schema.sections[1]?.canvas?.items).toEqual([{ i: 'q', x: 2, y: 3, w: 4, h: 2 }])
    expect(original.sections[0]?.fields.map((field) => field.id)).toEqual(['q'])
  })

  it('blocks moves between repeating and non-repeating sections', () => {
    const original = schema(true)
    const result = moveFieldToSection(original, 'q', 'a', 'b', 0)
    expect(result).toMatchObject({ moved: false, blocked: true })
    expect(result.schema).toBe(original)
  })
})
