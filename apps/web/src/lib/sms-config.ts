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
  isSmsPolicyMode,
  resolveSmsTransport,
  validateStoredSmsConfig,
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

export function toSmsSettings(raw: RawSmsConfig): SmsSettings {
  return {
    enabled: Boolean(raw.provider) && raw.enabled === true,
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

type SmsConfigChange = {
  previousProvider: SmsProvider | null
  providerChanged: boolean
  credentialChange: 'unchanged' | 'added' | 'replaced' | 'removed'
  enabledChanged: boolean
}

function hasCredential(raw: RawSmsConfig): boolean {
  return Boolean(raw.keyCiphertext && raw.keyNonce)
}

export function describeSmsConfigChange(
  prev: RawSmsConfig,
  next: RawSmsConfig,
  credentialSupplied: boolean,
): SmsConfigChange {
  const hadCredential = hasCredential(prev)
  const hasNextCredential = hasCredential(next)
  const credentialChange: SmsConfigChange['credentialChange'] = credentialSupplied
    ? hadCredential
      ? 'replaced'
      : 'added'
    : hadCredential && !hasNextCredential
      ? 'removed'
      : 'unchanged'
  const wasEnabled = Boolean(prev.provider) && prev.enabled === true
  return {
    previousProvider: prev.provider ?? null,
    providerChanged: prev.provider !== next.provider,
    credentialChange,
    enabledChanged: wasEnabled !== (Boolean(next.provider) && next.enabled === true),
  }
}

export function assertTenantSmsOverrideAllowed(platform: PlatformSmsConfig): void {
  if ((platform.mode ?? 'tenant_optional') !== 'tenant_optional') {
    throw new Error(
      'Tenant SMS provider overrides are unavailable under the current platform policy.',
    )
  }
}

export function validateSmsConfigForSave(raw: RawSmsConfig, requireLive: boolean): void {
  validateStoredSmsConfig(raw, { requireComplete: requireLive })
  if (requireLive && !resolveSmsTransport(raw)) {
    throw new Error(
      'The saved SMS provider credential could not be decrypted. Replace the credential before enabling SMS delivery.',
    )
  }
}

// Provider credentials are not interchangeable. A stored secret is retained
// only when the provider remains unchanged.
export function mergeSmsConfig(prev: RawSmsConfig, input: SmsSettingsInput): RawSmsConfig {
  const sameProvider = prev.provider === input.provider
  const next: RawSmsConfig = {
    enabled: input.enabled,
    provider: input.provider,
    fromNumber: input.fromNumber || undefined,
    twilioAccountSid: input.twilioAccountSid || undefined,
    vonageApiKey: input.vonageApiKey || undefined,
    plivoAuthId: input.plivoAuthId || undefined,
    telnyxMessagingProfileId: input.telnyxMessagingProfileId || undefined,
    keyCiphertext: sameProvider ? prev.keyCiphertext : undefined,
    keyNonce: sameProvider ? prev.keyNonce : undefined,
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
  return toSmsSettings(await readTenantSms(ctx.tenantId))
}

/** Raw stored config incl. the sealed secret — for the "send test" action. */
export async function getTenantSmsRaw(ctx: RequestContext): Promise<RawSmsConfig> {
  return readTenantSms(ctx.tenantId)
}

export async function saveTenantSmsSettings(
  ctx: RequestContext,
  input: SmsSettingsInput,
): Promise<SmsConfigChange> {
  return withSuperAdmin(db, async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ID })
      .onConflictDoNothing({ target: platformSettings.id })
    const [platformRow] = await tx
      .select({ sms: platformSettings.sms })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
      .for('share')
    const platformRaw = platformRow?.sms
    assertTenantSmsOverrideAllowed(
      (platformRaw && typeof platformRaw === 'object' ? platformRaw : {}) as PlatformSmsConfig,
    )

    const [t] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
      .for('update')
    if (!t) throw new Error('The active tenant no longer exists.')
    const settings = t.settings as Record<string, unknown>
    const prev = (
      settings.sms && typeof settings.sms === 'object' ? settings.sms : {}
    ) as RawSmsConfig
    const next = mergeSmsConfig(prev, input)
    validateSmsConfigForSave(next, next.enabled === true)
    const updated = await tx
      .update(tenants)
      .set({ settings: { ...settings, sms: next } })
      .where(eq(tenants.id, ctx.tenantId))
      .returning({ id: tenants.id })
    if (updated.length !== 1) throw new Error('The active tenant no longer exists.')
    return describeSmsConfigChange(prev, next, Boolean(input.secret))
  })
}

/** Clear the stored secret and disable this tenant's incomplete provider. */
export async function clearTenantSmsKey(ctx: RequestContext): Promise<SmsConfigChange> {
  return withSuperAdmin(db, async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ID })
      .onConflictDoNothing({ target: platformSettings.id })
    const [platformRow] = await tx
      .select({ sms: platformSettings.sms })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
      .for('share')
    const platformRaw = platformRow?.sms
    assertTenantSmsOverrideAllowed(
      (platformRaw && typeof platformRaw === 'object' ? platformRaw : {}) as PlatformSmsConfig,
    )

    const [t] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
      .for('update')
    if (!t) throw new Error('The active tenant no longer exists.')
    const settings = t.settings as Record<string, unknown>
    const prev = (
      settings.sms && typeof settings.sms === 'object' ? settings.sms : {}
    ) as RawSmsConfig
    const next: RawSmsConfig = {
      ...prev,
      enabled: false,
      keyCiphertext: undefined,
      keyNonce: undefined,
    }
    validateSmsConfigForSave(next, false)
    const updated = await tx
      .update(tenants)
      .set({
        settings: {
          ...settings,
          sms: next,
        },
      })
      .where(eq(tenants.id, ctx.tenantId))
      .returning({ id: tenants.id })
    if (updated.length !== 1) throw new Error('The active tenant no longer exists.')
    return describeSmsConfigChange(prev, next, false)
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
  if (raw.mode !== undefined && !isSmsPolicyMode(raw.mode)) {
    throw new Error('The stored platform SMS policy is invalid and must be repaired.')
  }
  return { ...toSmsSettings(raw), mode: raw.mode ?? 'tenant_optional' }
}

export async function getPlatformSmsRaw(): Promise<PlatformSmsConfig> {
  return readPlatformSms()
}

/** The current platform policy — used to decide whether a tenant may self-configure. */
export async function getSmsPolicyMode(): Promise<SmsPolicyMode> {
  const raw = await readPlatformSms()
  if (raw.mode !== undefined && !isSmsPolicyMode(raw.mode)) return 'disabled'
  return raw.mode ?? 'tenant_optional'
}

export async function savePlatformSmsSettings(
  input: SmsSettingsInput & { mode: SmsPolicyMode },
): Promise<SmsConfigChange> {
  return withSuperAdmin(db, async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ID })
      .onConflictDoNothing({ target: platformSettings.id })
    const [row] = await tx
      .select({ sms: platformSettings.sms })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
      .for('update')
    if (!row) throw new Error('Platform settings could not be initialized.')
    const raw = row.sms
    const prev = (raw && typeof raw === 'object' ? raw : {}) as PlatformSmsConfig
    const next: PlatformSmsConfig = { ...mergeSmsConfig(prev, input), mode: input.mode }
    const requireLive = input.mode !== 'disabled'
    if (requireLive && next.enabled !== true) {
      throw new Error('Enable the platform default provider or select Disable all SMS.')
    }
    validateSmsConfigForSave(next, requireLive)
    const updated = await tx
      .update(platformSettings)
      .set({ sms: next, updatedAt: new Date() })
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .returning({ id: platformSettings.id })
    if (updated.length !== 1) throw new Error('Platform settings could not be updated.')
    return describeSmsConfigChange(prev, next, Boolean(input.secret))
  })
}
