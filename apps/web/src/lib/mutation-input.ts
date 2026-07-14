import { isUuid } from './list-params'

export function requireRecordInput(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value as Record<string, unknown>
}

export function requireUuidInput(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!isUuid(normalized)) throw new Error(`${label} is invalid.`)
  return normalized
}

export function optionalUuidInput(value: unknown, label: string): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`)
  const normalized = value.trim()
  return normalized ? requireUuidInput(normalized, label) : null
}

export function requireUuidArrayInput(
  value: unknown,
  label: string,
  options: { min?: number; max: number },
): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} is invalid.`)
  const min = options.min ?? 1
  if (value.length < min) throw new Error(`${label} is required.`)
  if (value.length > options.max) throw new Error(`${label} has too many entries.`)
  const normalized = value.map((entry) => requireUuidInput(entry, label))
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contains duplicate entries.`)
  }
  return normalized
}

export function requireEnumInput<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!allowed.includes(normalized)) throw new Error(`${label} is invalid.`)
  return normalized as T[number]
}

export function requiredTextInput(value: unknown, label: string, maxLength: number): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new Error(`${label} is required.`)
  if (normalized.length > maxLength) throw new Error(`${label} is too long.`)
  return normalized
}

export function optionalTextInput(value: unknown, label: string, maxLength: number): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`)
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > maxLength) throw new Error(`${label} is too long.`)
  return normalized
}

export function optionalNumberInput(
  value: unknown,
  label: string,
  options: { min?: number; max?: number; integer?: boolean; maxScale?: number } = {},
): number | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`${label} is invalid.`)
  }
  const normalized = typeof value === 'string' ? value.trim() : value
  if (normalized === '') return null
  const parsed = typeof normalized === 'number' ? normalized : Number(normalized)
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid.`)
  if (options.integer && !Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a whole number.`)
  }
  if (options.min != null && parsed < options.min) {
    throw new Error(`${label} is outside the allowed range.`)
  }
  if (options.max != null && parsed > options.max) {
    throw new Error(`${label} is outside the allowed range.`)
  }
  if (options.maxScale != null) {
    const factor = 10 ** options.maxScale
    if (!Number.isSafeInteger(Math.round(parsed * factor))) {
      throw new Error(`${label} has too many decimal places.`)
    }
    const rounded = Math.round(parsed * factor) / factor
    if (Math.abs(rounded - parsed) > Number.EPSILON * Math.max(1, Math.abs(parsed))) {
      throw new Error(`${label} has too many decimal places.`)
    }
  }
  return parsed
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

export function requiredDateInput(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!isCalendarDate(normalized)) throw new Error(`${label} is invalid.`)
  return normalized
}

export function optionalDateInput(value: unknown, label: string): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`)
  const normalized = value.trim()
  return normalized ? requiredDateInput(normalized, label) : null
}
