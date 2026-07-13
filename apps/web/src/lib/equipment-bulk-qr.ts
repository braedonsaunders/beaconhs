import { isUuid } from './list-params'

const MAX_LABELS = 500
const BULK_TOKEN_RE = /^[A-Za-z0-9_-]{11}$/

type BulkQrRequest = { ids: string[]; token: string }

export function parseBulkQrRequest(url: string): BulkQrRequest | null {
  const params = new URL(url).searchParams
  const token = params.get('token') ?? ''
  if (!BULK_TOKEN_RE.test(token)) return null

  const rawIds = (params.get('ids') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  if (rawIds.length === 0 || rawIds.length > MAX_LABELS || rawIds.some((id) => !isUuid(id))) {
    return null
  }
  const ids = Array.from(new Set(rawIds))
  return ids.length > 0 ? { ids, token } : null
}
