export const INSIGHT_DASHBOARD_NAME_MAX_LENGTH = 60
export const INSIGHT_CARD_NAME_MAX_LENGTH = 120
export const INSIGHT_CARD_DESCRIPTION_MAX_LENGTH = 500
export const INTEGRATION_CONNECTION_NAME_MAX_LENGTH = 200

type PersistedTextResult = { ok: true; value: string } | { ok: false; error: string }

type OptionalPersistedTextResult = { ok: true; value: string | null } | { ok: false; error: string }

function validMaximum(maxLength: number): boolean {
  return Number.isSafeInteger(maxLength) && maxLength > 0 && maxLength <= 10_000
}

/** Validate before persistence; never silently rewrite overlong user input. */
export function validateRequiredPersistedText(
  value: unknown,
  options: { label: string; maxLength: number },
): PersistedTextResult {
  if (!validMaximum(options.maxLength)) throw new Error('Invalid persisted-text maximum.')
  if (typeof value !== 'string') return { ok: false, error: `${options.label} is required.` }
  const normalized = value.trim()
  if (!normalized) return { ok: false, error: `${options.label} is required.` }
  if (normalized.length > options.maxLength) {
    return {
      ok: false,
      error: `${options.label} must be ${options.maxLength.toLocaleString('en-US')} characters or fewer.`,
    }
  }
  return { ok: true, value: normalized }
}

export function validateOptionalPersistedText(
  value: unknown,
  options: { label: string; maxLength: number },
): OptionalPersistedTextResult {
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  if (!validMaximum(options.maxLength)) throw new Error('Invalid persisted-text maximum.')
  if (typeof value !== 'string') return { ok: false, error: `${options.label} must be text.` }
  const normalized = value.trim()
  if (!normalized) return { ok: true, value: null }
  if (normalized.length > options.maxLength) {
    return {
      ok: false,
      error: `${options.label} must be ${options.maxLength.toLocaleString('en-US')} characters or fewer.`,
    }
  }
  return { ok: true, value: normalized }
}
