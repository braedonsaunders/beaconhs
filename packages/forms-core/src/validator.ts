import { evaluateLogicRule, type EvalContext, type FieldValueMap, type RowMap } from './evaluator'
import type { FormField, FormSchemaV1 } from './schema'

export type ValidationError = { fieldId: string; sectionId?: string; message: string }

/**
 * Validate a response payload against the form schema.
 * Stage = 'draft' relaxes 'required' checks; 'submit' enforces them.
 *
 * The payload shape mirrors what the filler submits: top-level field values
 * keyed by field id, plus each repeating section's rows stored as an array
 * under the SECTION id. Row-level errors use the filler's composite key
 * convention `${sectionId}.${rowIndex}.${fieldId}` so they land on the right
 * row input in the UI.
 */
export function validateResponse(
  schema: FormSchemaV1,
  values: FieldValueMap,
  stage: 'draft' | 'submit' = 'submit',
): ValidationError[] {
  const errors: ValidationError[] = []

  // Hoist repeating-section rows out of the flat payload so visibility rules
  // evaluate against the same context the filler and PDF renderer use.
  const rows: RowMap = {}
  for (const section of schema.sections) {
    if (!section.repeating) continue
    const raw = values[section.id]
    rows[section.id] = Array.isArray(raw)
      ? raw.filter((r): r is FieldValueMap => typeof r === 'object' && r !== null)
      : []
  }
  const ctx: EvalContext = { values, rows }

  for (const section of schema.sections) {
    if (section.showIf && !evaluateLogicRule(section.showIf, ctx)) continue

    if (section.repeating) {
      const sectionRows = rows[section.id] ?? []
      if (
        stage === 'submit' &&
        section.minRows !== undefined &&
        sectionRows.length < section.minRows
      ) {
        errors.push({
          fieldId: `__section_${section.id}`,
          sectionId: section.id,
          message: `Add at least ${section.minRows} row${section.minRows === 1 ? '' : 's'}`,
        })
      }
      sectionRows.forEach((row, rowIndex) => {
        // Per-row visibility evaluates against the row's own values layered
        // over the top-level values — same as the filler.
        const rowCtx: EvalContext = { ...ctx, values: { ...values, ...row } }
        for (const field of section.fields) {
          // Computed fields are derived at read time, never user-validated.
          if (field.type === 'formula' || field.type === 'calc') continue
          if (field.showIf && !evaluateLogicRule(field.showIf, rowCtx)) continue
          const error = validateField(field, row[field.id], stage)
          if (error) {
            errors.push({
              fieldId: `${section.id}.${rowIndex}.${field.id}`,
              sectionId: section.id,
              message: error,
            })
          }
        }
      })
      continue
    }

    for (const field of section.fields) {
      if (field.type === 'formula' || field.type === 'calc') continue
      if (field.showIf && !evaluateLogicRule(field.showIf, ctx)) continue
      const error = validateField(field, values[field.id], stage)
      if (error) errors.push({ fieldId: field.id, sectionId: section.id, message: error })
    }
  }
  return errors
}

function validateField(field: FormField, value: unknown, stage: 'draft' | 'submit'): string | null {
  const v = field.validation
  // Empty includes "[]" so a required checkbox_group / multi_select with no
  // selections fails the required check (matches user intent).
  const isEmpty =
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  // Effective `required` is the union of `field.required` and the optional
  // `validation.required` (which the designer's Validation tab edits).
  const required = field.required || v?.required
  if (required && stage === 'submit' && isEmpty) return v?.message ?? 'Required'
  if (isEmpty) return null

  switch (field.type) {
    case 'number':
    case 'rating': {
      const n = Number(value)
      if (Number.isNaN(n)) return v?.message ?? 'Must be a number'
      if (v?.min !== undefined && n < v.min) return v?.message ?? `Must be >= ${v.min}`
      if (v?.max !== undefined && n > v.max) return v?.message ?? `Must be <= ${v.max}`
      return null
    }
    case 'text':
    case 'textarea':
    case 'long_text':
    case 'email':
    case 'phone':
    case 'url': {
      const s = String(value)
      if (v?.minLength && s.length < v.minLength) return v?.message ?? `Min ${v.minLength} chars`
      if (v?.maxLength && s.length > v.maxLength) return v?.message ?? `Max ${v.maxLength} chars`
      if (v?.pattern) {
        // The pattern is designer-authored free text; an uncompilable regex
        // must not turn every submission into a server error. Treat it as
        // passing — lintFormSchema surfaces the bad pattern at design time.
        let re: RegExp | null = null
        try {
          re = new RegExp(v.pattern)
        } catch {
          re = null
        }
        if (re && !re.test(s)) return v?.message ?? 'Invalid format'
      }
      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
        return v?.message ?? 'Invalid email'
      if (field.type === 'url' && !/^https?:\/\/.+/.test(s)) return v?.message ?? 'Invalid URL'
      return null
    }
    case 'select':
    case 'radio': {
      if (v?.options && !v.options.some((o) => o.value === value) && !v.allowOther) {
        return v?.message ?? 'Not a valid choice'
      }
      return null
    }
    case 'multi_select':
    case 'checkbox_group': {
      if (!Array.isArray(value)) return v?.message ?? 'Must be a list'
      return null
    }
    default:
      return null
  }
}
