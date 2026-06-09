// Shared helpers for the Data Sources admin (plain functions — no 'use server').

import type { DataSourceColumn, DataSourceColumnType } from '@beaconhs/db/schema'
import type { FormSchemaV1, I18nString } from '@beaconhs/forms-core'

/** Stable, URL-safe slug used as a data source `key`. */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'source'
  )
}

function pickLabel(label: I18nString | undefined, fallback: string): string {
  if (!label) return fallback
  return label.en ?? Object.values(label)[0] ?? fallback
}

// Map a form field type to a data-source column value kind.
function columnTypeForField(fieldType: string): DataSourceColumnType {
  if (['number', 'slider', 'rating', 'formula', 'calc'].includes(fieldType)) return 'number'
  if (['date', 'datetime', 'time'].includes(fieldType)) return 'date'
  return 'text'
}

// Display-only / non-value field types contribute no column.
const NON_VALUE_TYPES = new Set([
  'heading',
  'paragraph',
  'image',
  'divider',
  'data_table',
  'metric',
])

/**
 * Snapshot a 'responses'-kind source's columns from an app's schema: one column
 * per top-level input field, plus meta columns (__status / __submittedAt /
 * __site) that the query layer augments every derived row with.
 */
export function deriveColumnsFromSchema(schema: FormSchemaV1): DataSourceColumn[] {
  const cols: DataSourceColumn[] = []
  const seen = new Set<string>()
  for (const sec of schema.sections ?? []) {
    if (sec.repeating) continue // rows of a repeating section aren't flat columns
    for (const f of sec.fields ?? []) {
      if (NON_VALUE_TYPES.has(f.type)) continue
      if (seen.has(f.id)) continue
      seen.add(f.id)
      cols.push({ key: f.id, label: pickLabel(f.label, f.id), type: columnTypeForField(f.type) })
    }
  }
  cols.push({ key: '__status', label: 'Status', type: 'text' })
  cols.push({ key: '__submittedAt', label: 'Submitted at', type: 'date' })
  cols.push({ key: '__site', label: 'Site', type: 'text' })
  return cols
}
