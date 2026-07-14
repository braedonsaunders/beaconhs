// Shared helpers for the Data Sources admin (plain functions — no 'use server').

import type { DataSourceColumn, DataSourceColumnType } from '@beaconhs/db/schema'
import type { FormSchemaV1, I18nString } from '@beaconhs/forms-core'
import { DEFAULT_LOCALE, localizeText, type AppLocale } from '@beaconhs/i18n'

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

function pickLabel(
  label: I18nString | undefined,
  fallback: string,
  locale: AppLocale,
  defaultLocale: AppLocale,
): string {
  return localizeText(label, locale, fallback, defaultLocale)
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
export function deriveColumnsFromSchema(
  schema: FormSchemaV1,
  locale: AppLocale = DEFAULT_LOCALE,
  defaultLocale: AppLocale = DEFAULT_LOCALE,
): DataSourceColumn[] {
  const cols: DataSourceColumn[] = []
  const seen = new Set<string>()
  for (const sec of schema.sections ?? []) {
    if (sec.repeating) continue // rows of a repeating section aren't flat columns
    for (const f of sec.fields ?? []) {
      if (NON_VALUE_TYPES.has(f.type)) continue
      if (seen.has(f.id)) continue
      seen.add(f.id)
      cols.push({
        key: f.id,
        label: pickLabel(f.label, f.id, locale, defaultLocale),
        type: columnTypeForField(f.type),
      })
    }
  }
  const copy = META_COLUMN_COPY[locale]
  cols.push({ key: '__status', label: copy.status, type: 'text' })
  cols.push({ key: '__submittedAt', label: copy.submittedAt, type: 'date' })
  cols.push({ key: '__site', label: copy.site, type: 'text' })
  return cols
}

const META_COLUMN_COPY: Record<AppLocale, { status: string; submittedAt: string; site: string }> = {
  en: { status: 'Status', submittedAt: 'Submitted at', site: 'Site' },
  fr: { status: 'État', submittedAt: 'Soumis le', site: 'Site' },
  es: { status: 'Estado', submittedAt: 'Enviado el', site: 'Sitio' },
}
