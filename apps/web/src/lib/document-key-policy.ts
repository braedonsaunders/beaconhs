import { DOCUMENT_METADATA_LIMITS } from './document-metadata-limits'

export const MAX_DOCUMENT_KEY_LENGTH = DOCUMENT_METADATA_LIMITS.key
export const DOCUMENT_KEY_UNIQUE_CONSTRAINT = 'documents_tenant_key_live_ux'

type DocumentKeyResult = { ok: true; key: string } | { ok: false; error: string }

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function parseDocumentKey(value: unknown): DocumentKeyResult {
  if (typeof value !== 'string') return { ok: false, error: 'Document key is invalid.' }
  const key = slugify(value)
  if (!key) return { ok: false, error: 'Document key is required.' }
  if (key.length > MAX_DOCUMENT_KEY_LENGTH) {
    return {
      ok: false,
      error: `Document key cannot exceed ${MAX_DOCUMENT_KEY_LENGTH} characters.`,
    }
  }
  return { ok: true, key }
}

export function documentKeyFromTitle(title: string): string {
  return slugify(title).slice(0, MAX_DOCUMENT_KEY_LENGTH)
}

export function isDocumentKeyConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; constraint?: unknown; constraint_name?: unknown }
  const constraint = candidate.constraint_name ?? candidate.constraint
  return candidate.code === '23505' && constraint === DOCUMENT_KEY_UNIQUE_CONSTRAINT
}
