import type { FormSchemaV1 } from './schema'

// Extract the people who participated in a submitted form response, generalizing
// the old toolbox "attendees" concept to any form. Pure + dependency-free
// (mirrors scoring.ts) so it can run on web (submit) and worker (backfill).

export type ExtractedParticipant = {
  personId: string
  signed: boolean
  fieldId: string
  sectionId: string // '' for top-level pickers
  role: string | null
}

// A signature field stores an attachment ref ({ attachmentId, url }) once drawn.
function isSignedValue(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Boolean(o.attachmentId || o.url)
  }
  return false
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

/**
 * Build the per-section row arrays for repeating sections from a flat response
 * `data` map. (Repeating sections store their rows under the section id.)
 */
export function hoistRows(
  schema: FormSchemaV1,
  data: Record<string, unknown>,
): Record<string, Array<Record<string, unknown>>> {
  const rows: Record<string, Array<Record<string, unknown>>> = {}
  for (const section of schema.sections) {
    if (!section.repeating) continue
    const v = data[section.id]
    rows[section.id] = Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []
  }
  return rows
}

/**
 * Extract participants from a submitted response. Sources:
 *  - top-level `person_picker` / `multi_person_picker` fields, and
 *  - repeating sections that contain a `person_picker` (the toolbox attendee
 *    shape): one participant per row, `signed` = the row's first signature
 *    field is filled, `role` = the row's first select/radio value.
 * Deduplicated to one row per person (signed = signed anywhere).
 */
export function extractParticipants(
  schema: FormSchemaV1,
  values: Record<string, unknown>,
  rows?: Record<string, Array<Record<string, unknown>>>,
): ExtractedParticipant[] {
  const rowMap = rows ?? hoistRows(schema, values)
  const raw: ExtractedParticipant[] = []

  for (const section of schema.sections) {
    if (section.repeating) {
      const pickerField = section.fields.find((f) => f.type === 'person_picker')
      if (!pickerField) continue
      const sigField = section.fields.find((f) => f.type === 'signature')
      const roleField = section.fields.find((f) => f.type === 'select' || f.type === 'radio')
      const rowArr = rowMap[section.id] ?? []
      for (const row of rowArr) {
        const pid = asString(row[pickerField.id])
        if (!pid) continue
        raw.push({
          personId: pid,
          signed: sigField ? isSignedValue(row[sigField.id]) : false,
          fieldId: pickerField.id,
          sectionId: section.id,
          role: roleField ? asString(row[roleField.id]) : null,
        })
      }
      continue
    }
    for (const field of section.fields) {
      if (field.type === 'person_picker') {
        const pid = asString(values[field.id])
        if (pid)
          raw.push({ personId: pid, signed: false, fieldId: field.id, sectionId: '', role: null })
      } else if (field.type === 'multi_person_picker') {
        const v = values[field.id]
        if (Array.isArray(v)) {
          for (const item of v) {
            const pid = asString(item)
            if (pid)
              raw.push({
                personId: pid,
                signed: false,
                fieldId: field.id,
                sectionId: '',
                role: null,
              })
          }
        }
      }
    }
  }

  // One row per person per response; OR the signed flag, keep first provenance
  // (preferring a signed source so the row reflects that they signed).
  const byPerson = new Map<string, ExtractedParticipant>()
  for (const p of raw) {
    const existing = byPerson.get(p.personId)
    if (!existing) {
      byPerson.set(p.personId, { ...p })
    } else if (p.signed && !existing.signed) {
      byPerson.set(p.personId, { ...p })
    }
  }
  return [...byPerson.values()]
}
