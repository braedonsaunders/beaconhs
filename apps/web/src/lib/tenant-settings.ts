import 'server-only'

import { eq, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

function encodeSetting(value: unknown): string {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('Tenant setting must be JSON-serializable')
  return encoded
}

/** Replace one top-level tenant setting inside an existing transaction. */
export async function setTenantSettingInTransaction(
  tx: Database,
  tenantId: string,
  key: string,
  value: unknown,
): Promise<void> {
  if (!key) throw new Error('Tenant setting key is required')
  const encoded = encodeSetting(value)
  const [updated] = await tx
    .update(tenants)
    .set({
      settings: sql`jsonb_set(coalesce(${tenants.settings}, '{}'::jsonb), ARRAY[${key}]::text[], ${encoded}::jsonb, true)`,
    })
    .where(eq(tenants.id, tenantId))
    .returning({ id: tenants.id })
  if (!updated) throw new Error('Tenant setting workspace was not found')
}

/** Atomically replace one top-level tenant setting without overwriting peers. */
export async function setTenantSetting(
  ctx: RequestContext,
  key: string,
  value: unknown,
): Promise<void> {
  await ctx.db((tx) => setTenantSettingInTransaction(tx, ctx.tenantId, key, value))
}

/** Atomically remove one top-level tenant setting without overwriting peers. */
export async function deleteTenantSetting(ctx: RequestContext, key: string): Promise<void> {
  if (!key) throw new Error('Tenant setting key is required')
  await ctx.db((tx) =>
    tx
      .update(tenants)
      .set({ settings: sql`coalesce(${tenants.settings}, '{}'::jsonb) - ${key}` })
      .where(eq(tenants.id, ctx.tenantId)),
  )
}
