// AI provider configuration, at two scopes (mirrors ./email-config + ./sms-config):
//   • per-tenant   → tenants.settings.ai
//   • platform     → platform_settings.ai (super-admin; applies to all tenants)
// The API key is encrypted at rest (see ./crypto). `getTenantAiConfig` is the
// single resolver every AI consumer calls; it applies the platform → tenant
// policy (tenant_optional / global_only / disabled) so the policy is honoured
// everywhere without touching the call sites. There is no environment fallback —
// nothing AI-related lives in the environment.

import { eq, sql } from 'drizzle-orm'
import { db } from '@beaconhs/db'
import { platformSettings, PLATFORM_SETTINGS_ID, tenants } from '@beaconhs/db/schema'
import { isAiProvider, type AiConfig, type AiPolicyMode, type AiProvider } from '@beaconhs/ai'
import type { RequestContext } from '@beaconhs/tenant'
import { decryptSecret, encryptSecret } from './crypto'

type RawAi = {
  enabled?: boolean
  provider?: string
  modelFast?: string
  modelSmart?: string
  baseUrl?: string
  keyCiphertext?: string
  keyNonce?: string
  /** Auto-summarise & categorise journal entries on submit (background). Tenant-only. */
  autoJournalAi?: boolean
}

/** Platform-wide AI config: the provider PLUS the policy governing tenant overrides. */
type PlatformRawAi = RawAi & { mode?: AiPolicyMode }

function normProvider(p: string | undefined): AiProvider {
  return isAiProvider(p) ? p : 'anthropic'
}

// Common UI-facing fields shared by the tenant and platform settings shapes.
type CommonAiSettings = {
  enabled: boolean
  provider: AiProvider
  modelFast: string
  modelSmart: string
  baseUrl: string
  hasKey: boolean
}

function toCommon(ai: RawAi): CommonAiSettings {
  return {
    enabled: ai.enabled !== false,
    provider: normProvider(ai.provider),
    modelFast: ai.modelFast ?? '',
    modelSmart: ai.modelSmart ?? '',
    baseUrl: ai.baseUrl ?? '',
    hasKey: Boolean(ai.keyCiphertext && ai.keyNonce),
  }
}

export type TenantAiSettings = CommonAiSettings & { autoJournalAi: boolean }
export type PlatformAiSettings = CommonAiSettings & { mode: AiPolicyMode }

// The mutable, non-secret fields a save action collects from the form.
export type AiSettingsInput = {
  enabled: boolean
  provider: AiProvider
  modelFast: string
  modelSmart: string
  baseUrl: string
  /** Sealed when provided; omit to keep the existing key. */
  apiKey?: string
}

// Build a runtime AiConfig (decrypted key) from stored config, or null when the
// scope is disabled / has no usable key. `org` grounds generated content in the
// real tenant name; it is null for platform-scope tests.
function buildConfig(ai: RawAi, org: { name: string } | null): AiConfig | null {
  if (ai.enabled === false) return null
  if (!ai.keyCiphertext || !ai.keyNonce) return null
  const apiKey = decryptSecret({ ciphertext: ai.keyCiphertext, nonce: ai.keyNonce })
  if (!apiKey) return null
  return {
    provider: normProvider(ai.provider),
    apiKey,
    modelFast: ai.modelFast || null,
    modelSmart: ai.modelSmart || null,
    baseUrl: ai.baseUrl || null,
    org,
  }
}

// Merge form input over the previously-stored config, re-sealing the key only
// when a new one was typed. `extra` carries scope-specific fields (autoJournalAi
// for tenants, mode for the platform).
function mergeRaw<T extends RawAi>(prev: T, input: AiSettingsInput, extra: Partial<T>): T {
  const next = {
    ...extra,
    enabled: input.enabled,
    provider: input.provider,
    modelFast: input.modelFast || undefined,
    modelSmart: input.modelSmart || undefined,
    baseUrl: input.baseUrl || undefined,
    keyCiphertext: prev.keyCiphertext,
    keyNonce: prev.keyNonce,
  } as T
  if (input.apiKey && input.apiKey.trim()) {
    const sealed = encryptSecret(input.apiKey.trim())
    next.keyCiphertext = sealed.ciphertext
    next.keyNonce = sealed.nonce
  }
  return next
}

// ---------------------------------------------------------------------------
// Per-tenant
// ---------------------------------------------------------------------------

async function readAi(tenantId: string): Promise<{ ai: RawAi; orgName: string | null }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    const [t] = await tx
      .select({ settings: tenants.settings, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    const raw = (t?.settings as Record<string, unknown> | undefined)?.ai
    const ai = (raw && typeof raw === 'object' ? raw : {}) as RawAi
    return { ai, orgName: t?.name ?? null }
  })
}

/** UI-facing tenant settings (no secret material). */
export async function getTenantAiSettings(ctx: RequestContext): Promise<TenantAiSettings> {
  const { ai } = await readAi(ctx.tenantId)
  return { ...toCommon(ai), autoJournalAi: ai.autoJournalAi === true }
}

/** Whether journals are auto-summarised & tagged on submit (background AI). */
export async function getTenantAutoJournalAi(ctx: RequestContext): Promise<boolean> {
  const { ai } = await readAi(ctx.tenantId)
  return ai.enabled !== false && ai.autoJournalAi === true
}

/**
 * Runtime config (decrypted key) for AI calls — the single resolver every
 * consumer uses. Applies the platform → tenant policy:
 *   disabled        → null (global kill switch)
 *   global_only     → the platform provider (tenant settings ignored)
 *   tenant_optional → the tenant provider, else the platform default, else null
 * The tenant org name always travels with the resolved config for grounding.
 */
export async function getTenantAiConfig(ctx: RequestContext): Promise<AiConfig | null> {
  const [{ ai: tenantAi, orgName }, platformAi] = await Promise.all([
    readAi(ctx.tenantId),
    readPlatformAi(),
  ])
  const mode: AiPolicyMode = platformAi.mode ?? 'tenant_optional'
  if (mode === 'disabled') return null

  const org = orgName ? { name: orgName } : null
  if (mode !== 'global_only') {
    const tenantConfig = buildConfig(tenantAi, org)
    if (tenantConfig) return tenantConfig
  }
  return buildConfig(platformAi, org)
}

/** The tenant's OWN config, ignoring platform policy — for the "Test connection" button. */
export async function getTenantOwnAiConfig(ctx: RequestContext): Promise<AiConfig | null> {
  const { ai, orgName } = await readAi(ctx.tenantId)
  return buildConfig(ai, orgName ? { name: orgName } : null)
}

export async function saveTenantAiSettings(
  ctx: RequestContext,
  input: AiSettingsInput & { autoJournalAi: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    const [t] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    const settings = (t?.settings as Record<string, unknown>) ?? {}
    const prev = (settings.ai && typeof settings.ai === 'object' ? settings.ai : {}) as RawAi
    const next = mergeRaw(prev, input, { autoJournalAi: input.autoJournalAi })
    await tx
      .update(tenants)
      .set({ settings: { ...settings, ai: next } })
      .where(eq(tenants.id, ctx.tenantId))
  })
}

/** Clear the stored API key (and disable) for this tenant. */
export async function clearTenantAiKey(ctx: RequestContext): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    const [t] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    const settings = (t?.settings as Record<string, unknown>) ?? {}
    const prev = (settings.ai && typeof settings.ai === 'object' ? settings.ai : {}) as RawAi
    await tx
      .update(tenants)
      .set({
        settings: { ...settings, ai: { ...prev, keyCiphertext: undefined, keyNonce: undefined } },
      })
      .where(eq(tenants.id, ctx.tenantId))
  })
}

// ---------------------------------------------------------------------------
// Platform (super-admin; applies to all tenants)
// ---------------------------------------------------------------------------

async function readPlatformAi(): Promise<PlatformRawAi> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    const [row] = await tx
      .select({ ai: platformSettings.ai })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
    const raw = row?.ai
    return (raw && typeof raw === 'object' ? raw : {}) as PlatformRawAi
  })
}

export async function getPlatformAiSettings(): Promise<PlatformAiSettings> {
  const ai = await readPlatformAi()
  return { ...toCommon(ai), mode: ai.mode ?? 'tenant_optional' }
}

/** Runtime platform config (decrypted key) — for the platform "Test connection". */
export async function getPlatformAiConfig(): Promise<AiConfig | null> {
  return buildConfig(await readPlatformAi(), null)
}

/** The current platform policy — used to decide whether a tenant may self-configure. */
export async function getAiPolicyMode(): Promise<AiPolicyMode> {
  return (await readPlatformAi()).mode ?? 'tenant_optional'
}

export async function savePlatformAiSettings(
  input: AiSettingsInput & { mode: AiPolicyMode },
): Promise<void> {
  const prev = await readPlatformAi()
  const next = mergeRaw(prev, input, { mode: input.mode })
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    await tx
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ID, ai: next })
      .onConflictDoUpdate({ target: platformSettings.id, set: { ai: next } })
  })
}

/** Clear the stored platform API key. */
export async function clearPlatformAiKey(): Promise<void> {
  const prev = await readPlatformAi()
  const next: PlatformRawAi = { ...prev, keyCiphertext: undefined, keyNonce: undefined }
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    await tx
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ID, ai: next })
      .onConflictDoUpdate({ target: platformSettings.id, set: { ai: next } })
  })
}
