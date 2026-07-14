import { storesResponseValue } from './field-types'
import { evaluateLogicRule, type EvalContext, type RowMap } from './evaluator'
import type { FormSchemaV1, FormSection } from './schema'
import { normalizeDocumentHref, sanitizeDocumentHtml } from './sanitize'

type FormResponseValues = Record<string, unknown>
type FormResponseRows = Record<string, Array<Record<string, unknown>>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeRichTextFields(
  section: FormSection,
  source: Record<string, unknown>,
): Record<string, unknown> {
  let normalized: Record<string, unknown> | null = null

  for (const field of section.fields) {
    if (field.type !== 'rich_text' || !Object.hasOwn(source, field.id)) continue
    const value = source[field.id]
    if (typeof value !== 'string') continue

    const clean = sanitizeDocumentHtml(value)
    if (clean !== value) {
      normalized ??= { ...source }
      normalized[field.id] = clean
    }
  }

  return normalized ?? source
}

function keepKnownKeys<T extends Record<string, unknown>>(source: T, allowed: Set<string>): T {
  const unknownKeys = Object.keys(source).filter((key) => !allowed.has(key))
  if (unknownKeys.length === 0) return source
  const normalized = { ...source }
  for (const key of unknownKeys) delete normalized[key]
  return normalized
}

function repeatingFieldIds(schema: FormSchemaV1): Map<string, Set<string>> {
  const bySection = new Map<string, Set<string>>()
  for (const section of schema.sections) {
    if (!section.repeating) continue
    const ids = bySection.get(section.id) ?? new Set<string>()
    for (const field of section.fields) {
      if (storesResponseValue(field)) ids.add(field.id)
    }
    bySection.set(section.id, ids)
  }
  return bySection
}

function normalizeRepeatingRows(
  section: FormSection,
  rows: unknown[],
  allowedFields: Set<string>,
): unknown[] {
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row
    const known = keepKnownKeys(row as Record<string, unknown>, allowedFields)
    return normalizeRichTextFields(section, known)
  })
}

function normalizeResponseValues(
  schema: FormSchemaV1,
  values: FormResponseValues,
  includeRepeatingRows: boolean,
): FormResponseValues {
  const allowedTopLevel = new Set<string>()
  for (const section of schema.sections) {
    if (section.repeating) {
      if (includeRepeatingRows) allowedTopLevel.add(section.id)
    } else {
      for (const field of section.fields) {
        if (storesResponseValue(field)) allowedTopLevel.add(field.id)
      }
    }
  }

  let normalized = keepKnownKeys(values, allowedTopLevel)
  const rowFields = repeatingFieldIds(schema)

  for (const section of schema.sections) {
    if (section.repeating) {
      if (!includeRepeatingRows) continue
      // Canonical schemas reject duplicate section ids, but imported or
      // historical schemas may still reach this defensive boundary. Compose
      // each definition over the latest normalized rows so no earlier field
      // cleanup is lost.
      const rawRows = normalized[section.id]
      if (!Array.isArray(rawRows)) continue
      const cleanRows = normalizeRepeatingRows(
        section,
        rawRows,
        rowFields.get(section.id) ?? new Set(),
      )
      if (cleanRows.some((row, index) => row !== rawRows[index])) {
        normalized = { ...normalized, [section.id]: cleanRows }
      }
      continue
    }

    normalized = normalizeRichTextFields(section, normalized)
  }

  return normalized
}

function topLevelEvaluationValues(
  schema: FormSchemaV1,
  values: FormResponseValues,
): FormResponseValues {
  const result = { ...values }
  for (const section of schema.sections) {
    if (section.repeating) delete result[section.id]
  }
  return result
}

function embeddedRows(schema: FormSchemaV1, values: FormResponseValues): RowMap {
  const result: RowMap = {}
  for (const section of schema.sections) {
    if (!section.repeating) continue
    const sectionRows = values[section.id]
    result[section.id] = Array.isArray(sectionRows)
      ? sectionRows.map((row) => (isRecord(row) ? row : {}))
      : []
  }
  return result
}

/**
 * Delete values which are not currently visible. Visibility can cascade: a
 * hidden controller may itself be removed and make a downstream field hidden,
 * so this is a monotonic, bounded fixpoint rather than a single pass.
 */
function stripHiddenResponseValues(
  schema: FormSchemaV1,
  initialValues: FormResponseValues,
  initialRows?: FormResponseRows,
): { values: FormResponseValues; rows?: FormResponseRows } {
  let values = initialValues
  let rows = initialRows
  const declaredValueCount = schema.sections.reduce(
    (count, section) => count + 1 + section.fields.filter(storesResponseValue).length,
    0,
  )

  for (let pass = 0; pass <= declaredValueCount; pass += 1) {
    let changed = false
    const evalValues = topLevelEvaluationValues(schema, values)
    const evalRows = rows ?? embeddedRows(schema, values)
    const ctx: EvalContext = { values: evalValues, rows: evalRows }

    for (const section of schema.sections) {
      const sectionVisible = !section.showIf || evaluateLogicRule(section.showIf, ctx)
      if (section.repeating) {
        const currentRows = rows?.[section.id] ?? values[section.id]
        if (!sectionVisible) {
          if (rows && Object.hasOwn(rows, section.id)) {
            const nextRows = { ...rows }
            delete nextRows[section.id]
            rows = nextRows
            changed = true
          }
          if (!rows && Object.hasOwn(values, section.id)) {
            const nextValues = { ...values }
            delete nextValues[section.id]
            values = nextValues
            changed = true
          }
          continue
        }
        if (!Array.isArray(currentRows)) continue

        let normalizedRows: typeof currentRows | null = null
        currentRows.forEach((rawRow, rowIndex) => {
          if (!isRecord(rawRow)) return
          const rowCtx: EvalContext = { ...ctx, values: { ...evalValues, ...rawRow } }
          let normalizedRow: Record<string, unknown> | null = null
          for (const field of section.fields) {
            if (
              !storesResponseValue(field) ||
              !field.showIf ||
              evaluateLogicRule(field.showIf, rowCtx) ||
              !Object.hasOwn(rawRow, field.id)
            ) {
              continue
            }
            normalizedRow ??= { ...rawRow }
            delete normalizedRow[field.id]
            changed = true
          }
          if (normalizedRow) {
            normalizedRows ??= [...currentRows]
            normalizedRows[rowIndex] = normalizedRow
          }
        })
        if (normalizedRows) {
          if (rows) rows = { ...rows, [section.id]: normalizedRows }
          else values = { ...values, [section.id]: normalizedRows }
        }
        continue
      }

      for (const field of section.fields) {
        if (!storesResponseValue(field) || !Object.hasOwn(values, field.id)) continue
        const fieldVisible =
          sectionVisible && (!field.showIf || evaluateLogicRule(field.showIf, ctx))
        if (fieldVisible) continue
        const nextValues = { ...values }
        delete nextValues[field.id]
        values = nextValues
        changed = true
      }
    }

    if (!changed) return rows ? { values, rows } : { values }
  }

  // Each pass only deletes keys, so reaching the bound would indicate a
  // programming error rather than untrusted data. Return the safest state
  // reached so far instead of reintroducing any hidden value.
  return rows ? { values, rows } : { values }
}

/**
 * Sanitize every rich-text response value described by a form schema.
 *
 * Top-level fields are stored by field id. Repeating-section fields are stored
 * inside the row array under the section id. Unknown keys are removed after a
 * caller validates the raw payload; malformed known values are preserved for
 * field validation. The input is never mutated.
 */
export function normalizeFormResponseData(
  schema: FormSchemaV1,
  values: FormResponseValues,
): FormResponseValues {
  const normalized = normalizeResponseValues(schema, values, true)
  return stripHiddenResponseValues(schema, normalized).values
}

/** Normalize the filler's split draft shape without mutating either map. */
export function normalizeFormResponseDraftData(
  schema: FormSchemaV1,
  values: FormResponseValues,
  rows: FormResponseRows,
): { values: FormResponseValues; rows: FormResponseRows } {
  const normalizedValues = normalizeResponseValues(schema, values, false)
  const rowFields = repeatingFieldIds(schema)
  const repeatingIds = new Set(rowFields.keys())
  let normalizedRows = keepKnownKeys(rows, repeatingIds)

  for (const section of schema.sections) {
    if (!section.repeating) continue
    const sectionRows = normalizedRows[section.id]
    if (!sectionRows) continue
    const cleanRows = normalizeRepeatingRows(
      section,
      sectionRows,
      rowFields.get(section.id) ?? new Set(),
    ) as Array<Record<string, unknown>>
    if (cleanRows.some((row, index) => row !== sectionRows[index])) {
      normalizedRows = { ...normalizedRows, [section.id]: cleanRows }
    }
  }

  const visible = stripHiddenResponseValues(schema, normalizedValues, normalizedRows)
  return { values: visible.values, rows: visible.rows ?? {} }
}

/**
 * Validate a URL before handing it to contentEditable's createLink command.
 * DOMPurify remains the final render/storage boundary; this prevents a
 * dangerous link from existing in the live editor even transiently.
 */
export function normalizeRichTextLinkUrl(value: string): string | null {
  return normalizeDocumentHref(value)
}
