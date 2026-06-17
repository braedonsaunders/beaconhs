// Per-tenant AI configuration, stored in tenants.settings.ai. The API key is
// encrypted at rest (see ./crypto). This is the single source of truth for AI —
// nothing AI-related lives in the environment.

import { eq, sql } from 'drizzle-orm'
import { db } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'
import { isAiProvider, type AiConfig, type AiProvider } from '@beaconhs/ai'
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
  /** Auto-summarise & categorise journal entries on submit (background). */
  autoJournalAi?: boolean
}

export type TenantAiSettings = {
  enabled: boolean
  provider: AiProvider
  modelFast: string
  modelSmart: string
  baseUrl: string
  hasKey: boolean
  autoJournalAi: boolean
}

function normProvider(p: string | undefined): AiProvider {
  return isAiProvider(p) ? p : 'anthropic'
}

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

/** UI-facing settings (no secret material). */
export async function getTenantAiSettings(ctx: RequestContext): Promise<TenantAiSettings> {
  const { ai } = await readAi(ctx.tenantId)
  return {
    enabled: ai.enabled !== false,
    provider: normProvider(ai.provider),
    modelFast: ai.modelFast ?? '',
    modelSmart: ai.modelSmart ?? '',
    baseUrl: ai.baseUrl ?? '',
    hasKey: Boolean(ai.keyCiphertext && ai.keyNonce),
    autoJournalAi: ai.autoJournalAi === true,
  }
}

/** Whether journals are auto-summarised & tagged on submit (background AI). */
export async function getTenantAutoJournalAi(ctx: RequestContext): Promise<boolean> {
  const { ai } = await readAi(ctx.tenantId)
  return ai.enabled !== false && ai.autoJournalAi === true
}

/** Runtime config (decrypted key) for AI calls, or null when disabled/unset. */
export async function getTenantAiConfig(ctx: RequestContext): Promise<AiConfig | null> {
  const { ai, orgName } = await readAi(ctx.tenantId)
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
    // Org identity travels with the config so every AI call (policies, journal
    // writing, Builder/Insights generation) can ground content in the real org
    // name instead of [PLACEHOLDER]. See orgContextLine in @beaconhs/ai.
    org: orgName ? { name: orgName } : null,
  }
}

/** Persist settings. apiKey is sealed when provided; omit it to keep the existing key. */
export async function saveTenantAiSettings(
  ctx: RequestContext,
  input: {
    enabled: boolean
    provider: AiProvider
    modelFast: string
    modelSmart: string
    baseUrl: string
    apiKey?: string
    autoJournalAi: boolean
  },
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

    const next: RawAi = {
      enabled: input.enabled,
      provider: input.provider,
      modelFast: input.modelFast || undefined,
      modelSmart: input.modelSmart || undefined,
      baseUrl: input.baseUrl || undefined,
      keyCiphertext: prev.keyCiphertext,
      keyNonce: prev.keyNonce,
      autoJournalAi: input.autoJournalAi,
    }
    if (input.apiKey && input.apiKey.trim()) {
      const sealed = encryptSecret(input.apiKey.trim())
      next.keyCiphertext = sealed.ciphertext
      next.keyNonce = sealed.nonce
    }
    await tx
      .update(tenants)
      .set({ settings: { ...settings, ai: next } })
      .where(eq(tenants.id, ctx.tenantId))
  })
}

/** Clear the stored API key (and disable). */
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
