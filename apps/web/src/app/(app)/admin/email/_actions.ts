'use server'

import { revalidatePath } from 'next/cache'
import { assertCan, type RequestContext } from '@beaconhs/tenant'
import {
  isEmailProvider,
  resolveEmailTransport,
  sendVia,
  type EmailPolicyMode,
  type EmailProvider,
} from '@beaconhs/emails'
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

function parseInput(fd: FormData): EmailSettingsInput {
  const providerRaw = String(fd.get('provider') ?? '')
  const provider: EmailProvider = isEmailProvider(providerRaw) ? providerRaw : 'resend'
  return {
    enabled: fd.get('enabled') === 'on',
    provider,
    fromName: String(fd.get('fromName') ?? '').trim(),
    fromEmail: String(fd.get('fromEmail') ?? '').trim(),
    replyTo: String(fd.get('replyTo') ?? '').trim(),
    mailgunDomain: String(fd.get('mailgunDomain') ?? '').trim(),
    mailgunRegion: fd.get('mailgunRegion') === 'eu' ? 'eu' : 'us',
    smtpHost: String(fd.get('smtpHost') ?? '').trim(),
    smtpPort: Number(fd.get('smtpPort') ?? 0) || 0,
    smtpSecure: fd.get('smtpSecure') === 'on',
    smtpUsername: String(fd.get('smtpUsername') ?? '').trim(),
    secret: String(fd.get('secret') ?? '').trim() || undefined,
  }
}

export async function saveTenantEmail(formData: FormData) {
  const ctx = await requireRequestContext()
  gateTenant(ctx)
  const input = parseInput(formData)
  await saveTenantEmailSettings(ctx, input)
  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Updated email settings',
    metadata: {
      provider: input.provider,
      enabled: input.enabled,
      keyChanged: Boolean(input.secret),
    },
  })
  revalidatePath('/admin/email')
}

export async function clearTenantEmail() {
  const ctx = await requireRequestContext()
  gateTenant(ctx)
  await clearTenantEmailKey(ctx)
  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Removed email provider credential',
  })
  revalidatePath('/admin/email')
}

export async function savePlatformEmail(formData: FormData) {
  const ctx = await requireRequestContext()
  gatePlatform(ctx)
  const input = parseInput(formData)
  const modeRaw = String(formData.get('mode') ?? 'tenant_optional')
  const mode: EmailPolicyMode =
    modeRaw === 'global_only' || modeRaw === 'disabled' ? modeRaw : 'tenant_optional'
  await savePlatformEmailSettings({ ...input, mode })
  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: `Updated platform email settings (policy: ${mode})`,
    metadata: { provider: input.provider, mode, enabled: input.enabled },
  })
  revalidatePath('/admin/email')
}

/**
 * Send a real test email through the SAVED config for the given scope. Save
 * first, then test — mirrors the AI "Test connection" action.
 */
export async function testEmailConnection(input: {
  scope: 'tenant' | 'platform'
  to: string
}): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireRequestContext()
  if (input.scope === 'platform') gatePlatform(ctx)
  else gateTenant(ctx)

  const to = input.to.trim()
  if (!to || !to.includes('@')) {
    return { ok: false, message: 'Enter a destination email address to send a test.' }
  }

  const raw =
    input.scope === 'platform' ? await getPlatformEmailRaw() : await getTenantEmailRaw(ctx)
  const transport = resolveEmailTransport(raw)
  if (!transport) {
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
    return { ok: true, message: `Test email sent to ${to} via ${transport.provider}.` }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message.slice(0, 200) : 'Could not send the test email.',
    }
  }
}
