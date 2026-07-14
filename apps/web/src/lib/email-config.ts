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
  isEmailPolicyMode,
  resolveEmailTransport,
  validateStoredEmailConfig,
  type EmailPolicyMode,
  type EmailProvider,
  type PlatformEmailConfig,
  type RawEmailConfig,
} from '@beaconhs/emails'
import type { RequestContext } from '@beaconhs/tenant'
import { sealSecret } from '@beaconhs/crypto'

const DEFAULT_PROVIDER: EmailProvider = 'resend'

function normProvider(p: string | undefined): EmailProvider {
  return isEmailProvider(p) ? p : DEFAULT_PROVIDER
}

// ---------------------------------------------------------------------------
// UI-facing shapes (no secret material)
// ---------------------------------------------------------------------------

type EmailSettings = {
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

type PlatformEmailSettings = EmailSettings & { mode: EmailPolicyMode }

export function toEmailSettings(raw: RawEmailConfig): EmailSettings {
  return {
    // An absent tenant config means "use the platform default", not an active
    // tenant override. A stored provider must exist before enabled can be true.
    enabled: Boolean(raw.provider) && raw.enabled === true,
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

type EmailConfigChange = {
  previousProvider: EmailProvider | null
  providerChanged: boolean
  credentialChange: 'unchanged' | 'added' | 'replaced' | 'removed'
  enabledChanged: boolean
}

function hasCredential(raw: RawEmailConfig): boolean {
  return Boolean(raw.keyCiphertext && raw.keyNonce)
}

export function describeEmailConfigChange(
  prev: RawEmailConfig,
  next: RawEmailConfig,
  credentialSupplied: boolean,
): EmailConfigChange {
  const hadCredential = hasCredential(prev)
  const hasNextCredential = hasCredential(next)
  const credentialChange: EmailConfigChange['credentialChange'] = credentialSupplied
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

export function assertTenantEmailOverrideAllowed(platform: PlatformEmailConfig): void {
  if ((platform.mode ?? 'tenant_optional') !== 'tenant_optional') {
    throw new Error(
      'Tenant email provider overrides are unavailable under the current platform policy.',
    )
  }
}

/** Validate every stored field and, for a live provider, prove its credential
 * decrypts into a usable canonical transport before committing the config. */
export function validateEmailConfigForSave(raw: RawEmailConfig, requireLive: boolean): void {
  validateStoredEmailConfig(raw, { requireComplete: requireLive })
  if (requireLive && !resolveEmailTransport(raw)) {
    throw new Error(
      'The saved provider credential could not be decrypted. Replace the credential before enabling email delivery.',
    )
  }
}

// Merge form input over the previously-stored config. A sealed credential is
// reusable only while the provider stays the same: provider credentials are
// not interchangeable, so changing providers requires a new credential.
export function mergeEmailConfig(prev: RawEmailConfig, input: EmailSettingsInput): RawEmailConfig {
  const sameProvider = prev.provider === input.provider
  const next: RawEmailConfig = {
    enabled: input.enabled,
    provider: input.provider,
    fromName: input.fromName || undefined,
    fromEmail: input.fromEmail || undefined,
    replyTo: input.replyTo || undefined,
    mailgunDomain: input.mailgunDomain || undefined,
    mailgunRegion: input.mailgunRegion,
    smtpHost: input.smtpHost || undefined,
    smtpPort: input.smtpPort === 0 ? undefined : input.smtpPort,
    smtpSecure: input.smtpSecure,
    smtpUsername: input.smtpUsername || undefined,
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
  return toEmailSettings(await readTenantEmail(ctx.tenantId))
}

/** Raw stored config incl. the sealed secret — for the "send test" action. */
export async function getTenantEmailRaw(ctx: RequestContext): Promise<RawEmailConfig> {
  return readTenantEmail(ctx.tenantId)
}

export async function saveTenantEmailSettings(
  ctx: RequestContext,
  input: EmailSettingsInput,
): Promise<EmailConfigChange> {
  return withSuperAdmin(db, async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ID })
      .onConflictDoNothing({ target: platformSettings.id })
    const [platformRow] = await tx
      .select({ email: platformSettings.email })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
      .for('share')
    const platformRaw = platformRow?.email
    assertTenantEmailOverrideAllowed(
      (platformRaw && typeof platformRaw === 'object' ? platformRaw : {}) as PlatformEmailConfig,
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
      settings.email && typeof settings.email === 'object' ? settings.email : {}
    ) as RawEmailConfig
    const next = mergeEmailConfig(prev, input)
    validateEmailConfigForSave(next, next.enabled === true)
    const updated = await tx
      .update(tenants)
      .set({ settings: { ...settings, email: next } })
      .where(eq(tenants.id, ctx.tenantId))
      .returning({ id: tenants.id })
    if (updated.length !== 1) throw new Error('The active tenant no longer exists.')
    return describeEmailConfigChange(prev, next, Boolean(input.secret))
  })
}

/** Clear the stored secret and disable this tenant's now-incomplete provider. */
export async function clearTenantEmailKey(ctx: RequestContext): Promise<EmailConfigChange> {
  return withSuperAdmin(db, async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ID })
      .onConflictDoNothing({ target: platformSettings.id })
    const [platformRow] = await tx
      .select({ email: platformSettings.email })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
      .for('share')
    const platformRaw = platformRow?.email
    assertTenantEmailOverrideAllowed(
      (platformRaw && typeof platformRaw === 'object' ? platformRaw : {}) as PlatformEmailConfig,
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
      settings.email && typeof settings.email === 'object' ? settings.email : {}
    ) as RawEmailConfig
    const next: RawEmailConfig = {
      ...prev,
      enabled: false,
      keyCiphertext: undefined,
      keyNonce: undefined,
    }
    validateEmailConfigForSave(next, false)
    const updated = await tx
      .update(tenants)
      .set({
        settings: {
          ...settings,
          email: next,
        },
      })
      .where(eq(tenants.id, ctx.tenantId))
      .returning({ id: tenants.id })
    if (updated.length !== 1) throw new Error('The active tenant no longer exists.')
    return describeEmailConfigChange(prev, next, false)
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
  if (raw.mode !== undefined && !isEmailPolicyMode(raw.mode)) {
    throw new Error('The stored platform email policy is invalid and must be repaired.')
  }
  return { ...toEmailSettings(raw), mode: raw.mode ?? 'tenant_optional' }
}

export async function getPlatformEmailRaw(): Promise<PlatformEmailConfig> {
  return readPlatformEmail()
}

/** The current platform policy — used to decide whether a tenant may self-configure. */
export async function getEmailPolicyMode(): Promise<EmailPolicyMode> {
  const raw = await readPlatformEmail()
  if (raw.mode !== undefined && !isEmailPolicyMode(raw.mode)) return 'disabled'
  return raw.mode ?? 'tenant_optional'
}

export async function savePlatformEmailSettings(
  input: EmailSettingsInput & { mode: EmailPolicyMode },
): Promise<EmailConfigChange> {
  return withSuperAdmin(db, async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ID })
      .onConflictDoNothing({ target: platformSettings.id })
    const [row] = await tx
      .select({ email: platformSettings.email })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
      .for('update')
    if (!row) throw new Error('Platform settings could not be initialized.')
    const raw = row?.email
    const prev = (raw && typeof raw === 'object' ? raw : {}) as PlatformEmailConfig
    const next: PlatformEmailConfig = { ...mergeEmailConfig(prev, input), mode: input.mode }
    // The emergency kill switch permits an incomplete disabled draft, but all
    // fields still pass the canonical validator. Live policies additionally
    // require an enabled provider whose sealed credential can be decrypted.
    const requireLive = input.mode !== 'disabled'
    if (requireLive && next.enabled !== true) {
      throw new Error('Enable the platform default provider or select Disable all email.')
    }
    validateEmailConfigForSave(next, requireLive)
    const updated = await tx
      .update(platformSettings)
      .set({ email: next, updatedAt: new Date() })
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .returning({ id: platformSettings.id })
    if (updated.length !== 1) throw new Error('Platform settings could not be updated.')
    return describeEmailConfigChange(prev, next, Boolean(input.secret))
  })
}
