import { describe, expect, it } from 'vitest'
import { evaluateWopiPrincipal, mintWopiToken, verifyWopiToken, WOPI_TOKEN_TTL_MS } from './wopi'

const NOW = Date.UTC(2026, 6, 12, 17, 0, 0)
const grant = {
  attachmentId: '10000000-0000-4000-8000-000000000001',
  tenantId: '20000000-0000-4000-8000-000000000002',
  userId: 'user_1',
  userName: 'A. Worker',
  target: 'document' as const,
  targetId: '30000000-0000-4000-8000-000000000003',
  audience: 'document' as const,
  courseId: null,
  enrollmentId: null,
  lessonId: null,
  canWrite: true,
  activeRoleId: '40000000-0000-4000-8000-000000000004',
}

describe('WOPI grants', () => {
  it('binds a bounded grant to one attachment with a strict expiry', () => {
    const { token, exp } = mintWopiToken(grant, NOW)
    expect(exp).toBe(NOW + WOPI_TOKEN_TTL_MS)
    expect(verifyWopiToken(token, grant.attachmentId, NOW)).toEqual({ ...grant, exp })
    expect(verifyWopiToken(token, 'another-attachment', NOW)).toBeNull()
    expect(verifyWopiToken(token, grant.attachmentId, exp + 1)).toBeNull()
    expect(verifyWopiToken(token, grant.attachmentId, NOW - 60_001)).toBeNull()
  })

  it('rejects tampered, malformed, and oversized tokens', () => {
    const { token } = mintWopiToken(grant, NOW)
    const dot = token.lastIndexOf('.')
    const tampered = `${token.slice(0, dot - 1)}x${token.slice(dot)}`
    expect(verifyWopiToken(tampered, grant.attachmentId, NOW)).toBeNull()
    expect(verifyWopiToken(`${token}.extra`, grant.attachmentId, NOW)).toBeNull()
    expect(verifyWopiToken('x'.repeat(4097), grant.attachmentId, NOW)).toBeNull()
  })

  it('revokes callbacks when membership, role, or permission access changes', () => {
    const { token } = mintWopiToken(grant, NOW)
    const decoded = verifyWopiToken(token, grant.attachmentId, NOW)
    expect(decoded).not.toBeNull()
    if (!decoded) return

    const active = {
      isSuperAdmin: false,
      membershipStatus: 'active' as const,
      permissions: new Set(['documents.manage']),
      appliedRoleId: grant.activeRoleId,
    }
    expect(evaluateWopiPrincipal(decoded, active)).toBe(true)
    expect(evaluateWopiPrincipal(decoded, { ...active, membershipStatus: 'suspended' })).toBe(false)
    expect(evaluateWopiPrincipal(decoded, { ...active, permissions: new Set() })).toBe(false)
    expect(evaluateWopiPrincipal(decoded, { ...active, appliedRoleId: null })).toBe(false)
    expect(evaluateWopiPrincipal(decoded, { ...active, isSuperAdmin: true })).toBe(true)
  })

  it('requires a complete, read-only learner binding and self-read permission', () => {
    const learner = {
      ...grant,
      target: 'lesson' as const,
      targetId: '50000000-0000-4000-8000-000000000005',
      audience: 'learner' as const,
      courseId: '60000000-0000-4000-8000-000000000006',
      enrollmentId: '70000000-0000-4000-8000-000000000007',
      lessonId: '50000000-0000-4000-8000-000000000005',
      canWrite: false,
    }
    const { token } = mintWopiToken(learner, NOW)
    const decoded = verifyWopiToken(token, learner.attachmentId, NOW)
    expect(decoded).not.toBeNull()
    if (!decoded) return
    expect(
      evaluateWopiPrincipal(decoded, {
        isSuperAdmin: false,
        membershipStatus: 'active',
        permissions: new Set(['training.read.self']),
        appliedRoleId: learner.activeRoleId,
      }),
    ).toBe(true)

    const incomplete = { ...learner, enrollmentId: null }
    expect(
      verifyWopiToken(mintWopiToken(incomplete, NOW).token, incomplete.attachmentId, NOW),
    ).toBeNull()
  })
})
