// Email provider configuration, at two scopes:
//   • per-tenant   → tenants.settings.email
//   • platform     → platform_settings.email (super-admin; applies to all tenants)
// The single provider secret (api key / token / password) is encrypted at rest
// (see ./crypto). The worker reads these back and resolves the effective
// transport (see @beaconhs/worker resolve-email-transport).

import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { platformSettings, PLATFORM_SETTINGS_ID, tenants } from '@beaconhs/db/schema'
import {
  isEmailProvider,
  type EmailPolicyMode,
  type EmailProvider,
  type PlatformEmailConfig,
  type RawEmailConfig,
} from '@beaconhs/emails'
import type { RequestContext } from '@beaconhs/tenant'
import { encryptSecret } from '@beaconhs/crypto'

const DEFAULT_PROVIDER: EmailProvider = 'resend'

function normProvider(p: string | undefined): EmailProvider {
  return isEmailProvider(p) ? p : DEFAULT_PROVIDER
}

// ---------------------------------------------------------------------------
// UI-facing shapes (no secret material)
// ---------------------------------------------------------------------------

export type EmailSettings = {
  enabled: boolean
  provider: EmailProvider
  fromName: string
  fromEmail: string
  replyTo: string
  mailgunDomain: string
  mailgunRegion: 'us' | 'eu'
  smtpHost: string
  smtpPort: string
  smtpSecure: boolean
  smtpUsername: string
  hasKey: boolean
}

export type PlatformEmailSettings = EmailSettings & { mode: EmailPolicyMode }

function toSettings(raw: RawEmailConfig): EmailSettings {
  return {
    enabled: raw.enabled !== false,
    provider: normProvider(raw.provider),
    fromName: raw.fromName ?? '',
    fromEmail: raw.fromEmail ?? '',
    replyTo: raw.replyTo ?? '',
    mailgunDomain: raw.mailgunDomain ?? '',
    mailgunRegion: raw.mailgunRegion === 'eu' ? 'eu' : 'us',
    smtpHost: raw.smtpHost ?? '',
    smtpPort: raw.smtpPort ? String(raw.smtpPort) : '',
    smtpSecure: raw.smtpSecure === true,
    smtpUsername: raw.smtpUsername ?? '',
    hasKey: Boolean(raw.keyCiphertext && raw.keyNonce),
  }
}

// The mutable, non-secret fields a save action collects from the form.
export type EmailSettingsInput = {
  enabled: boolean
  provider: EmailProvider
  fromName: string
  fromEmail: string
  replyTo: string
  mailgunDomain: string
  mailgunRegion: 'us' | 'eu'
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUsername: string
  /** Sealed when provided; omit to keep the existing key. */
  secret?: string
}

// Merge form input over the previously-stored config, re-sealing the secret only
// when a new one was typed.
function mergeRaw(prev: RawEmailConfig, input: EmailSettingsInput): RawEmailConfig {
  const next: RawEmailConfig = {
    enabled: input.enabled,
    provider: input.provider,
    fromName: input.fromName || undefined,
    fromEmail: input.fromEmail || undefined,
    replyTo: input.replyTo || undefined,
    mailgunDomain: input.mailgunDomain || undefined,
    mailgunRegion: input.mailgunRegion,
    smtpHost: input.smtpHost || undefined,
    smtpPort: input.smtpPort > 0 ? input.smtpPort : undefined,
    smtpSecure: input.smtpSecure,
    smtpUsername: input.smtpUsername || undefined,
    keyCiphertext: prev.keyCiphertext,
    keyNonce: prev.keyNonce,
  }
  if (input.secret && input.secret.trim()) {
    const sealed = encryptSecret(input.secret.trim())
    next.keyCiphertext = sealed.ciphertext
    next.keyNonce = sealed.nonce
  }
  return next
}

// ---------------------------------------------------------------------------
// Per-tenant
// ---------------------------------------------------------------------------

async function readTenantEmail(tenantId: string): Promise<RawEmailConfig> {
  return withSuperAdmin(db, async (tx) => {
    const [t] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    const raw = (t?.settings as Record<string, unknown> | undefined)?.email
    return (raw && typeof raw === 'object' ? raw : {}) as RawEmailConfig
  })
}

/** UI-facing settings for this tenant (no secret). */
export async function getTenantEmailSettings(ctx: RequestContext): Promise<EmailSettings> {
  return toSettings(await readTenantEmail(ctx.tenantId))
}

/** Raw stored config incl. the sealed secret — for the "send test" action. */
export async function getTenantEmailRaw(ctx: RequestContext): Promise<RawEmailConfig> {
  return readTenantEmail(ctx.tenantId)
}

export async function saveTenantEmailSettings(
  ctx: RequestContext,
  input: EmailSettingsInput,
): Promise<void> {
  await withSuperAdmin(db, async (tx) => {
    const [t] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    const settings = (t?.settings as Record<string, unknown>) ?? {}
    const prev = (
      settings.email && typeof settings.email === 'object' ? settings.email : {}
    ) as RawEmailConfig
    await tx
      .update(tenants)
      .set({ settings: { ...settings, email: mergeRaw(prev, input) } })
      .where(eq(tenants.id, ctx.tenantId))
  })
}

/** Clear the stored secret for this tenant. */
export async function clearTenantEmailKey(ctx: RequestContext): Promise<void> {
  await withSuperAdmin(db, async (tx) => {
    const [t] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    const settings = (t?.settings as Record<string, unknown>) ?? {}
    const prev = (
      settings.email && typeof settings.email === 'object' ? settings.email : {}
    ) as RawEmailConfig
    await tx
      .update(tenants)
      .set({
        settings: {
          ...settings,
          email: { ...prev, keyCiphertext: undefined, keyNonce: undefined },
        },
      })
      .where(eq(tenants.id, ctx.tenantId))
  })
}

// ---------------------------------------------------------------------------
// Platform (super-admin; applies to all tenants)
// ---------------------------------------------------------------------------

async function readPlatformEmail(): Promise<PlatformEmailConfig> {
  return withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({ email: platformSettings.email })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
    const raw = row?.email
    return (raw && typeof raw === 'object' ? raw : {}) as PlatformEmailConfig
  })
}

export async function getPlatformEmailSettings(): Promise<PlatformEmailSettings> {
  const raw = await readPlatformEmail()
  return { ...toSettings(raw), mode: raw.mode ?? 'tenant_optional' }
}

export async function getPlatformEmailRaw(): Promise<PlatformEmailConfig> {
  return readPlatformEmail()
}

/** The current platform policy — used to decide whether a tenant may self-configure. */
export async function getEmailPolicyMode(): Promise<EmailPolicyMode> {
  return (await readPlatformEmail()).mode ?? 'tenant_optional'
}

export async function savePlatformEmailSettings(
  input: EmailSettingsInput & { mode: EmailPolicyMode },
): Promise<void> {
  const prev = await readPlatformEmail()
  const next: PlatformEmailConfig = { ...mergeRaw(prev, input), mode: input.mode }
  await withSuperAdmin(db, async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ID, email: next })
      .onConflictDoUpdate({ target: platformSettings.id, set: { email: next } })
  })
}
