// Resolve the effective SMS transport for a send, applying the platform →
// tenant policy. The decision logic itself is the pure
// `resolveEffectiveSmsTransport` in @beaconhs/sms; this module only fetches the
// two stored configs (platform singleton + the tenant's settings.sms) from the
// database. The platform row is read for every job so kill-switch and policy
// changes take effect immediately.
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

async function readPlatformSms(): Promise<PlatformSmsConfig | null> {
  return withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({ sms: platformSettings.sms })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
    const raw = row?.sms
    return raw && typeof raw === 'object' ? (raw as PlatformSmsConfig) : null
  })
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
