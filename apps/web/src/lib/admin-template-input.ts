import { isValidEmailAddress } from '@beaconhs/email-render/delivery-input'
import { normalizeEmailSubject } from '@beaconhs/email-render'

export const ADMIN_TEMPLATE_INPUT_LIMITS = {
  nameChars: 200,
  descriptionChars: 2_000,
  subjectKeyChars: 200,
} as const

function normalizedBoundedText(raw: unknown, maxChars: number): string | null {
  if (typeof raw !== 'string' || raw.length > maxChars) return null
  const value = raw.trim()
  return value && value.length <= maxChars ? value : null
}

export function normalizeTemplateName(raw: unknown): string | null {
  return normalizedBoundedText(raw, ADMIN_TEMPLATE_INPUT_LIMITS.nameChars)
}

export function normalizeTemplateDescription(raw: unknown): string | null | undefined {
  if (typeof raw !== 'string' || raw.length > ADMIN_TEMPLATE_INPUT_LIMITS.descriptionChars) {
    return undefined
  }
  return raw.trim() || null
}

export function normalizeTemplateSubject(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  try {
    return normalizeEmailSubject(raw) || null
  } catch {
    return null
  }
}

export function normalizeTemplateTestRecipient(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  return isValidEmailAddress(value) ? value : null
}

export function isBoundedTemplateSubjectKey(raw: string): boolean {
  return raw.length > 0 && raw.length <= ADMIN_TEMPLATE_INPUT_LIMITS.subjectKeyChars
}
