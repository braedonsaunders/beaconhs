import { evalLogicRule, type FieldValues } from './logic'
import type { FormField, FormSchemaV1 } from './schema'

export type ValidationError = { fieldId: string; sectionId?: string; message: string }

/**
 * Validate a response payload against the form schema.
 * Stage = 'draft' relaxes 'required' checks; 'submit' enforces them.
 */
export function validateResponse(
  schema: FormSchemaV1,
  values: FieldValues,
  stage: 'draft' | 'submit' = 'submit',
): ValidationError[] {
  const errors: ValidationError[] = []
  for (const section of schema.sections) {
    if (section.showIf && !evalLogicRule(section.showIf, values)) continue
    for (const field of section.fields) {
      if (field.showIf && !evalLogicRule(field.showIf, values)) continue
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
      if (v?.pattern && !new RegExp(v.pattern).test(s)) return v?.message ?? 'Invalid format'
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
