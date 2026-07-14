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
const HKDF_INFO = 'beaconhs.wopi.v2'
const WOPI_GRANT_VERSION = 2
const MAX_WOPI_TOKEN_LENGTH = 4096
const CLOCK_SKEW_MS = 60_000

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

/** What a WOPI-edited file belongs to: a training deck target or a document. */
type WopiTarget = 'lesson' | 'content_item' | 'document'
/** Training-deck subset (slides lessons + library items). */
export type WopiDeckTarget = 'lesson' | 'content_item'
export type WopiAudience = 'document' | 'author' | 'instructor' | 'learner'

export type WopiGrant = {
  attachmentId: string
  tenantId: string
  userId: string
  userName: string
  target: WopiTarget
  targetId: string
  audience: WopiAudience
  /** Course/deck binding for instructor and learner presentation grants. */
  courseId: string | null
  /** Enrollment and concrete lesson binding for a learner presentation grant. */
  enrollmentId: string | null
  lessonId: string | null
  canWrite: boolean
  activeRoleId: string | null
  /** Expiry, ms since epoch. */
  exp: number
}

export const WOPI_TOKEN_TTL_MS = 12 * 60 * 60 * 1000 // one working session

function sign(payload: string): Buffer {
  return createHmac('sha256', key()).update(payload).digest()
}

export function mintWopiToken(
  grant: Omit<WopiGrant, 'exp'>,
  now = Date.now(),
): { token: string; exp: number } {
  if (!Number.isSafeInteger(now)) throw new Error('Invalid WOPI issuance time.')
  const exp = now + WOPI_TOKEN_TTL_MS
  const full = { v: WOPI_GRANT_VERSION, iat: now, ...grant, exp }
  const payload = Buffer.from(JSON.stringify(full)).toString('base64url')
  return { token: `${payload}.${sign(payload).toString('base64url')}`, exp }
}

/**
 * Verify a WOPI access token and bind it to the file id in the request path —
 * a token minted for one attachment can never read or write another.
 */
export function verifyWopiToken(
  token: string,
  attachmentId: string,
  now = Date.now(),
): WopiGrant | null {
  if (!token || token.length > MAX_WOPI_TOKEN_LENGTH || !Number.isSafeInteger(now)) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0 || dot !== token.indexOf('.') || dot === token.length - 1) return null
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
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const grant = parsed as Partial<WopiGrant> & { v?: unknown; iat?: unknown }
  const issuedAt = grant.iat
  const expiresAt = grant.exp
  if (
    grant.v !== WOPI_GRANT_VERSION ||
    !isBoundedString(grant.attachmentId, 100) ||
    !isBoundedString(grant.tenantId, 100) ||
    !isBoundedString(grant.userId, 200) ||
    !isBoundedString(grant.userName, 200) ||
    !isBoundedString(grant.targetId, 100) ||
    (grant.courseId !== null && !isBoundedString(grant.courseId, 100)) ||
    (grant.enrollmentId !== null && !isBoundedString(grant.enrollmentId, 100)) ||
    (grant.lessonId !== null && !isBoundedString(grant.lessonId, 100)) ||
    (grant.activeRoleId !== null && !isBoundedString(grant.activeRoleId, 100)) ||
    (grant.target !== 'lesson' && grant.target !== 'content_item' && grant.target !== 'document') ||
    (grant.audience !== 'document' &&
      grant.audience !== 'author' &&
      grant.audience !== 'instructor' &&
      grant.audience !== 'learner') ||
    typeof grant.canWrite !== 'boolean' ||
    !isSafeInteger(issuedAt) ||
    !isSafeInteger(expiresAt) ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > WOPI_TOKEN_TTL_MS
  ) {
    return null
  }
  if (grant.attachmentId !== attachmentId) return null
  if (!grantShapeMatchesAudience(grant as WopiGrant)) return null
  if (now < issuedAt - CLOCK_SKEW_MS || now > expiresAt) return null
  return {
    attachmentId: grant.attachmentId,
    tenantId: grant.tenantId,
    userId: grant.userId,
    userName: grant.userName,
    target: grant.target,
    targetId: grant.targetId,
    audience: grant.audience,
    courseId: grant.courseId,
    enrollmentId: grant.enrollmentId,
    lessonId: grant.lessonId,
    canWrite: grant.canWrite,
    activeRoleId: grant.activeRoleId,
    exp: expiresAt,
  }
}

type WopiPrincipalState = {
  isSuperAdmin: boolean
  membershipStatus: 'active' | 'invited' | 'suspended' | null
  permissions: Set<string>
  appliedRoleId: string | null
}

function wopiRequiredPermissions(grant: WopiGrant): string[] {
  if (grant.audience === 'author') return ['training.course.manage']
  if (grant.audience === 'instructor') {
    return ['training.class.manage', 'training.course.manage']
  }
  if (grant.audience === 'learner') return ['training.read.self']
  return [grant.canWrite ? 'documents.manage' : 'documents.read']
}

/** Pure revocation check shared by callback authorization and focused tests. */
export function evaluateWopiPrincipal(grant: WopiGrant, principal: WopiPrincipalState): boolean {
  if (principal.isSuperAdmin) return true
  if (principal.membershipStatus !== 'active') return false
  if (grant.activeRoleId && principal.appliedRoleId !== grant.activeRoleId) return false
  const required = wopiRequiredPermissions(grant)
  for (const needed of required) {
    if (principal.permissions.has(needed)) return true
    for (const permission of principal.permissions) {
      if (permission.endsWith('.*') && needed.startsWith(permission.slice(0, -1))) return true
    }
  }
  return false
}

function grantShapeMatchesAudience(grant: WopiGrant): boolean {
  if (grant.audience === 'document') {
    return (
      grant.target === 'document' &&
      grant.courseId === null &&
      grant.enrollmentId === null &&
      grant.lessonId === null
    )
  }
  if (grant.target === 'document') return false
  if (grant.audience === 'author') {
    return grant.courseId === null && grant.enrollmentId === null && grant.lessonId === null
  }
  if (grant.canWrite || !grant.courseId) return false
  if (grant.audience === 'instructor') {
    return grant.enrollmentId === null && grant.lessonId === null
  }
  return Boolean(grant.enrollmentId && grant.lessonId)
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}
