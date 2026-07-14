import type { FormSchemaV1 } from '@beaconhs/forms-core'

type ResponseEntityReference = {
  fieldId: string
  id: string
  kind: 'person' | 'org_unit'
  level?: 'customer' | 'project' | 'site' | 'area'
}

const ORG_PICKER_LEVEL = {
  customer_picker: 'customer',
  project_picker: 'project',
  site_picker: 'site',
  area_picker: 'area',
} as const

/** Collect every persisted picker reference, including repeating-section rows. */
export function collectResponseEntityReferences(
  schema: FormSchemaV1,
  data: Record<string, unknown>,
): ResponseEntityReference[] {
  const refs: ResponseEntityReference[] = []
  const collectField = (fieldId: string, type: string, value: unknown) => {
    if (type === 'person_picker' && typeof value === 'string') {
      refs.push({ fieldId, id: value, kind: 'person' })
      return
    }
    if (type === 'multi_person_picker' && Array.isArray(value)) {
      for (const id of value) {
        if (typeof id === 'string') refs.push({ fieldId, id, kind: 'person' })
      }
      return
    }
    const level = ORG_PICKER_LEVEL[type as keyof typeof ORG_PICKER_LEVEL]
    if (level && typeof value === 'string') {
      refs.push({ fieldId, id: value, kind: 'org_unit', level })
    }
  }

  for (const section of schema.sections) {
    if (section.repeating) {
      const rows = data[section.id]
      if (!Array.isArray(rows)) continue
      rows.forEach((row, rowIndex) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return
        for (const field of section.fields) {
          collectField(
            `${section.id}.${rowIndex}.${field.id}`,
            field.type,
            (row as Record<string, unknown>)[field.id],
          )
        }
      })
      continue
    }
    for (const field of section.fields) collectField(field.id, field.type, data[field.id])
  }
  return refs
}
