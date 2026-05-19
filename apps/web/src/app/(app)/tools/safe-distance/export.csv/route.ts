import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import { orgUnits, safeDistanceRecords } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { parseListParams, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

const SORTS = ['reference', 'occurred_at', 'type', 'complies'] as const

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const params = parseListParams(sp, {
    sort: 'occurred_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const typeFilter = pickString(sp.type)
  const compliesFilter = pickString(sp.complies)
  const siteFilter = pickString(sp.site)
  const ctx = await requireRequestContext()

  const rows = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(safeDistanceRecords.reference, term),
        ilike(safeDistanceRecords.sourceDescription, term),
        ilike(safeDistanceRecords.notes, term),
      )
      if (cond) filters.push(cond)
    }
    if (typeFilter) filters.push(eq(safeDistanceRecords.type, typeFilter as any))
    if (compliesFilter === 'yes') filters.push(eq(safeDistanceRecords.complies, true))
    if (compliesFilter === 'no') filters.push(eq(safeDistanceRecords.complies, false))
    if (siteFilter) filters.push(eq(safeDistanceRecords.siteOrgUnitId, siteFilter))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'reference'
        ? [params.dir === 'asc' ? asc(safeDistanceRecords.reference) : desc(safeDistanceRecords.reference)]
        : params.sort === 'type'
          ? [params.dir === 'asc' ? asc(safeDistanceRecords.type) : desc(safeDistanceRecords.type)]
          : params.sort === 'complies'
            ? [params.dir === 'asc' ? asc(safeDistanceRecords.complies) : desc(safeDistanceRecords.complies)]
            : [params.dir === 'asc' ? asc(safeDistanceRecords.occurredAt) : desc(safeDistanceRecords.occurredAt)]

    return tx
      .select({ rec: safeDistanceRecords, site: orgUnits })
      .from(safeDistanceRecords)
      .leftJoin(orgUnits, eq(orgUnits.id, safeDistanceRecords.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(10_000)
  })

  await recordAudit(ctx, {
    entityType: 'safe_distance_record',
    action: 'export',
    summary: `Exported ${rows.length} safe-distance records to CSV`,
    metadata: {
      format: 'csv',
      filters: {
        q: params.q ?? null,
        type: typeFilter ?? null,
        complies: compliesFilter ?? null,
        site: siteFilter ?? null,
      },
    },
  })

  return csvResponse({
    filename: csvFilename('safe-distance'),
    headers: [
      'Reference',
      'Occurred at',
      'Type',
      'Source description',
      'Source voltage (kV)',
      'Height (m)',
      'Required (m)',
      'Actual (m)',
      'Compliant',
      'Site',
      'Locked',
      'Notes',
    ],
    rows: rows.map(({ rec, site }) => [
      rec.reference,
      rec.occurredAt ? new Date(rec.occurredAt).toISOString() : '',
      rec.type,
      rec.sourceDescription ?? '',
      rec.sourceVoltageKv ?? '',
      rec.heightM ?? '',
      rec.requiredDistanceM ?? '',
      rec.actualDistanceM ?? '',
      rec.complies ? 'Yes' : 'No',
      site?.name ?? '',
      rec.locked ? 'Yes' : 'No',
      rec.notes ?? '',
    ]),
  })
}
