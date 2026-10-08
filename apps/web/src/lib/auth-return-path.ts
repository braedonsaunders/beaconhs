import { sanitizeFrom } from './back-nav'

/** Share the existing in-app path guard, and exclude authentication loops. */
export function authReturnPath(value: string | null | undefined): string | null {
  const path = sanitizeFrom(value)
  if (!path || path.length > 2048) return null
  try {
    const url = new URL(path, 'https://beaconhs.invalid')
    const decoded = decodeURIComponent(url.pathname)
    if (
      url.origin !== 'https://beaconhs.invalid' ||
      decoded.startsWith('//') ||
      decoded.includes('\\') ||
      /[\u0000-\u0020\u007f]/.test(decoded)
    )
      return null
    if (/^\/(?:login|auth|api)(?:\/|$)/.test(url.pathname)) return null
    return path
  } catch {
    return null
  }
}
export function authContinuationPath(returnTo: string | null | undefined): string {
  const path = authReturnPath(returnTo)
  return path ? `/auth/continue?next=${encodeURIComponent(path)}` : '/auth/continue'
}
export function authEntryPath(hasSession: boolean, returnTo: string | null | undefined): string {
  if (hasSession) return authContinuationPath(returnTo)
  const path = authReturnPath(returnTo)
  return path ? `/login?next=${encodeURIComponent(path)}` : '/login'
}
