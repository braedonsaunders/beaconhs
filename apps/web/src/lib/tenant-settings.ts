import 'server-only'

import { eq, sql } from 'drizzle-orm'
import { tenants } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

function encodeSetting(value: unknown): string {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('Tenant setting must be JSON-serializable')
  return encoded
}

/** Atomically replace one top-level tenant setting without overwriting peers. */
export async function setTenantSetting(
  ctx: RequestContext,
  key: string,
  value: unknown,
): Promise<void> {
  if (!key) throw new Error('Tenant setting key is required')
  const encoded = encodeSetting(value)
  await ctx.db((tx) =>
    tx
      .update(tenants)
      .set({
        settings: sql`jsonb_set(coalesce(${tenants.settings}, '{}'::jsonb), ARRAY[${key}]::text[], ${encoded}::jsonb, true)`,
      })
      .where(eq(tenants.id, ctx.tenantId)),
  )
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
