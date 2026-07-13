// SMS provider configuration, at two scopes:
//   • per-tenant   → tenants.settings.sms
//   • platform     → platform_settings.sms (super-admin; applies to all tenants)
// The single provider secret (auth token / api secret / key) is encrypted at
// rest (see ./crypto). The worker reads these back and resolves the effective
// transport (see @beaconhs/worker resolve-sms-transport). Mirrors ./email-config.

import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { platformSettings, PLATFORM_SETTINGS_ID, tenants } from '@beaconhs/db/schema'
import {
  isSmsProvider,
  type PlatformSmsConfig,
  type RawSmsConfig,
  type SmsPolicyMode,
  type SmsProvider,
} from '@beaconhs/sms'
import type { RequestContext } from '@beaconhs/tenant'
import { sealSecret } from '@beaconhs/crypto'

const DEFAULT_PROVIDER: SmsProvider = 'twilio'

function normProvider(p: string | undefined): SmsProvider {
  return isSmsProvider(p) ? p : DEFAULT_PROVIDER
}

// ---------------------------------------------------------------------------
// UI-facing shapes (no secret material)
// ---------------------------------------------------------------------------

type SmsSettings = {
  enabled: boolean
  provider: SmsProvider
  fromNumber: string
  twilioAccountSid: string
  vonageApiKey: string
  plivoAuthId: string
  telnyxMessagingProfileId: string
  hasKey: boolean
}

type PlatformSmsSettings = SmsSettings & { mode: SmsPolicyMode }

function toSettings(raw: RawSmsConfig): SmsSettings {
  return {
    enabled: raw.enabled !== false,
    provider: normProvider(raw.provider),
    fromNumber: raw.fromNumber ?? '',
    twilioAccountSid: raw.twilioAccountSid ?? '',
    vonageApiKey: raw.vonageApiKey ?? '',
    plivoAuthId: raw.plivoAuthId ?? '',
    telnyxMessagingProfileId: raw.telnyxMessagingProfileId ?? '',
    hasKey: Boolean(raw.keyCiphertext && raw.keyNonce),
  }
}

// The mutable, non-secret fields a save action collects from the form.
export type SmsSettingsInput = {
  enabled: boolean
  provider: SmsProvider
  fromNumber: string
  twilioAccountSid: string
  vonageApiKey: string
  plivoAuthId: string
  telnyxMessagingProfileId: string
  /** Sealed when provided; omit to keep the existing key. */
  secret?: string
}

// Merge form input over the previously-stored config, re-sealing the secret only
// when a new one was typed.
function mergeRaw(prev: RawSmsConfig, input: SmsSettingsInput): RawSmsConfig {
  const next: RawSmsConfig = {
    enabled: input.enabled,
    provider: input.provider,
    fromNumber: input.fromNumber || undefined,
    twilioAccountSid: input.twilioAccountSid || undefined,
    vonageApiKey: input.vonageApiKey || undefined,
    plivoAuthId: input.plivoAuthId || undefined,
    telnyxMessagingProfileId: input.telnyxMessagingProfileId || undefined,
    keyCiphertext: prev.keyCiphertext,
    keyNonce: prev.keyNonce,
  }
  if (input.secret && input.secret.trim()) {
    const sealed = sealSecret(input.secret.trim())
    next.keyCiphertext = sealed.ciphertext
    next.keyNonce = sealed.nonce
  }
  return next
}

// ---------------------------------------------------------------------------
// Per-tenant
// ---------------------------------------------------------------------------

async function readTenantSms(tenantId: string): Promise<RawSmsConfig> {
  return withSuperAdmin(db, async (tx) => {
    const [t] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    const raw = (t?.settings as Record<string, unknown> | undefined)?.sms
    return (raw && typeof raw === 'object' ? raw : {}) as RawSmsConfig
  })
}

/** UI-facing settings for this tenant (no secret). */
export async function getTenantSmsSettings(ctx: RequestContext): Promise<SmsSettings> {
  return toSettings(await readTenantSms(ctx.tenantId))
}

/** Raw stored config incl. the sealed secret — for the "send test" action. */
export async function getTenantSmsRaw(ctx: RequestContext): Promise<RawSmsConfig> {
  return readTenantSms(ctx.tenantId)
}

export async function saveTenantSmsSettings(
  ctx: RequestContext,
  input: SmsSettingsInput,
): Promise<void> {
  await withSuperAdmin(db, async (tx) => {
    const [t] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
      .for('update')
    const settings = (t?.settings as Record<string, unknown>) ?? {}
    const prev = (
      settings.sms && typeof settings.sms === 'object' ? settings.sms : {}
    ) as RawSmsConfig
    await tx
      .update(tenants)
      .set({ settings: { ...settings, sms: mergeRaw(prev, input) } })
      .where(eq(tenants.id, ctx.tenantId))
  })
}

/** Clear the stored secret for this tenant. */
export async function clearTenantSmsKey(ctx: RequestContext): Promise<void> {
  await withSuperAdmin(db, async (tx) => {
    const [t] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
      .for('update')
    const settings = (t?.settings as Record<string, unknown>) ?? {}
    const prev = (
      settings.sms && typeof settings.sms === 'object' ? settings.sms : {}
    ) as RawSmsConfig
    await tx
      .update(tenants)
      .set({
        settings: {
          ...settings,
          sms: { ...prev, keyCiphertext: undefined, keyNonce: undefined },
        },
      })
      .where(eq(tenants.id, ctx.tenantId))
  })
}

// ---------------------------------------------------------------------------
// Platform (super-admin; applies to all tenants)
// ---------------------------------------------------------------------------

async function readPlatformSms(): Promise<PlatformSmsConfig> {
  return withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({ sms: platformSettings.sms })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
    const raw = row?.sms
    return (raw && typeof raw === 'object' ? raw : {}) as PlatformSmsConfig
  })
}

export async function getPlatformSmsSettings(): Promise<PlatformSmsSettings> {
  const raw = await readPlatformSms()
  return { ...toSettings(raw), mode: raw.mode ?? 'tenant_optional' }
}

export async function getPlatformSmsRaw(): Promise<PlatformSmsConfig> {
  return readPlatformSms()
}

/** The current platform policy — used to decide whether a tenant may self-configure. */
export async function getSmsPolicyMode(): Promise<SmsPolicyMode> {
  return (await readPlatformSms()).mode ?? 'tenant_optional'
}

export async function savePlatformSmsSettings(
  input: SmsSettingsInput & { mode: SmsPolicyMode },
): Promise<void> {
  const prev = await readPlatformSms()
  const next: PlatformSmsConfig = { ...mergeRaw(prev, input), mode: input.mode }
  await withSuperAdmin(db, async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ID, sms: next })
      .onConflictDoUpdate({ target: platformSettings.id, set: { sms: next } })
  })
}
