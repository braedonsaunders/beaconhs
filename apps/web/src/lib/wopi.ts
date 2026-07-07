// WOPI access tokens for the in-browser PowerPoint editor (Collabora Online).
//
// Collabora is a separate service: it loads and saves the pptx master by
// calling back into this app's /wopi/files/* routes server-to-server, carrying
// only the access_token we minted when the editor page was opened. The token
// is a compact HMAC-signed grant scoped to ONE attachment for ONE user — the
// WOPI routes authenticate with it alone (no session cookie crosses that hop).
//
// Key derivation mirrors @beaconhs/crypto: HKDF over BETTER_AUTH_SECRET with a
// purpose-scoped info string, so no new env var is required and web + worker
// deployments sharing the secret verify each other's tokens.

import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

const FALLBACK_SECRET = 'beaconhs-dev-insecure-secret'
const HKDF_INFO = 'beaconhs.wopi.v1'

function sourceSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[wopi] BETTER_AUTH_SECRET is required in production to sign WOPI tokens.')
  }
  return FALLBACK_SECRET
}

let cachedKey: Buffer | null = null
function key(): Buffer {
  if (!cachedKey) {
    cachedKey = Buffer.from(
      hkdfSync('sha256', Buffer.from(sourceSecret()), Buffer.alloc(0), Buffer.from(HKDF_INFO), 32),
    )
  }
  return cachedKey
}

export type WopiDeckTarget = 'lesson' | 'content_item'

export type WopiGrant = {
  attachmentId: string
  tenantId: string
  userId: string
  userName: string
  target: WopiDeckTarget
  targetId: string
  canWrite: boolean
  /** Expiry, ms since epoch. */
  exp: number
}

export const WOPI_TOKEN_TTL_MS = 12 * 60 * 60 * 1000 // one working session

function sign(payload: string): Buffer {
  return createHmac('sha256', key()).update(payload).digest()
}

export function mintWopiToken(grant: Omit<WopiGrant, 'exp'>): { token: string; exp: number } {
  const exp = Date.now() + WOPI_TOKEN_TTL_MS
  const full: WopiGrant = { ...grant, exp }
  const payload = Buffer.from(JSON.stringify(full)).toString('base64url')
  return { token: `${payload}.${sign(payload).toString('base64url')}`, exp }
}

/**
 * Verify a WOPI access token and bind it to the file id in the request path —
 * a token minted for one attachment can never read or write another.
 */
export function verifyWopiToken(token: string, attachmentId: string): WopiGrant | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  let expected: Buffer
  let provided: Buffer
  try {
    expected = sign(payload)
    provided = Buffer.from(sig, 'base64url')
  } catch {
    return null
  }
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null
  let grant: WopiGrant
  try {
    grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as WopiGrant
  } catch {
    return null
  }
  if (
    typeof grant.attachmentId !== 'string' ||
    typeof grant.tenantId !== 'string' ||
    typeof grant.userId !== 'string' ||
    typeof grant.targetId !== 'string' ||
    (grant.target !== 'lesson' && grant.target !== 'content_item') ||
    typeof grant.exp !== 'number'
  ) {
    return null
  }
  if (grant.attachmentId !== attachmentId) return null
  if (Date.now() > grant.exp) return null
  return grant
}
