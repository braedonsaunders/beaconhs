import { describe, expect, it } from 'vitest'
import {
  apiKeyIdFromRevealCookie,
  apiKeyRevealCookieName,
  API_KEY_REVEAL_COOKIE_PREFIX,
} from './_reveal-cookie'

const ID = '10000000-0000-4000-8000-000000000001'

describe('API key reveal cookies', () => {
  it('names each one-time reveal by its key id so simultaneous creates do not collide', () => {
    expect(apiKeyRevealCookieName(ID)).toBe(`${API_KEY_REVEAL_COOKIE_PREFIX}${ID}`)
    expect(apiKeyIdFromRevealCookie(apiKeyRevealCookieName(ID))).toBe(ID)
  })

  it('rejects unrelated and malformed cookie names', () => {
    expect(apiKeyIdFromRevealCookie('session')).toBeNull()
    expect(apiKeyIdFromRevealCookie(`${API_KEY_REVEAL_COOKIE_PREFIX}invalid`)).toBeNull()
    expect(() => apiKeyRevealCookieName('invalid')).toThrow(/invalid/)
  })
})
