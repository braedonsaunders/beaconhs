'use server'

import { revalidatePath } from 'next/cache'
import { assertCan, type RequestContext } from '@beaconhs/tenant'
import {
  isEmailProvider,
  isEmailPolicyMode,
  isValidEmailAddress,
  resolveEffectiveTransport,
  resolveEmailTransport,
  sendVia,
  type EmailPolicyMode,
  type EmailProvider,
} from '@beaconhs/emails'
import { consumeRateLimit } from '@beaconhs/jobs/rate-limit'
import { PLATFORM_SETTINGS_ID } from '@beaconhs/db/schema'
import { resolvePublicHost } from '@beaconhs/sync/egress'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import {
  clearTenantEmailKey,
  getPlatformEmailRaw,
  getTenantEmailRaw,
  savePlatformEmailSettings,
  saveTenantEmailSettings,
  type EmailSettingsInput,
} from '@/lib/email-config'

function gateTenant(ctx: RequestContext) {
  if (!ctx.isSuperAdmin) assertCan(ctx, 'admin.settings.manage')
}

function gatePlatform(ctx: RequestContext) {
  if (!ctx.isSuperAdmin)
    throw new Error('Only platform super-admins can change global email settings.')
}

function readTrimmedField(fd: FormData, name: string, maxLength: number): string {
  const value = String(fd.get(name) ?? '').trim()
  if (value.length > maxLength) {
    throw new Error(`${name} must be ${maxLength} characters or fewer.`)
  }
  return value
}

function parseInput(fd: FormData): EmailSettingsInput {
  const providerRaw = String(fd.get('provider') ?? '')
  if (!isEmailProvider(providerRaw)) throw new Error('Select a valid email provider.')
  const provider: EmailProvider = providerRaw
  const smtpPortRaw = readTrimmedField(fd, 'smtpPort', 5)
  const input: EmailSettingsInput = {
    enabled: fd.get('enabled') === 'on',
    provider,
    fromName: readTrimmedField(fd, 'fromName', 128),
    fromEmail: readTrimmedField(fd, 'fromEmail', 254),
    replyTo: readTrimmedField(fd, 'replyTo', 254),
    mailgunDomain: readTrimmedField(fd, 'mailgunDomain', 253),
    mailgunRegion: fd.get('mailgunRegion') === 'eu' ? 'eu' : 'us',
    smtpHost: readTrimmedField(fd, 'smtpHost', 253),
    smtpPort: smtpPortRaw ? Number(smtpPortRaw) : 0,
    smtpSecure: fd.get('smtpSecure') === 'on',
    smtpUsername: readTrimmedField(fd, 'smtpUsername', 320),
    secret: readTrimmedField(fd, 'secret', 4_096) || undefined,
  }
  return input
}

async function validateActiveSmtpHost(input: EmailSettingsInput, active: boolean): Promise<void> {
  if (!active || input.provider !== 'smtp') return
  try {
    const resolved = await resolvePublicHost(input.smtpHost, { timeoutMs: 10_000 })
    if (resolved.ipLiteral) {
      throw new Error('IP literals cannot provide the required SMTP TLS hostname identity.')
    }
  } catch {
    throw new Error(
      'Active SMTP requires a public, externally resolvable DNS hostname. Private, local, reserved, IP-literal, and unresolvable hosts are blocked.',
    )
  }
}

export async function saveTenantEmail(formData: FormData) {
  const ctx = await requireRequestContext()
  gateTenant(ctx)
  const input = parseInput(formData)
  // DNS must never run while the configuration transaction holds row locks.
  // The locked save re-checks platform policy after this network validation.
  await validateActiveSmtpHost(input, input.enabled)
  const change = await saveTenantEmailSettings(ctx, input)
  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Updated tenant email provider override',
    metadata: {
      provider: input.provider,
      enabled: input.enabled,
      ...change,
    },
  })
  revalidatePath('/admin/email')
}

export async function clearTenantEmail() {
  const ctx = await requireRequestContext()
  gateTenant(ctx)
  const change = await clearTenantEmailKey(ctx)
  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Removed tenant email credential and disabled the provider override',
    metadata: change,
  })
  revalidatePath('/admin/email')
}

type EmailTestScope = 'tenant' | 'platform'
type EmailTestOutcome =
  | 'succeeded'
  | 'failed'
  | 'invalid_destination'
  | 'rate_limited'
  | 'rate_limit_unavailable'
  | 'policy_blocked'
  | 'not_configured'

const TEST_EMAIL_LIMIT = 5
const TEST_EMAIL_WINDOW_SECONDS = 10 * 60

async function auditEmailTest(
  ctx: RequestContext,
  scope: EmailTestScope,
  outcome: EmailTestOutcome,
  provider?: EmailProvider,
  retryAfterSeconds?: number,
) {
  await recordAudit(ctx, {
    entityType: scope === 'platform' ? 'platform_email_settings' : 'tenant_email_settings',
    entityId: scope === 'tenant' ? ctx.tenantId : PLATFORM_SETTINGS_ID,
    action: 'update',
    summary: `Email provider test ${outcome.replaceAll('_', ' ')}`,
    metadata: {
      scope,
      outcome,
      ...(provider ? { provider } : {}),
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    },
  })
}

export async function savePlatformEmail(formData: FormData) {
  const ctx = await requireRequestContext()
  gatePlatform(ctx)
  const input = parseInput(formData)
  const modeRaw = String(formData.get('mode') ?? 'tenant_optional')
  if (modeRaw !== 'tenant_optional' && modeRaw !== 'global_only' && modeRaw !== 'disabled') {
    throw new Error('Select a valid platform email policy.')
  }
  const mode: EmailPolicyMode = modeRaw
  // The kill switch remains immediate and network-independent. Live SMTP is
  // validated before the locked configuration transaction begins.
  await validateActiveSmtpHost(input, mode !== 'disabled' && input.enabled)
  const change = await savePlatformEmailSettings({ ...input, mode })
  await recordAudit(ctx, {
    entityType: 'platform_email_settings',
    entityId: PLATFORM_SETTINGS_ID,
    action: 'update',
    summary: `Updated platform email settings (policy: ${mode})`,
    metadata: { provider: input.provider, mode, enabled: input.enabled, ...change },
  })
  revalidatePath('/platform/email')
}

/**
 * Send a real test email through the SAVED config for the given scope. Save
 * first, then test — mirrors the AI "Test connection" action.
 */
export async function testEmailConnection(input: {
  scope: EmailTestScope
  to: string
}): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireRequestContext()
  if (input.scope === 'platform') gatePlatform(ctx)
  else gateTenant(ctx)

  const to = input.to.trim()
  if (!isValidEmailAddress(to)) {
    await auditEmailTest(ctx, input.scope, 'invalid_destination')
    return { ok: false, message: 'Enter a destination email address to send a test.' }
  }

  let rate
  try {
    const rateKey =
      input.scope === 'platform'
        ? `email-provider-test:platform:${ctx.userId}`
        : `email-provider-test:tenant:${ctx.tenantId}:${ctx.userId}`
    rate = await consumeRateLimit({
      key: rateKey,
      limit: TEST_EMAIL_LIMIT,
      windowSeconds: TEST_EMAIL_WINDOW_SECONDS,
    })
  } catch (error) {
    console.error('[email-settings] test-send rate limiter unavailable', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    await auditEmailTest(ctx, input.scope, 'rate_limit_unavailable')
    return {
      ok: false,
      message: 'Test email is temporarily unavailable. Try again in a minute.',
    }
  }

  if (!rate.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((rate.resetAt.getTime() - Date.now()) / 1_000))
    const retryMinutes = Math.ceil(retryAfterSeconds / 60)
    await auditEmailTest(ctx, input.scope, 'rate_limited', undefined, retryAfterSeconds)
    return {
      ok: false,
      message: `Too many test emails. Try again in ${retryMinutes} ${retryMinutes === 1 ? 'minute' : 'minutes'}.`,
    }
  }

  let transport
  try {
    const platform = await getPlatformEmailRaw()
    const rawMode = (platform as { mode?: unknown }).mode
    const knownMode = rawMode === undefined || isEmailPolicyMode(rawMode)
    const platformDelivery = resolveEffectiveTransport(platform, null, { tenantScoped: false })
    if (!knownMode) {
      await auditEmailTest(ctx, input.scope, 'policy_blocked')
      return {
        ok: false,
        message:
          'Email is blocked because the platform policy is invalid. Contact an administrator.',
      }
    }
    if (platformDelivery.kind === 'suppressed') {
      await auditEmailTest(ctx, input.scope, 'policy_blocked')
      return { ok: false, message: 'Email is disabled by the platform kill switch.' }
    }
    if (input.scope === 'tenant' && rawMode === 'global_only') {
      await auditEmailTest(ctx, input.scope, 'policy_blocked')
      return {
        ok: false,
        message: 'Tenant email is unavailable while the platform provider is enforced.',
      }
    }
    if (input.scope === 'platform') {
      transport = platformDelivery.kind === 'transport' ? platformDelivery.transport : null
    } else {
      transport = resolveEmailTransport(await getTenantEmailRaw(ctx))
    }
  } catch (error) {
    console.error('[email-settings] saved provider could not be resolved', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    await auditEmailTest(ctx, input.scope, 'failed')
    return {
      ok: false,
      message:
        'The saved email provider could not be loaded. Check the configuration and try again.',
    }
  }

  if (!transport) {
    await auditEmailTest(ctx, input.scope, 'not_configured')
    return {
      ok: false,
      message: 'Save a provider, sender address and credential first, then send a test.',
    }
  }

  try {
    await sendVia(transport, {
      to,
      subject: 'BeaconHS test email',
      text: `This is a test email from BeaconHS, sent via ${transport.provider}. If you received it, your email provider is configured correctly.`,
      html: `<p>This is a test email from <strong>BeaconHS</strong>, sent via <strong>${transport.provider}</strong>.</p><p>If you received it, your email provider is configured correctly.</p>`,
    })
    await auditEmailTest(ctx, input.scope, 'succeeded', transport.provider)
    return { ok: true, message: `Test email sent to ${to} via ${transport.provider}.` }
  } catch (error) {
    console.error('[email-settings] provider rejected a test send', {
      provider: transport.provider,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    await auditEmailTest(ctx, input.scope, 'failed', transport.provider)
    return {
      ok: false,
      message: `Could not send the test email via ${transport.provider}. Check the saved credential and verified sender, then try again.`,
    }
  }
}
