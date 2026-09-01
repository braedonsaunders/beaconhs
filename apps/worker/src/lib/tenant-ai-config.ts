// Worker-side tenant AI resolver. Mirrors apps/web/src/lib/ai-config.ts so the
// worker can unseal the same stored keys (same BETTER_AUTH_SECRET) and honour
// the platform policy without importing the web app.

import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { platformSettings, PLATFORM_SETTINGS_ID, tenants } from '@beaconhs/db/schema'
import { unsealSecret } from '@beaconhs/crypto'
import { isAiProvider, type AiConfig, type AiPolicyMode, type AiProvider } from '@beaconhs/ai'

type RawAi = {
  enabled?: boolean
  provider?: string
  modelFast?: string
  modelSmart?: string
  baseUrl?: string
  keyCiphertext?: string
  keyNonce?: string
  autoJournalAi?: boolean
  autoJournalAnalysis?: boolean
}

function normProvider(p: string | undefined): AiProvider {
  return isAiProvider(p) ? p : 'anthropic'
}

function buildConfig(ai: RawAi, org: { name: string } | null): AiConfig | null {
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

export async function resolveTenantAiConfig(tenantId: string): Promise<AiConfig | null> {
  const [{ ai: tenantAi, orgName }, platformAi] = await withSuperAdmin(db, async (tx) => {
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
    const rawTenant = (tenant?.settings as Record<string, unknown> | undefined)?.ai
    return [
      {
        ai: (rawTenant && typeof rawTenant === 'object' ? rawTenant : {}) as RawAi,
        orgName: tenant?.name ?? null,
      },
      (platform?.ai && typeof platform.ai === 'object' ? platform.ai : {}) as RawAi & {
        mode?: AiPolicyMode
      },
    ] as const
  })

  const mode: AiPolicyMode = platformAi.mode ?? 'tenant_optional'
  if (mode === 'disabled') return null
  const org = orgName ? { name: orgName } : null
  if (mode !== 'global_only') {
    const tenantConfig = buildConfig(tenantAi, org)
    if (tenantConfig) return tenantConfig
  }
  return buildConfig(platformAi, org)
}

export async function tenantWantsAutomaticJournalAnalysis(tenantId: string): Promise<boolean> {
  return withSuperAdmin(db, async (tx) => {
    const [tenant] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    const raw = (tenant?.settings as Record<string, unknown> | undefined)?.ai
    const ai = (raw && typeof raw === 'object' ? raw : {}) as RawAi
    if (ai.enabled === false) return false
    return ai.autoJournalAnalysis !== false
  })
}
