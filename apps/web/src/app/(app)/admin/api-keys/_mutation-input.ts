import { sanitizeApiPermissions } from '../../../../lib/api/permissions'
import {
  requiredDateInput,
  requiredTextInput,
  requireUuidInput,
} from '../../../../lib/mutation-input'

const MAX_API_KEY_NAME_LENGTH = 200
const MAX_BUILDER_TEMPLATE_GRANTS = 500

function stringEntries(formData: FormData, key: string): string[] {
  const values = formData.getAll(key)
  if (values.some((value) => typeof value !== 'string')) {
    throw new Error(`${key} is invalid.`)
  }
  return values as string[]
}

export function readApiKeyName(formData: FormData): string {
  return requiredTextInput(formData.get('name'), 'API key name', MAX_API_KEY_NAME_LENGTH)
}

export function readApiKeyPermissions(formData: FormData): string[] {
  const requested = [
    ...new Set(stringEntries(formData, 'permissions').map((permission) => permission.trim())),
  ].filter(Boolean)
  const permissions = sanitizeApiPermissions(requested)
  if (permissions.length !== requested.length) {
    throw new Error('One or more API permissions are invalid.')
  }
  return [...permissions].sort()
}

export function readBuilderTemplateGrantIds(formData: FormData): string[] {
  const raw = stringEntries(formData, 'builderTemplateIds')
  if (raw.length > MAX_BUILDER_TEMPLATE_GRANTS) {
    throw new Error(`Choose no more than ${MAX_BUILDER_TEMPLATE_GRANTS} Builder apps.`)
  }
  return [...new Set(raw.map((id) => requireUuidInput(id, 'Builder app grant')))].sort()
}

// Date-only input is anchored to end-of-day UTC so it round-trips exactly with
// the edit form's `toISOString().slice(0, 10)` display.
export function readApiKeyExpiresAt(formData: FormData, now: Date = new Date()): Date | null {
  const entry = formData.get('expiresAt')
  if (entry == null || entry === '') return null
  const date = requiredDateInput(entry, 'Expiry date')
  const expiresAt = new Date(`${date}T23:59:59.999Z`)
  if (expiresAt <= now) throw new Error('Expiry date must be today or later.')
  return expiresAt
}

export function readApiKeyId(formData: FormData): string {
  return requireUuidInput(formData.get('id'), 'API key')
}
