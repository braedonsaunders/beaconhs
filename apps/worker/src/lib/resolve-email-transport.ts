// Resolve the effective email transport for a send, applying the platform →
// tenant policy. The decision logic itself is the pure
// `resolveEffectiveTransport` in @beaconhs/emails; this module only fetches the
// two stored configs (platform singleton + the tenant's settings.email) from the
// database. The platform policy is read for every job so the global kill switch
// takes effect immediately.

import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { platformSettings, PLATFORM_SETTINGS_ID, tenants } from '@beaconhs/db/schema'
import {
  resolveEffectiveTransport,
  type EffectiveEmail,
  type EmailTransport,
  type PlatformEmailConfig,
  type RawEmailConfig,
} from '@beaconhs/emails'

async function readPlatformEmail(): Promise<PlatformEmailConfig | null> {
  return withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({ email: platformSettings.email })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
    const raw = row?.email
    return raw && typeof raw === 'object' ? (raw as PlatformEmailConfig) : null
  })
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

/** Production sends must resolve through the database-managed provider system. */
export function requireEmailTransport(delivery: EffectiveEmail): EmailTransport {
  if (delivery.kind === 'transport') return delivery.transport
  if (delivery.kind === 'suppressed') {
    throw new Error('Email delivery is disabled by the platform administrator.')
  }
  throw new Error(
    'Email delivery is not configured: configure an enabled platform or tenant provider.',
  )
}
