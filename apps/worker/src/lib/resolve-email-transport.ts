// Resolve the effective email transport for a send, applying the platform →
// tenant → environment policy. The decision logic itself is the pure
// `resolveEffectiveTransport` in @beaconhs/emails; this module only fetches the
// two stored configs (platform singleton + the tenant's settings.email) from the
// database. The platform row is cached briefly since it changes rarely.

import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { platformSettings, PLATFORM_SETTINGS_ID, tenants } from '@beaconhs/db/schema'
import {
  resolveEffectiveTransport,
  type EffectiveEmail,
  type PlatformEmailConfig,
  type RawEmailConfig,
} from '@beaconhs/emails'

let platformCache: { value: PlatformEmailConfig | null; at: number } | null = null
const PLATFORM_TTL_MS = 30_000

async function readPlatformEmail(): Promise<PlatformEmailConfig | null> {
  const now = Date.now()
  if (platformCache && now - platformCache.at < PLATFORM_TTL_MS) return platformCache.value
  const value = await withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({ email: platformSettings.email })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
    const raw = row?.email
    return raw && typeof raw === 'object' ? (raw as PlatformEmailConfig) : null
  })
  platformCache = { value, at: now }
  return value
}

async function readTenantEmail(tenantId: string): Promise<RawEmailConfig | null> {
  return withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    const raw = (row?.settings as Record<string, unknown> | undefined)?.email
    return raw && typeof raw === 'object' ? (raw as RawEmailConfig) : null
  })
}

/** Decide how (and whether) to send an email for a given tenant (null = platform send). */
export async function resolveEmailDelivery(tenantId: string | null): Promise<EffectiveEmail> {
  const platform = await readPlatformEmail()
  const tenant = tenantId ? await readTenantEmail(tenantId) : null
  return resolveEffectiveTransport(platform, tenant, { tenantScoped: Boolean(tenantId) })
}

/** Test seam: drop the cached platform row (used after a config save in-process). */
function clearPlatformEmailCache(): void {
  platformCache = null
}
