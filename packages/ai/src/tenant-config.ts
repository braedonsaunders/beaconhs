// Server-only tenant AI resolution shared by the web app and the worker.
//
// Applies the platform → tenant policy (tenant_optional / global_only /
// disabled), unseals the stored key, enforces the tenant's optional monthly
// token budget, and attaches a usage sink so every model call made with the
// resolved config is metered into ai_usage_events.

import { and, eq, gte, sql } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { aiUsageEvents, platformSettings, PLATFORM_SETTINGS_ID, tenants } from '@beaconhs/db/schema'
import { unsealSecret } from '@beaconhs/crypto'
import { isAiProvider, type AiConfig, type AiPolicyMode, type AiProvider } from './client'
import type { AiUsageSink } from './metering'

/** The stored (sealed) AI settings shape in tenants.settings.ai / platform_settings.ai. */
export type StoredAiSettings = {
  enabled?: boolean
  provider?: string
  modelFast?: string
  modelSmart?: string
  baseUrl?: string
  keyCiphertext?: string
  keyNonce?: string
  /** Auto-summarise & categorise journal entries on submit. Tenant-only. */
  autoJournalAi?: boolean
  /** Optional cap on input + output tokens per calendar month (UTC). Tenant-only. */
  monthlyTokenBudget?: number
}

export type StoredPlatformAiSettings = StoredAiSettings & { mode?: AiPolicyMode }

export type TenantAiResolution = {
  config: AiConfig | null
  /** Why `config` is null, when it is. */
  reason: 'disabled' | 'unconfigured' | 'budget_reached' | null
  budget: { limit: number | null; used: number; resetsAt: Date }
}

function normProvider(p: string | undefined): AiProvider {
  return isAiProvider(p) ? p : 'anthropic'
}

function asStored<T>(raw: unknown): T {
  return (raw && typeof raw === 'object' ? raw : {}) as T
}

/** Runtime config (decrypted key) from stored settings, or null when unusable. */
export function buildAiConfig(ai: StoredAiSettings, org: { name: string } | null): AiConfig | null {
  if (ai.enabled === false) return null
  if (!ai.keyCiphertext || !ai.keyNonce) return null
  const apiKey = unsealSecret({ ciphertext: ai.keyCiphertext, nonce: ai.keyNonce })
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

export async function readStoredAiSettings(tenantId: string): Promise<{
  tenant: StoredAiSettings
  platform: StoredPlatformAiSettings
  orgName: string | null
}> {
  return withSuperAdmin(db, async (tx) => {
    const [tenant] = await tx
      .select({ settings: tenants.settings, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    const [platform] = await tx
      .select({ ai: platformSettings.ai })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
    return {
      tenant: asStored<StoredAiSettings>(
        (tenant?.settings as Record<string, unknown> | undefined)?.ai,
      ),
      platform: asStored<StoredPlatformAiSettings>(platform?.ai),
      orgName: tenant?.name ?? null,
    }
  })
}

/** First instant of the next calendar month (UTC) — when a monthly budget resets. */
export function monthBounds(now = new Date()): { start: Date; resetsAt: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { start, resetsAt }
}

/** Input + output tokens metered for the tenant this calendar month. */
export async function monthTokenUsage(tenantId: string, now = new Date()): Promise<number> {
  const { start } = monthBounds(now)
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        total: sql<string>`coalesce(sum(${aiUsageEvents.inputTokens} + ${aiUsageEvents.outputTokens}), 0)`,
      })
      .from(aiUsageEvents)
      .where(and(eq(aiUsageEvents.tenantId, tenantId), gte(aiUsageEvents.createdAt, start))),
  )
  return Number(row?.total ?? 0)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A sink that records each model call against the tenant (and member, if any). */
export function tenantAiUsageSink(tenantId: string, tenantUserId: string | null): AiUsageSink {
  const member = tenantUserId && UUID.test(tenantUserId) ? tenantUserId : null
  return (event) => {
    void withTenant(db, tenantId, (tx) =>
      tx.insert(aiUsageEvents).values({
        tenantId,
        feature: event.feature.slice(0, 80),
        tier: event.tier,
        provider: event.provider,
        model: event.model.slice(0, 200),
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        latencyMs: event.latencyMs,
        outcome: event.outcome,
        error: event.error,
        tenantUserId: member,
      }),
    ).catch((error: unknown) => {
      console.warn('[ai] usage metering failed:', error instanceof Error ? error.message : error)
    })
  }
}

/**
 * Resolve the AI config every tenant consumer uses:
 *   disabled        → null (platform kill switch)
 *   global_only     → the platform provider (tenant settings ignored)
 *   tenant_optional → the tenant provider, else the platform default, else null
 * A reached monthly budget also yields null. The tenant org name travels with
 * the config for prompt grounding; calls are metered against the tenant.
 */
export async function resolveTenantAi(
  tenantId: string,
  opts: { tenantUserId?: string | null; now?: Date } = {},
): Promise<TenantAiResolution> {
  const now = opts.now ?? new Date()
  const { tenant, platform, orgName } = await readStoredAiSettings(tenantId)
  const limit =
    typeof tenant.monthlyTokenBudget === 'number' && tenant.monthlyTokenBudget > 0
      ? Math.floor(tenant.monthlyTokenBudget)
      : null
  const { resetsAt } = monthBounds(now)
  const used = limit === null ? 0 : await monthTokenUsage(tenantId, now)
  const budget = { limit, used, resetsAt }

  const mode: AiPolicyMode = platform.mode ?? 'tenant_optional'
  if (mode === 'disabled') return { config: null, reason: 'disabled', budget }
  const org = orgName ? { name: orgName } : null
  const config =
    (mode !== 'global_only' ? buildAiConfig(tenant, org) : null) ?? buildAiConfig(platform, org)
  if (!config) return { config: null, reason: 'unconfigured', budget }
  if (limit !== null && used >= limit) return { config: null, reason: 'budget_reached', budget }
  return {
    config: { ...config, usage: tenantAiUsageSink(tenantId, opts.tenantUserId ?? null) },
    reason: null,
    budget,
  }
}
