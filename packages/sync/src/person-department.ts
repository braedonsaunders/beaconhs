import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { normalizeCatalogDisplayName, normalizedCatalogNameSql, type Database } from '@beaconhs/db'
import { departments } from '@beaconhs/db/schema'
import type { SyncLogger } from './types'

/** Resolve source names against the same tenant catalogue used by scopes and People. */
export async function resolvePersonDepartment(
  tx: Database,
  ctx: { tenantId: string; dryRun?: boolean; log: SyncLogger },
  sourceName: string | null | undefined,
): Promise<string | null> {
  const name = normalizeCatalogDisplayName(sourceName)
  if (!name) return null
  const find = async () => {
    const query = tx
      .select({ id: departments.id })
      .from(departments)
      .where(
        and(
          eq(departments.tenantId, ctx.tenantId),
          eq(normalizedCatalogNameSql(departments.name), normalizedCatalogNameSql(sql`${name}`)),
        ),
      )
      .limit(1)
    const [row] = await (ctx.dryRun ? query : query.for('key share'))
    return row
  }
  const existing = await find()
  if (existing) return existing.id
  if (ctx.dryRun) {
    ctx.log('info', `Would create department "${name}".`)
    return randomUUID()
  }
  const [created] = await tx
    .insert(departments)
    .values({ tenantId: ctx.tenantId, name })
    .onConflictDoNothing()
    .returning({ id: departments.id })
  const resolved = created ?? (await find())
  if (!resolved) throw new Error(`Could not resolve source department "${name}".`)
  // Never cache an uncommitted id: this record's savepoint can still roll back.
  return resolved.id
}
