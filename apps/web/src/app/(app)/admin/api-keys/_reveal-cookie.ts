import { isUuid } from '../../../../lib/list-params'

export const API_KEY_REVEAL_COOKIE_PREFIX = 'bhs-api-key-reveal-'

export function apiKeyRevealCookieName(apiKeyId: string): string {
  if (!isUuid(apiKeyId)) throw new Error('API key id is invalid.')
  return `${API_KEY_REVEAL_COOKIE_PREFIX}${apiKeyId.toLowerCase()}`
}

export function apiKeyIdFromRevealCookie(name: string): string | null {
  if (!name.startsWith(API_KEY_REVEAL_COOKIE_PREFIX)) return null
  const id = name.slice(API_KEY_REVEAL_COOKIE_PREFIX.length)
  return isUuid(id) ? id.toLowerCase() : null
}
