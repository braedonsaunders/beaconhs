'use server'

import { revalidatePath } from 'next/cache'
import { assertCan, type RequestContext } from '@beaconhs/tenant'
import {
  isSmsProvider,
  isSmsPolicyMode,
  isValidSmsDestination,
  resolveEffectiveSmsTransport,
  resolveSmsTransport,
  sendSmsVia,
  type SmsPolicyMode,
  type SmsProvider,
} from '@beaconhs/sms'
import { consumeRateLimit } from '@beaconhs/jobs/rate-limit'
import { PLATFORM_SETTINGS_ID } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import {
  clearTenantSmsKey,
  getPlatformSmsRaw,
  getTenantSmsRaw,
  savePlatformSmsSettings,
  saveTenantSmsSettings,
  type SmsSettingsInput,
} from '@/lib/sms-config'

function gateTenant(ctx: RequestContext) {
  if (!ctx.isSuperAdmin) assertCan(ctx, 'admin.settings.manage')
}

function gatePlatform(ctx: RequestContext) {
  if (!ctx.isSuperAdmin)
    throw new Error('Only platform super-admins can change global SMS settings.')
}

function readTrimmedField(fd: FormData, name: string, maxLength: number): string {
  const value = String(fd.get(name) ?? '').trim()
  if (value.length > maxLength) {
    throw new Error(`${name} must be ${maxLength} characters or fewer.`)
  }
  return value
}

function parseInput(fd: FormData): SmsSettingsInput {
  const providerRaw = String(fd.get('provider') ?? '')
  if (!isSmsProvider(providerRaw)) throw new Error('Select a valid SMS provider.')
  const provider: SmsProvider = providerRaw
  return {
    enabled: fd.get('enabled') === 'on',
    provider,
    fromNumber: readTrimmedField(fd, 'fromNumber', 100),
    twilioAccountSid: readTrimmedField(fd, 'twilioAccountSid', 320),
    vonageApiKey: readTrimmedField(fd, 'vonageApiKey', 320),
    plivoAuthId: readTrimmedField(fd, 'plivoAuthId', 320),
    telnyxMessagingProfileId: readTrimmedField(fd, 'telnyxMessagingProfileId', 320),
    secret: readTrimmedField(fd, 'secret', 4_096) || undefined,
  }
}

export async function saveTenantSms(formData: FormData) {
  const ctx = await requireRequestContext()
  gateTenant(ctx)
  const input = parseInput(formData)
  const change = await saveTenantSmsSettings(ctx, input)
  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Updated tenant SMS provider override',
    metadata: {
      provider: input.provider,
      enabled: input.enabled,
      ...change,
    },
  })
  revalidatePath('/admin/sms')
}

export async function clearTenantSms() {
  const ctx = await requireRequestContext()
  gateTenant(ctx)
  const change = await clearTenantSmsKey(ctx)
  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Removed tenant SMS credential and disabled the provider override',
    metadata: change,
  })
  revalidatePath('/admin/sms')
}

export async function savePlatformSms(formData: FormData) {
  const ctx = await requireRequestContext()
  gatePlatform(ctx)
  const input = parseInput(formData)
  const modeRaw = String(formData.get('mode') ?? 'tenant_optional')
  if (!isSmsPolicyMode(modeRaw)) throw new Error('Select a valid platform SMS policy.')
  const mode: SmsPolicyMode = modeRaw
  const change = await savePlatformSmsSettings({ ...input, mode })
  await recordAudit(ctx, {
    entityType: 'platform_sms_settings',
    entityId: PLATFORM_SETTINGS_ID,
    action: 'update',
    summary: `Updated platform SMS settings (policy: ${mode})`,
    metadata: { provider: input.provider, mode, enabled: input.enabled, ...change },
  })
  revalidatePath('/platform/sms')
}

/**
 * Send a real test SMS through the SAVED config for the given scope. Save first,
 * then test — mirrors the email "Test connection" action.
 */
type SmsTestScope = 'tenant' | 'platform'
type SmsTestOutcome =
  | 'succeeded'
  | 'failed'
  | 'invalid_destination'
  | 'rate_limited'
  | 'rate_limit_unavailable'
  | 'policy_blocked'
  | 'not_configured'

const TEST_SMS_LIMIT = 5
const TEST_SMS_WINDOW_SECONDS = 10 * 60

async function auditSmsTest(
  ctx: RequestContext,
  scope: SmsTestScope,
  outcome: SmsTestOutcome,
  provider?: SmsProvider,
  retryAfterSeconds?: number,
) {
  await recordAudit(ctx, {
    entityType: scope === 'platform' ? 'platform_sms_settings' : 'tenant_sms_settings',
    entityId: scope === 'tenant' ? ctx.tenantId : PLATFORM_SETTINGS_ID,
    action: 'update',
    summary: `SMS provider test ${outcome.replaceAll('_', ' ')}`,
    metadata: {
      scope,
      outcome,
      ...(provider ? { provider } : {}),
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    },
  })
}

export async function testSmsConnection(input: {
  scope: SmsTestScope
  to: string
}): Promise<{ ok: boolean; message: string }> {
  if (input.scope !== 'tenant' && input.scope !== 'platform') {
    throw new Error('Select a valid SMS settings scope.')
  }
  const ctx = await requireRequestContext()
  if (input.scope === 'platform') gatePlatform(ctx)
  else gateTenant(ctx)

  const to = input.to.trim()
  if (!isValidSmsDestination(to)) {
    await auditSmsTest(ctx, input.scope, 'invalid_destination')
    return { ok: false, message: 'Enter a destination phone number (E.164, e.g. +15551234567).' }
  }

  let rate
  try {
    const rateKey =
      input.scope === 'platform'
        ? `sms-provider-test:platform:${ctx.userId}`
        : `sms-provider-test:tenant:${ctx.tenantId}:${ctx.userId}`
    rate = await consumeRateLimit({
      key: rateKey,
      limit: TEST_SMS_LIMIT,
      windowSeconds: TEST_SMS_WINDOW_SECONDS,
    })
  } catch (error) {
    console.error('[sms-settings] test-send rate limiter unavailable', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    await auditSmsTest(ctx, input.scope, 'rate_limit_unavailable')
    return { ok: false, message: 'Test SMS is temporarily unavailable. Try again in a minute.' }
  }

  if (!rate.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((rate.resetAt.getTime() - Date.now()) / 1_000))
    const retryMinutes = Math.ceil(retryAfterSeconds / 60)
    await auditSmsTest(ctx, input.scope, 'rate_limited', undefined, retryAfterSeconds)
    return {
      ok: false,
      message: `Too many test messages. Try again in ${retryMinutes} ${retryMinutes === 1 ? 'minute' : 'minutes'}.`,
    }
  }

  let transport
  try {
    const platform = await getPlatformSmsRaw()
    const rawMode = (platform as { mode?: unknown }).mode
    const knownMode = rawMode === undefined || isSmsPolicyMode(rawMode)
    const platformDelivery = resolveEffectiveSmsTransport(platform, null, { tenantScoped: false })
    if (!knownMode) {
      await auditSmsTest(ctx, input.scope, 'policy_blocked')
      return {
        ok: false,
        message: 'SMS is blocked because the platform policy is invalid. Contact an administrator.',
      }
    }
    if (platformDelivery.kind === 'suppressed') {
      await auditSmsTest(ctx, input.scope, 'policy_blocked')
      return { ok: false, message: 'SMS is disabled by the platform kill switch.' }
    }
    if (input.scope === 'tenant' && rawMode === 'global_only') {
      await auditSmsTest(ctx, input.scope, 'policy_blocked')
      return {
        ok: false,
        message: 'Tenant SMS is unavailable while the platform provider is enforced.',
      }
    }
    if (input.scope === 'platform') {
      transport = platformDelivery.kind === 'transport' ? platformDelivery.transport : null
    } else {
      transport = resolveSmsTransport(await getTenantSmsRaw(ctx))
    }
  } catch (error) {
    console.error('[sms-settings] saved provider could not be resolved', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    await auditSmsTest(ctx, input.scope, 'failed')
    return {
      ok: false,
      message: 'The saved SMS provider could not be loaded. Check the configuration and try again.',
    }
  }

  if (!transport) {
    await auditSmsTest(ctx, input.scope, 'not_configured')
    return {
      ok: false,
      message: 'Save a provider, sender and credential first, then send a test.',
    }
  }

  try {
    await sendSmsVia(transport, {
      to,
      body: `BeaconHS test message, sent via ${transport.provider}. Your SMS provider is configured correctly.`,
    })
    await auditSmsTest(ctx, input.scope, 'succeeded', transport.provider)
    return { ok: true, message: `Test SMS sent to ${to} via ${transport.provider}.` }
  } catch (error) {
    console.error('[sms-settings] provider rejected a test send', {
      provider: transport.provider,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    await auditSmsTest(ctx, input.scope, 'failed', transport.provider)
    return {
      ok: false,
      message: `Could not send the test SMS via ${transport.provider}. Check the saved credential and sender, then try again.`,
    }
  }
}
