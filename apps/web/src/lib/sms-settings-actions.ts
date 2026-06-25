'use server'

import { revalidatePath } from 'next/cache'
import { assertCan, type RequestContext } from '@beaconhs/tenant'
import {
  isSmsProvider,
  resolveSmsTransport,
  sendSmsVia,
  type SmsPolicyMode,
  type SmsProvider,
} from '@beaconhs/sms'
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

function parseInput(fd: FormData): SmsSettingsInput {
  const providerRaw = String(fd.get('provider') ?? '')
  const provider: SmsProvider = isSmsProvider(providerRaw) ? providerRaw : 'twilio'
  return {
    enabled: fd.get('enabled') === 'on',
    provider,
    fromNumber: String(fd.get('fromNumber') ?? '').trim(),
    twilioAccountSid: String(fd.get('twilioAccountSid') ?? '').trim(),
    vonageApiKey: String(fd.get('vonageApiKey') ?? '').trim(),
    plivoAuthId: String(fd.get('plivoAuthId') ?? '').trim(),
    telnyxMessagingProfileId: String(fd.get('telnyxMessagingProfileId') ?? '').trim(),
    secret: String(fd.get('secret') ?? '').trim() || undefined,
  }
}

export async function saveTenantSms(formData: FormData) {
  const ctx = await requireRequestContext()
  gateTenant(ctx)
  const input = parseInput(formData)
  await saveTenantSmsSettings(ctx, input)
  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Updated SMS settings',
    metadata: {
      provider: input.provider,
      enabled: input.enabled,
      keyChanged: Boolean(input.secret),
    },
  })
  revalidatePath('/admin/sms')
}

export async function clearTenantSms() {
  const ctx = await requireRequestContext()
  gateTenant(ctx)
  await clearTenantSmsKey(ctx)
  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Removed SMS provider credential',
  })
  revalidatePath('/admin/sms')
}

export async function savePlatformSms(formData: FormData) {
  const ctx = await requireRequestContext()
  gatePlatform(ctx)
  const input = parseInput(formData)
  const modeRaw = String(formData.get('mode') ?? 'tenant_optional')
  const mode: SmsPolicyMode =
    modeRaw === 'global_only' || modeRaw === 'disabled' ? modeRaw : 'tenant_optional'
  await savePlatformSmsSettings({ ...input, mode })
  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: `Updated platform SMS settings (policy: ${mode})`,
    metadata: { provider: input.provider, mode, enabled: input.enabled },
  })
  revalidatePath('/platform/sms')
}

/**
 * Send a real test SMS through the SAVED config for the given scope. Save first,
 * then test — mirrors the email "Test connection" action.
 */
export async function testSmsConnection(input: {
  scope: 'tenant' | 'platform'
  to: string
}): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireRequestContext()
  if (input.scope === 'platform') gatePlatform(ctx)
  else gateTenant(ctx)

  const to = input.to.trim()
  if (!/^\+?[0-9][0-9\s-]{5,}$/.test(to)) {
    return { ok: false, message: 'Enter a destination phone number (E.164, e.g. +15551234567).' }
  }

  const raw = input.scope === 'platform' ? await getPlatformSmsRaw() : await getTenantSmsRaw(ctx)
  const transport = resolveSmsTransport(raw)
  if (!transport) {
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
    return { ok: true, message: `Test SMS sent to ${to} via ${transport.provider}.` }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message.slice(0, 200) : 'Could not send the test SMS.',
    }
  }
}
