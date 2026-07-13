/** Parse the exact 256-bit API credential format. Bounded before hashing so an
 * attacker cannot turn the credential lookup into unbounded input work. */
export function parseApiBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!header || header.length > 128) return null
  const match = /^Bearer (bhs_live_[A-Za-z0-9_-]{43})$/.exec(header)
  return match?.[1] ?? null
}
