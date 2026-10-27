import { eq } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { tenantNotificationPolicy, tenants } from '@beaconhs/db/schema'

/**
 * Whether this tenant records the customer each training class was delivered
 * for (`tenants.settings.training.trackClassCustomer`, off by default). When
 * on, the class form, list, calendar, and flow variables carry a Customer.
 */
export function trackClassCustomerFromSettings(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') return false
  const training = (settings as Record<string, unknown>).training
  if (!training || typeof training !== 'object') return false
  return (training as Record<string, unknown>).trackClassCustomer === true
}

/** Read the flag inside an existing transaction. */
export async function trackClassCustomerInTransaction(
  tx: Database,
  tenantId: string,
): Promise<boolean> {
  const [tenant] = await tx
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  return trackClassCustomerFromSettings(tenant?.settings)
}

/** Resolve the workspace's canonical class-day clock. Missing policy rows use
 * the schema's tenant default, UTC, rather than a viewer-specific timezone. */
export async function trainingClassTimeZone(tx: Database, tenantId: string): Promise<string> {
  const [policy] = await tx
    .select({ timezone: tenantNotificationPolicy.scanTimezone })
    .from(tenantNotificationPolicy)
    .where(eq(tenantNotificationPolicy.tenantId, tenantId))
    .limit(1)
  return policy?.timezone ?? 'UTC'
}
