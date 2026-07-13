import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  audit: vi.fn(),
  consumeRateLimit: vi.fn(),
  getPlatformRaw: vi.fn(),
  getTenantRaw: vi.fn(),
  resolveEffective: vi.fn(),
  resolveTransport: vi.fn(),
  resolvePublicHost: vi.fn(),
  clearTenant: vi.fn(),
  savePlatform: vi.fn(),
  saveTenant: vi.fn(),
  sendVia: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRequestContext: mocks.auth }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@beaconhs/jobs/rate-limit', () => ({ consumeRateLimit: mocks.consumeRateLimit }))
vi.mock('@beaconhs/sync/egress', () => ({ resolvePublicHost: mocks.resolvePublicHost }))
vi.mock('@beaconhs/emails', () => ({
  isEmailProvider: (value: unknown) => value === 'sendgrid' || value === 'smtp',
  isEmailPolicyMode: (value: unknown) =>
    value === 'tenant_optional' || value === 'global_only' || value === 'disabled',
  isValidEmailAddress: (value: string) =>
    /^[A-Za-z0-9.+_-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}$/.test(value),
  resolveEffectiveTransport: mocks.resolveEffective,
  resolveEmailTransport: mocks.resolveTransport,
  sendVia: mocks.sendVia,
}))
vi.mock('@/lib/email-config', () => ({
  clearTenantEmailKey: mocks.clearTenant,
  getPlatformEmailRaw: mocks.getPlatformRaw,
  getTenantEmailRaw: mocks.getTenantRaw,
  savePlatformEmailSettings: mocks.savePlatform,
  saveTenantEmailSettings: mocks.saveTenant,
}))

const context = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  isSuperAdmin: true,
}

const transport = {
  provider: 'sendgrid' as const,
  apiKey: 'SG.must-never-be-audited',
  from: 'BeaconHS <beacon@example.com>',
}

const unchanged = {
  previousProvider: 'sendgrid',
  providerChanged: false,
  credentialChange: 'unchanged',
  enabledChanged: false,
}

function settingsForm(extra: Record<string, string> = {}) {
  const form = new FormData()
  const values = {
    enabled: 'on',
    provider: 'sendgrid',
    fromName: 'BeaconHS',
    fromEmail: 'beacon@example.com',
    replyTo: '',
    mailgunDomain: '',
    mailgunRegion: 'us',
    smtpHost: '',
    smtpPort: '',
    smtpUsername: '',
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
  mocks.getPlatformRaw.mockResolvedValue({ provider: 'sendgrid' })
  mocks.getTenantRaw.mockResolvedValue({ provider: 'sendgrid' })
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
  mocks.resolvePublicHost.mockResolvedValue({
    hostname: 'smtp.example.com',
    address: '8.8.8.8',
    family: 4,
    ipLiteral: false,
  })
  mocks.clearTenant.mockResolvedValue(unchanged)
  mocks.savePlatform.mockResolvedValue(unchanged)
  mocks.saveTenant.mockResolvedValue(unchanged)
  mocks.sendVia.mockResolvedValue({ id: 'message-1' })
})

describe('email settings audit metadata', () => {
  it('uses the locked save result instead of guessing whether a credential changed', async () => {
    mocks.saveTenant.mockResolvedValue({
      previousProvider: 'resend',
      providerChanged: true,
      credentialChange: 'removed',
      enabledChanged: true,
    })
    const { saveTenantEmail } = await import('./email-settings-actions')
    await saveTenantEmail(settingsForm({ enabled: '', provider: 'sendgrid' }))

    expect(mocks.audit).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        summary: 'Updated tenant email provider override',
        metadata: expect.objectContaining({
          previousProvider: 'resend',
          providerChanged: true,
          credentialChange: 'removed',
        }),
      }),
    )
  })

  it('records platform changes against the platform email singleton', async () => {
    const { savePlatformEmail } = await import('./email-settings-actions')
    await savePlatformEmail(settingsForm({ mode: 'tenant_optional' }))

    expect(mocks.audit).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        entityType: 'platform_email_settings',
        entityId: '00000000-0000-0000-0000-000000000001',
      }),
    )
  })

  it('rejects a non-public active SMTP host before opening the locked save', async () => {
    mocks.resolvePublicHost.mockRejectedValue(new Error('private address'))
    const { saveTenantEmail } = await import('./email-settings-actions')

    await expect(
      saveTenantEmail(
        settingsForm({
          provider: 'smtp',
          smtpHost: 'mail.internal',
          smtpPort: '587',
        }),
      ),
    ).rejects.toThrow('Active SMTP requires a public, externally resolvable DNS hostname')
    expect(mocks.saveTenant).not.toHaveBeenCalled()
  })

  it('keeps the platform kill switch independent from SMTP DNS', async () => {
    const { savePlatformEmail } = await import('./email-settings-actions')
    await savePlatformEmail(
      settingsForm({
        mode: 'disabled',
        provider: 'smtp',
        smtpHost: 'mail.internal',
        smtpPort: '587',
      }),
    )

    expect(mocks.resolvePublicHost).not.toHaveBeenCalled()
    expect(mocks.savePlatform).toHaveBeenCalledOnce()
  })

  it('rejects a public IP literal because SMTP requires a TLS DNS identity', async () => {
    mocks.resolvePublicHost.mockResolvedValue({
      hostname: '8.8.8.8',
      address: '8.8.8.8',
      family: 4,
      ipLiteral: true,
    })
    const { saveTenantEmail } = await import('./email-settings-actions')

    await expect(
      saveTenantEmail(settingsForm({ provider: 'smtp', smtpHost: '8.8.8.8', smtpPort: '587' })),
    ).rejects.toThrow('IP-literal')
    expect(mocks.saveTenant).not.toHaveBeenCalled()
  })
})

describe('testEmailConnection', () => {
  it('rejects and audits an invalid destination before consuming rate-limit capacity', async () => {
    const { testEmailConnection } = await import('./email-settings-actions')
    const result = await testEmailConnection({ scope: 'platform', to: 'not-an-email' })

    expect(result).toEqual({
      ok: false,
      message: 'Enter a destination email address to send a test.',
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

  it('rate-limits and audits a successful test without persisting recipient or secrets', async () => {
    const { testEmailConnection } = await import('./email-settings-actions')
    const result = await testEmailConnection({ scope: 'platform', to: 'operator@example.com' })

    expect(result).toEqual({
      ok: true,
      message: 'Test email sent to operator@example.com via sendgrid.',
    })
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith({
      key: 'email-provider-test:platform:user-1',
      limit: 5,
      windowSeconds: 600,
    })
    expect(mocks.sendVia).toHaveBeenCalledOnce()
    const auditJson = JSON.stringify(mocks.audit.mock.calls[0])
    expect(auditJson).toContain('succeeded')
    expect(auditJson).toContain('sendgrid')
    expect(auditJson).not.toContain('operator@example.com')
    expect(auditJson).not.toContain('SG.must-never-be-audited')
  })

  it('audits and rejects a request after the Redis limit is exhausted', async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      count: 6,
      remaining: 0,
      resetAt: new Date(Date.now() + 120_000),
    })
    const { testEmailConnection } = await import('./email-settings-actions')
    const result = await testEmailConnection({ scope: 'tenant', to: 'operator@example.com' })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Too many test emails')
    expect(mocks.getTenantRaw).not.toHaveBeenCalled()
    expect(mocks.sendVia).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        metadata: expect.objectContaining({ outcome: 'rate_limited', scope: 'tenant' }),
      }),
    )
  })

  it('does not bypass the platform kill switch with a direct test send', async () => {
    mocks.getPlatformRaw.mockResolvedValue({
      mode: 'disabled',
      enabled: true,
      provider: 'sendgrid',
    })
    const { testEmailConnection } = await import('./email-settings-actions')
    const result = await testEmailConnection({ scope: 'platform', to: 'operator@example.com' })

    expect(result).toEqual({ ok: false, message: 'Email is disabled by the platform kill switch.' })
    expect(mocks.resolveTransport).not.toHaveBeenCalled()
    expect(mocks.sendVia).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        metadata: expect.objectContaining({ outcome: 'policy_blocked', scope: 'platform' }),
      }),
    )
  })

  it('does not bypass a forced platform policy with a direct tenant test send', async () => {
    mocks.getPlatformRaw.mockResolvedValue({ mode: 'global_only', provider: 'sendgrid' })
    const { testEmailConnection } = await import('./email-settings-actions')
    const result = await testEmailConnection({ scope: 'tenant', to: 'operator@example.com' })

    expect(result).toEqual({
      ok: false,
      message: 'Tenant email is unavailable while the platform provider is enforced.',
    })
    expect(mocks.getTenantRaw).not.toHaveBeenCalled()
    expect(mocks.sendVia).not.toHaveBeenCalled()
  })

  it('fails closed when the stored platform policy is unknown', async () => {
    mocks.getPlatformRaw.mockResolvedValue({
      mode: 'corrupt-policy',
      enabled: true,
      provider: 'sendgrid',
    })
    const { testEmailConnection } = await import('./email-settings-actions')
    const result = await testEmailConnection({ scope: 'platform', to: 'operator@example.com' })

    expect(result).toEqual({
      ok: false,
      message: 'Email is blocked because the platform policy is invalid. Contact an administrator.',
    })
    expect(mocks.resolveTransport).not.toHaveBeenCalled()
    expect(mocks.sendVia).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        metadata: expect.objectContaining({ outcome: 'policy_blocked', scope: 'platform' }),
      }),
    )
  })

  it('fails closed and audits when the Redis limiter is unavailable', async () => {
    mocks.consumeRateLimit.mockRejectedValue(new Error('redis password must not leak'))
    const { testEmailConnection } = await import('./email-settings-actions')
    const result = await testEmailConnection({ scope: 'tenant', to: 'operator@example.com' })

    expect(result).toEqual({
      ok: false,
      message: 'Test email is temporarily unavailable. Try again in a minute.',
    })
    expect(mocks.sendVia).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('redis password')
    expect(mocks.audit).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        metadata: expect.objectContaining({ outcome: 'rate_limit_unavailable' }),
      }),
    )
  })

  it('returns a generic provider failure and audits no provider error details', async () => {
    mocks.sendVia.mockRejectedValue(
      new Error('Authorization Bearer SG.must-never-be-audited; recipient operator@example.com'),
    )
    const { testEmailConnection } = await import('./email-settings-actions')
    const result = await testEmailConnection({ scope: 'tenant', to: 'operator@example.com' })

    expect(result.ok).toBe(false)
    expect(result.message).toBe(
      'Could not send the test email via sendgrid. Check the saved credential and verified sender, then try again.',
    )
    const auditJson = JSON.stringify(mocks.audit.mock.calls)
    expect(auditJson).toContain('failed')
    expect(auditJson).not.toContain('operator@example.com')
    expect(auditJson).not.toContain('SG.must-never-be-audited')
  })
})
