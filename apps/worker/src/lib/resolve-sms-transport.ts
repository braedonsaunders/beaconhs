// Resolve the effective SMS transport for a send, applying the platform →
// tenant → environment policy. The decision logic itself is the pure
// `resolveEffectiveSmsTransport` in @beaconhs/sms; this module only fetches the
// two stored configs (platform singleton + the tenant's settings.sms) from the
// database. The platform row is cached briefly since it changes rarely.
// Mirrors ./resolve-email-transport.

import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { platformSettings, PLATFORM_SETTINGS_ID, tenants } from '@beaconhs/db/schema'
import {
  resolveEffectiveSmsTransport,
  type EffectiveSms,
  type PlatformSmsConfig,
  type RawSmsConfig,
} from '@beaconhs/sms'

let platformCache: { value: PlatformSmsConfig | null; at: number } | null = null
const PLATFORM_TTL_MS = 30_000

async function readPlatformSms(): Promise<PlatformSmsConfig | null> {
  const now = Date.now()
  if (platformCache && now - platformCache.at < PLATFORM_TTL_MS) return platformCache.value
  const value = await withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({ sms: platformSettings.sms })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
    const raw = row?.sms
    return raw && typeof raw === 'object' ? (raw as PlatformSmsConfig) : null
  })
  platformCache = { value, at: now }
  return value
}

async function readTenantSms(tenantId: string): Promise<RawSmsConfig | null> {
  return withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    const raw = (row?.settings as Record<string, unknown> | undefined)?.sms
    return raw && typeof raw === 'object' ? (raw as RawSmsConfig) : null
  })
}

/** Decide how (and whether) to send an SMS for a given tenant (null = platform send). */
export async function resolveSmsDelivery(tenantId: string | null): Promise<EffectiveSms> {
  const platform = await readPlatformSms()
  const tenant = tenantId ? await readTenantSms(tenantId) : null
  return resolveEffectiveSmsTransport(platform, tenant, { tenantScoped: Boolean(tenantId) })
}

/** Test seam: drop the cached platform row (used after a config save in-process). */
function clearPlatformSmsCache(): void {
  platformCache = null
}
