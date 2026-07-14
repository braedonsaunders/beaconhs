import { describe, expect, it } from 'vitest'
import type { FormSchemaV1 } from './schema'
import { entityAttrPickerTypeForField } from './entity-attrs'

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'Entity picker test' },
  sections: [
    {
      id: 'overview',
      fields: [
        { id: 'worker', type: 'person_picker', label: { en: 'Worker' } },
        { id: 'site', type: 'site_picker', label: { en: 'Site' } },
        { id: 'notes', type: 'text', label: { en: 'Notes' } },
      ],
    },
    {
      id: 'rows',
      repeating: true,
      fields: [{ id: 'row_worker', type: 'person_picker', label: { en: 'Worker' } }],
    },
  ],
  workflow: {
    steps: [
      {
        key: 'submit',
        title: { en: 'Submit' },
        assignee: { type: 'role', role: 'worker' },
      },
    ],
  },
}

describe('entityAttrPickerTypeForField', () => {
  it('resolves only a unique top-level single-entity picker', () => {
    expect(entityAttrPickerTypeForField(schema, 'worker')).toBe('person_picker')
    expect(entityAttrPickerTypeForField(schema, 'site')).toBe('site_picker')
    expect(entityAttrPickerTypeForField(schema, 'notes')).toBeNull()
    expect(entityAttrPickerTypeForField(schema, 'row_worker')).toBeNull()
    expect(entityAttrPickerTypeForField(schema, 'missing')).toBeNull()
  })

  it('fails closed for an ambiguous historical schema', () => {
    const ambiguous = {
      ...schema,
      sections: [
        ...schema.sections,
        {
          id: 'legacy_duplicate',
          fields: [{ id: 'worker', type: 'site_picker', label: { en: 'Duplicate' } }],
        },
      ],
    } as FormSchemaV1

    expect(entityAttrPickerTypeForField(ambiguous, 'worker')).toBeNull()
  })
})
