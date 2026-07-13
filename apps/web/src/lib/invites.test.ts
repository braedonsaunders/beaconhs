import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { tenantUsers, users } from '@beaconhs/db/schema'
import {
  createInviteGrant,
  evaluateInviteAccess,
  inviteCallbackPath,
  inviteGrantFromCallbackURL,
  INVITE_LINK_TTL_SECONDS,
  nextInviteGenerationDate,
  verifyInviteGrant,
  type InviteGrantPayload,
} from '@beaconhs/auth/invites'

const NOW = Date.UTC(2026, 6, 12, 16, 0, 0)
const input = {
  membershipId: '10000000-0000-4000-8000-000000000001',
  tenantId: '20000000-0000-4000-8000-000000000002',
  userId: 'user_invited',
  invitedAt: new Date(Date.UTC(2026, 6, 12, 15, 30, 0)),
}

describe('invite grants', () => {
  const originalSecret = process.env.BETTER_AUTH_SECRET

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = 'test-invite-secret-with-enough-entropy'
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET
    else process.env.BETTER_AUTH_SECRET = originalSecret
  })

  it('binds a short-lived grant to one membership, tenant, user, and invitation', () => {
    const grant = createInviteGrant(input, NOW)
    const verified = verifyInviteGrant(grant, NOW + 1)
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.payload).toMatchObject({
      membershipId: input.membershipId,
      tenantId: input.tenantId,
      userId: input.userId,
      invitedAt: input.invitedAt.getTime(),
      issuedAt: NOW,
      expiresAt: NOW + INVITE_LINK_TTL_SECONDS * 1000,
    })
  })

  it('rejects tampering, expiry, and future-issued grants', () => {
    const grant = createInviteGrant(input, NOW)
    const separator = grant.lastIndexOf('.')
    const tampered = `${grant.slice(0, separator - 1)}x${grant.slice(separator)}`
    expect(verifyInviteGrant(tampered, NOW)).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyInviteGrant(grant, NOW + INVITE_LINK_TTL_SECONDS * 1000 + 1)).toEqual({
      ok: false,
      reason: 'expired',
    })
    expect(verifyInviteGrant(grant, NOW - 60_001)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('extracts grants only from the exact same-origin invitation callback', () => {
    const grant = createInviteGrant(input, NOW)
    const callback = inviteCallbackPath(grant)
    expect(inviteGrantFromCallbackURL(callback, 'https://app.example.test')).toBe(grant)
    expect(
      inviteGrantFromCallbackURL(
        `https://evil.example/invite/accept?grant=${encodeURIComponent(grant)}`,
        'https://app.example.test',
      ),
    ).toBeNull()
    expect(
      inviteGrantFromCallbackURL(
        `/dashboard?grant=${encodeURIComponent(grant)}`,
        'https://app.example.test',
      ),
    ).toBeNull()
  })

  it('rotates same-millisecond resend generations and invalidates every older grant', () => {
    const firstResend = nextInviteGenerationDate(input.invitedAt, new Date(NOW))
    const concurrentResend = nextInviteGenerationDate(firstResend, new Date(NOW))
    expect(concurrentResend.getTime()).toBe(firstResend.getTime() + 1)

    const firstGrant = createInviteGrant({ ...input, invitedAt: firstResend }, NOW)
    const first = verifyInviteGrant(firstGrant, NOW)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    expect(
      evaluateInviteAccess(first.payload, input.userId, {
        membershipId: input.membershipId,
        tenantId: input.tenantId,
        userId: input.userId,
        invitedAt: concurrentResend,
        status: 'invited',
        emailVerified: true,
        tenantStatus: 'active',
      }),
    ).toBe('invalid')
  })

  it('retains the unique constraints required for conflict-safe concurrent creation', () => {
    const uniqueColumns = (table: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(table)
        .indexes.filter((index) => index.config.unique)
        .map((index) =>
          index.config.columns.map((column) => (column as { name?: string }).name ?? '').sort(),
        )

    expect(uniqueColumns(users)).toContainEqual(['email'])
    expect(uniqueColumns(tenantUsers)).toContainEqual(['tenant_id', 'user_id'])
  })
})

describe('invite eligibility', () => {
  const payload: InviteGrantPayload = {
    v: 1,
    membershipId: input.membershipId,
    tenantId: input.tenantId,
    userId: input.userId,
    invitedAt: input.invitedAt.getTime(),
    issuedAt: NOW,
    expiresAt: NOW + INVITE_LINK_TTL_SECONDS * 1000,
  }
  const record = {
    membershipId: input.membershipId,
    tenantId: input.tenantId,
    userId: input.userId,
    invitedAt: input.invitedAt,
    status: 'invited' as const,
    emailVerified: true,
    tenantStatus: 'active' as const,
  }

  it('accepts only the matching verified pending membership', () => {
    expect(evaluateInviteAccess(payload, input.userId, record)).toBe('pending')
    expect(evaluateInviteAccess(payload, 'another-user', record)).toBe('invalid')
    expect(
      evaluateInviteAccess(payload, input.userId, {
        ...record,
        invitedAt: new Date(record.invitedAt.getTime() + 1),
      }),
    ).toBe('invalid')
    expect(evaluateInviteAccess(payload, input.userId, { ...record, emailVerified: false })).toBe(
      'unverified',
    )
  })

  it('never reactivates suspended members or unavailable tenants', () => {
    expect(evaluateInviteAccess(payload, input.userId, { ...record, status: 'suspended' })).toBe(
      'suspended',
    )
    expect(
      evaluateInviteAccess(payload, input.userId, { ...record, tenantStatus: 'suspended' }),
    ).toBe('tenant_unavailable')
    expect(evaluateInviteAccess(payload, input.userId, { ...record, status: 'active' })).toBe(
      'active',
    )
  })
})
