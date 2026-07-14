import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db, withSuperAdmin, type Database } from '@beaconhs/db'
import { auditLog, tenants, tenantUsers, users } from '@beaconhs/db/schema'
import { materializeUserIdentityAudienceObligations } from '@beaconhs/compliance'

const INVITE_GRANT_VERSION = 1
const INVITE_HKDF_INFO = 'beaconhs.invite.v1'
const DEV_SECRET = 'beaconhs-dev-invite-secret'
const MAX_GRANT_LENGTH = 4096

/** Keep this aligned with the Better Auth magic-link expiry. */
export const INVITE_LINK_TTL_SECONDS = 15 * 60

export type InviteGrantInput = {
  membershipId: string
  tenantId: string
  userId: string
  invitedAt: Date
}

export type InviteGrantPayload = {
  v: typeof INVITE_GRANT_VERSION
  membershipId: string
  tenantId: string
  userId: string
  invitedAt: number
  issuedAt: number
  expiresAt: number
}

export type InviteGrantVerification =
  { ok: true; payload: InviteGrantPayload } | { ok: false; reason: 'invalid' | 'expired' }

export type InviteAccessState =
  'active' | 'pending' | 'suspended' | 'tenant_unavailable' | 'unverified' | 'invalid' | 'expired'

type InviteRecord = {
  membershipId: string
  tenantId: string
  userId: string
  invitedAt: Date | null
  status: 'active' | 'invited' | 'suspended'
  emailVerified: boolean
  tenantStatus: 'active' | 'suspended' | 'archived'
}

export type InviteInspection = {
  state: InviteAccessState
  tenantId: string | null
  tenantName: string | null
}

function sourceSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[auth] BETTER_AUTH_SECRET is required to sign invite grants.')
  }
  return DEV_SECRET
}

function signingKey(): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(sourceSecret()),
      Buffer.alloc(0),
      Buffer.from(INVITE_HKDF_INFO),
      32,
    ),
  )
}

function sign(payload: string): Buffer {
  return createHmac('sha256', signingKey()).update(payload).digest()
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function parsePayload(value: unknown): InviteGrantPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const p = value as Partial<InviteGrantPayload>
  if (
    p.v !== INVITE_GRANT_VERSION ||
    !isBoundedString(p.membershipId, 100) ||
    !isBoundedString(p.tenantId, 100) ||
    !isBoundedString(p.userId, 200) ||
    !Number.isSafeInteger(p.invitedAt) ||
    !Number.isSafeInteger(p.issuedAt) ||
    !Number.isSafeInteger(p.expiresAt) ||
    p.expiresAt! <= p.issuedAt! ||
    p.expiresAt! - p.issuedAt! > INVITE_LINK_TTL_SECONDS * 1000
  ) {
    return null
  }
  return p as InviteGrantPayload
}

/**
 * Mint a short-lived, membership-targeted grant for an invitation callback.
 * Better Auth's own magic-link token remains the one-time credential; this
 * signed payload binds that verified callback to exactly one pending membership.
 */
export function createInviteGrant(input: InviteGrantInput, now = Date.now()): string {
  if (!Number.isSafeInteger(now)) throw new Error('Invalid invite issuance time.')
  const payload: InviteGrantPayload = {
    v: INVITE_GRANT_VERSION,
    membershipId: input.membershipId,
    tenantId: input.tenantId,
    userId: input.userId,
    invitedAt: input.invitedAt.getTime(),
    issuedAt: now,
    expiresAt: now + INVITE_LINK_TTL_SECONDS * 1000,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${sign(encoded).toString('base64url')}`
}

export function verifyInviteGrant(raw: string, now = Date.now()): InviteGrantVerification {
  if (!raw || raw.length > MAX_GRANT_LENGTH || !Number.isSafeInteger(now)) {
    return { ok: false, reason: 'invalid' }
  }
  const separator = raw.lastIndexOf('.')
  if (separator <= 0 || separator === raw.length - 1) return { ok: false, reason: 'invalid' }
  const encoded = raw.slice(0, separator)
  const signature = raw.slice(separator + 1)

  let expected: Buffer
  let provided: Buffer
  try {
    expected = sign(encoded)
    provided = Buffer.from(signature, 'base64url')
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'invalid' }
  }

  let payload: InviteGrantPayload | null = null
  try {
    payload = parsePayload(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')))
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (!payload) return { ok: false, reason: 'invalid' }
  if (now < payload.issuedAt - 60_000 || now > payload.expiresAt) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true, payload }
}

export function inviteCallbackPath(grant: string): string {
  return `/invite/accept?${new URLSearchParams({ grant }).toString()}`
}

/**
 * Produce a distinct invitation generation after the caller locks the
 * membership row. The monotonic millisecond matters when two resend requests
 * arrive in the same clock tick: every resend must invalidate every older
 * signed grant, not accidentally reuse its `invitedAt` binding.
 */
export function nextInviteGenerationDate(previous: Date | null, now = new Date()): Date {
  const nowMs = now.getTime()
  const previousMs = previous?.getTime() ?? -1
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(previousMs)) {
    throw new Error('Invalid invitation generation time.')
  }
  return new Date(Math.max(nowMs, previousMs + 1))
}

/** Extract only the grant carried by our exact, same-origin invite callback. */
export function inviteGrantFromCallbackURL(callbackURL: unknown, baseURL: string): string | null {
  if (typeof callbackURL !== 'string' || !callbackURL) return null
  try {
    const base = new URL(baseURL)
    const callback = new URL(callbackURL, base)
    if (callback.origin !== base.origin || callback.pathname !== '/invite/accept') return null
    return callback.searchParams.get('grant')
  } catch {
    return null
  }
}

/** Pure state machine used by both the DB acceptance path and focused tests. */
export function evaluateInviteAccess(
  payload: InviteGrantPayload,
  sessionUserId: string,
  record: InviteRecord | null,
): InviteAccessState {
  if (!record || sessionUserId !== payload.userId) return 'invalid'
  if (
    record.membershipId !== payload.membershipId ||
    record.tenantId !== payload.tenantId ||
    record.userId !== payload.userId ||
    record.invitedAt?.getTime() !== payload.invitedAt
  ) {
    return 'invalid'
  }
  if (record.tenantStatus !== 'active') return 'tenant_unavailable'
  if (record.status === 'suspended') return 'suspended'
  if (record.status === 'active') return 'active'
  if (!record.emailVerified) return 'unverified'
  return 'pending'
}

async function loadInviteRecord(tx: Database, membershipId: string, lock: boolean) {
  let query = tx
    .select({
      membershipId: tenantUsers.id,
      tenantId: tenantUsers.tenantId,
      userId: tenantUsers.userId,
      invitedAt: tenantUsers.invitedAt,
      status: tenantUsers.status,
      emailVerified: users.emailVerified,
      tenantStatus: tenants.status,
      tenantName: tenants.name,
    })
    .from(tenantUsers)
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
    .where(eq(tenantUsers.id, membershipId))
    .limit(1)
  if (lock) query = query.for('update') as typeof query
  const [row] = await query
  return row ?? null
}

/**
 * Called only by the successful Better Auth magic-link verification hook.
 * The conditional update and acceptance audit commit together, so concurrent
 * links cannot double-accept or reactivate a membership an admin suspended.
 */
export async function acceptInviteAfterMagicLink(
  rawGrant: string,
  sessionUserId: string,
): Promise<InviteAccessState> {
  const verified = verifyInviteGrant(rawGrant)
  if (!verified.ok) return verified.reason

  return withSuperAdmin(db, async (tx) => {
    const row = await loadInviteRecord(tx, verified.payload.membershipId, true)
    const state = evaluateInviteAccess(verified.payload, sessionUserId, row)
    if (state !== 'pending' || !row) return state

    const acceptedAt = new Date()
    const [accepted] = await tx
      .update(tenantUsers)
      .set({ status: 'active', joinedAt: acceptedAt, updatedAt: acceptedAt })
      .where(
        and(
          eq(tenantUsers.id, verified.payload.membershipId),
          eq(tenantUsers.tenantId, verified.payload.tenantId),
          eq(tenantUsers.userId, verified.payload.userId),
          eq(tenantUsers.status, 'invited'),
          eq(tenantUsers.invitedAt, new Date(verified.payload.invitedAt)),
        ),
      )
      .returning({ id: tenantUsers.id })

    // The row lock makes this defensive in normal operation. Keep the branch
    // for database-level races or future callers that change the lock policy.
    if (!accepted) {
      const current = await loadInviteRecord(tx, verified.payload.membershipId, false)
      return evaluateInviteAccess(verified.payload, sessionUserId, current)
    }

    await materializeUserIdentityAudienceObligations(tx, verified.payload.tenantId, [
      verified.payload.userId,
    ])

    await tx.insert(auditLog).values({
      tenantId: verified.payload.tenantId,
      actorUserId: sessionUserId,
      entityType: 'tenant_user',
      entityId: verified.payload.membershipId,
      action: 'update',
      summary: 'Accepted membership invitation',
      before: { status: 'invited' },
      after: { status: 'active', joinedAt: acceptedAt.toISOString() },
      metadata: { acceptedVia: 'magic_link' },
    })
    return 'active'
  })
}

/** Read-only callback inspection; it never changes an invited membership. */
export async function inspectInviteForUser(
  rawGrant: string,
  sessionUserId: string,
): Promise<InviteInspection> {
  const verified = verifyInviteGrant(rawGrant)
  if (!verified.ok) {
    return { state: verified.reason, tenantId: null, tenantName: null }
  }
  return withSuperAdmin(db, async (tx) => {
    const row = await loadInviteRecord(tx, verified.payload.membershipId, false)
    const state = evaluateInviteAccess(verified.payload, sessionUserId, row)
    return {
      state,
      tenantId: row?.tenantId ?? null,
      tenantName: row?.tenantName ?? null,
    }
  })
}
