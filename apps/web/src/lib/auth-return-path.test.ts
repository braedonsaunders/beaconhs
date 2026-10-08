import { describe, expect, it } from 'vitest'
import { authContinuationPath, authEntryPath, authReturnPath } from './auth-return-path'

describe('authentication preserves safe deep links', () => {
  it('returns to a signature request after password or magic-link sign in', () => {
    const path = '/hazard-assessments/sign/abc?tenant=123'
    expect(authEntryPath(false, path)).toBe(`/login?next=${encodeURIComponent(path)}`)
    expect(authEntryPath(true, path)).toBe(authContinuationPath(path))
    const continuation = new URL(authContinuationPath(path), 'https://beaconhs.invalid')
    expect(authReturnPath(continuation.searchParams.get('next'))).toBe(path)
  })
  it.each([
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    '/%2f%2fevil.test',
    '/%5cevil.test',
    '/bad\npath',
    '/%0dpath',
    '/login',
    '/auth/continue',
    '/api/auth/sign-out',
    '/x'.repeat(1100),
    '/%zz',
  ])('rejects hostile or looping return path %s', (path) => {
    expect(authReturnPath(path)).toBeNull()
    expect(authEntryPath(false, path)).toBe('/login')
    expect(authContinuationPath(path)).toBe('/auth/continue')
  })
})
