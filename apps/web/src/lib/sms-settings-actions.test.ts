import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  audit: vi.fn(),
  consumeRateLimit: vi.fn(),
  getPlatformRaw: vi.fn(),
  getTenantRaw: vi.fn(),
  resolveEffective: vi.fn(),
  resolveTransport: vi.fn(),
  clearTenant: vi.fn(),
  savePlatform: vi.fn(),
  saveTenant: vi.fn(),
  sendVia: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRequestContext: mocks.auth }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@beaconhs/jobs/rate-limit', () => ({ consumeRateLimit: mocks.consumeRateLimit }))
vi.mock('@beaconhs/sms', () => ({
  isSmsProvider: (value: unknown) => value === 'twilio' || value === 'messagebird',
  isSmsPolicyMode: (value: unknown) =>
    value === 'tenant_optional' || value === 'global_only' || value === 'disabled',
  isValidSmsDestination: (value: string) => /^\+[1-9][0-9]{7,14}$/.test(value),
  resolveEffectiveSmsTransport: mocks.resolveEffective,
  resolveSmsTransport: mocks.resolveTransport,
  sendSmsVia: mocks.sendVia,
}))
vi.mock('@/lib/sms-config', () => ({
  clearTenantSmsKey: mocks.clearTenant,
  getPlatformSmsRaw: mocks.getPlatformRaw,
  getTenantSmsRaw: mocks.getTenantRaw,
  savePlatformSmsSettings: mocks.savePlatform,
  saveTenantSmsSettings: mocks.saveTenant,
}))

import { savePlatformSms, saveTenantSms, testSmsConnection } from './sms-settings-actions'

const context = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  isSuperAdmin: true,
}

const transport = {
  provider: 'twilio' as const,
  accountSid: 'AC-account',
  authToken: 'must-never-be-audited',
  from: '+15551234567',
}

const unchanged = {
  previousProvider: 'twilio',
  providerChanged: false,
  credentialChange: 'unchanged',
  enabledChanged: false,
}

function settingsForm(extra: Record<string, string> = {}) {
  const form = new FormData()
  const values = {
    enabled: 'on',
    provider: 'twilio',
    fromNumber: '+15551234567',
    twilioAccountSid: 'AC-account',
    vonageApiKey: '',
    plivoAuthId: '',
    telnyxMessagingProfileId: '',
    ...extra,
  }
  for (const [key, value] of Object.entries(values)) form.set(key, value)
  return form
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(context)
  mocks.audit.mockResolvedValue(undefined)
  mocks.consumeRateLimit.mockResolvedValue({
    allowed: true,
    count: 1,
    remaining: 4,
    resetAt: new Date(Date.now() + 10 * 60_000),
  })
  mocks.getPlatformRaw.mockResolvedValue({ provider: 'twilio' })
  mocks.getTenantRaw.mockResolvedValue({ provider: 'twilio' })
  mocks.resolveEffective.mockImplementation((platform: { mode?: unknown }) =>
    platform.mode === 'disabled'
      ? { kind: 'suppressed' }
      : platform.mode !== undefined &&
          platform.mode !== 'tenant_optional' &&
          platform.mode !== 'global_only'
        ? { kind: 'unconfigured' }
        : { kind: 'transport', transport, source: 'platform' },
  )
  mocks.resolveTransport.mockReturnValue(transport)
  mocks.clearTenant.mockResolvedValue(unchanged)
  mocks.savePlatform.mockResolvedValue(unchanged)
  mocks.saveTenant.mockResolvedValue(unchanged)
  mocks.sendVia.mockResolvedValue({ id: 'message-1' })
})

describe('SMS settings mutations', () => {
  it('uses the locked save result for secret-safe tenant audit metadata', async () => {
    mocks.saveTenant.mockResolvedValue({
      previousProvider: 'messagebird',
      providerChanged: true,
      credentialChange: 'removed',
      enabledChanged: true,
    })
    await saveTenantSms(settingsForm({ enabled: '' }))

    expect(mocks.audit).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        summary: 'Updated tenant SMS provider override',
        metadata: expect.objectContaining({
          previousProvider: 'messagebird',
          providerChanged: true,
          credentialChange: 'removed',
        }),
      }),
    )
  })

  it('rejects invalid providers and policies instead of silently coercing them', async () => {
    await expect(saveTenantSms(settingsForm({ provider: 'unknown' }))).rejects.toThrow(
      'valid SMS provider',
    )
    await expect(
      savePlatformSms(settingsForm({ mode: 'unknown-platform-policy' })),
    ).rejects.toThrow('valid platform SMS policy')
    expect(mocks.saveTenant).not.toHaveBeenCalled()
    expect(mocks.savePlatform).not.toHaveBeenCalled()
  })

  it('records platform changes against the platform SMS singleton', async () => {
    await savePlatformSms(settingsForm({ mode: 'tenant_optional' }))
    expect(mocks.audit).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        entityType: 'platform_sms_settings',
        entityId: '00000000-0000-0000-0000-000000000001',
      }),
    )
  })
})

describe('testSmsConnection', () => {
  it('rejects and audits an invalid E.164 destination before using rate capacity', async () => {
    const result = await testSmsConnection({ scope: 'platform', to: '555-1234' })
    expect(result).toEqual({
      ok: false,
      message: 'Enter a destination phone number (E.164, e.g. +15551234567).',
    })
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled()
    expect(mocks.sendVia).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        metadata: expect.objectContaining({ outcome: 'invalid_destination', scope: 'platform' }),
      }),
    )
  })

  it('rate-limits a successful test and never audits the recipient or secret', async () => {
    const result = await testSmsConnection({ scope: 'platform', to: '+15551234567' })
    expect(result).toEqual({ ok: true, message: 'Test SMS sent to +15551234567 via twilio.' })
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith({
      key: 'sms-provider-test:platform:user-1',
      limit: 5,
      windowSeconds: 600,
    })
    const auditJson = JSON.stringify(mocks.audit.mock.calls)
    expect(auditJson).toContain('succeeded')
    expect(auditJson).not.toContain('+15551234567')
    expect(auditJson).not.toContain('must-never-be-audited')
  })

  it('rejects an exhausted rate limit before loading provider credentials', async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      count: 6,
      remaining: 0,
      resetAt: new Date(Date.now() + 120_000),
    })
    const result = await testSmsConnection({ scope: 'tenant', to: '+15551234567' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Too many test messages')
    expect(mocks.getTenantRaw).not.toHaveBeenCalled()
    expect(mocks.sendVia).not.toHaveBeenCalled()
  })

  it('does not bypass the kill switch or forced platform policy', async () => {
    mocks.getPlatformRaw.mockResolvedValue({ mode: 'disabled' })
    await expect(testSmsConnection({ scope: 'platform', to: '+15551234567' })).resolves.toEqual({
      ok: false,
      message: 'SMS is disabled by the platform kill switch.',
    })
    expect(mocks.sendVia).not.toHaveBeenCalled()

    mocks.getPlatformRaw.mockResolvedValue({ mode: 'global_only' })
    await expect(testSmsConnection({ scope: 'tenant', to: '+15551234567' })).resolves.toEqual({
      ok: false,
      message: 'Tenant SMS is unavailable while the platform provider is enforced.',
    })
    expect(mocks.getTenantRaw).not.toHaveBeenCalled()
  })

  it('fails closed when the stored platform policy is unknown', async () => {
    mocks.getPlatformRaw.mockResolvedValue({ mode: 'corrupt-policy' })
    await expect(testSmsConnection({ scope: 'platform', to: '+15551234567' })).resolves.toEqual({
      ok: false,
      message: 'SMS is blocked because the platform policy is invalid. Contact an administrator.',
    })
    expect(mocks.sendVia).not.toHaveBeenCalled()
  })

  it('fails closed when the rate limiter is unavailable', async () => {
    mocks.consumeRateLimit.mockRejectedValue(new Error('redis password must not leak'))
    const result = await testSmsConnection({ scope: 'tenant', to: '+15551234567' })
    expect(result).toEqual({
      ok: false,
      message: 'Test SMS is temporarily unavailable. Try again in a minute.',
    })
    expect(mocks.sendVia).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('redis password')
  })

  it('returns a generic failure without exposing provider errors', async () => {
    mocks.sendVia.mockRejectedValue(
      new Error('Rejected must-never-be-audited for recipient +15551234567'),
    )
    const result = await testSmsConnection({ scope: 'tenant', to: '+15551234567' })
    expect(result).toEqual({
      ok: false,
      message:
        'Could not send the test SMS via twilio. Check the saved credential and sender, then try again.',
    })
    const auditJson = JSON.stringify(mocks.audit.mock.calls)
    expect(auditJson).toContain('failed')
    expect(auditJson).not.toContain('+15551234567')
    expect(auditJson).not.toContain('must-never-be-audited')
  })
})
