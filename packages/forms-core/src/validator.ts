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
  const isEmpty = value === undefined || value === null || value === ''
  if (field.required && stage === 'submit' && isEmpty) return 'Required'
  if (isEmpty) return null

  const v = field.validation
  switch (field.type) {
    case 'number':
    case 'rating': {
      const n = Number(value)
      if (Number.isNaN(n)) return 'Must be a number'
      if (v?.min !== undefined && n < v.min) return `Must be >= ${v.min}`
      if (v?.max !== undefined && n > v.max) return `Must be <= ${v.max}`
      return null
    }
    case 'text':
    case 'textarea':
    case 'email':
    case 'phone':
    case 'url': {
      const s = String(value)
      if (v?.minLength && s.length < v.minLength) return `Min ${v.minLength} chars`
      if (v?.maxLength && s.length > v.maxLength) return `Max ${v.maxLength} chars`
      if (v?.pattern && !new RegExp(v.pattern).test(s)) return 'Invalid format'
      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'Invalid email'
      if (field.type === 'url' && !/^https?:\/\/.+/.test(s)) return 'Invalid URL'
      return null
    }
    case 'select':
    case 'radio': {
      if (v?.options && !v.options.some((o) => o.value === value) && !v.allowOther) {
        return 'Not a valid choice'
      }
      return null
    }
    case 'multi_select':
    case 'checkbox_group': {
      if (!Array.isArray(value)) return 'Must be a list'
      return null
    }
    default:
      return null
  }
}
