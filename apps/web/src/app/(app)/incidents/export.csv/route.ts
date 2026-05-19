import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import { incidents, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { parseListParams, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

const SORTS = ['reference', 'occurred_at', 'severity', 'status', 'type'] as const

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
  const statusFilter = pickString(sp.status)
  const ctx = await requireRequestContext()

  const rows = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(incidents.reference, term),
        ilike(incidents.title, term),
        ilike(incidents.description, term),
      )
      if (cond) filters.push(cond)
    }
    if (typeFilter) filters.push(eq(incidents.type, typeFilter as any))
    if (statusFilter) filters.push(eq(incidents.status, statusFilter as any))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'reference'
        ? [params.dir === 'asc' ? asc(incidents.reference) : desc(incidents.reference)]
        : params.sort === 'severity'
          ? [params.dir === 'asc' ? asc(incidents.severity) : desc(incidents.severity)]
          : params.sort === 'status'
            ? [params.dir === 'asc' ? asc(incidents.status) : desc(incidents.status)]
            : params.sort === 'type'
              ? [params.dir === 'asc' ? asc(incidents.type) : desc(incidents.type)]
              : [params.dir === 'asc' ? asc(incidents.occurredAt) : desc(incidents.occurredAt)]

    return tx
      .select({ incident: incidents, site: orgUnits })
      .from(incidents)
      .leftJoin(orgUnits, eq(orgUnits.id, incidents.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(10_000)
  })

  await recordAudit(ctx, {
    entityType: 'incident',
    action: 'export',
    summary: `Exported ${rows.length} incidents to CSV`,
    metadata: {
      format: 'csv',
      filters: { q: params.q ?? null, type: typeFilter ?? null, status: statusFilter ?? null },
    },
  })

  return csvResponse({
    filename: csvFilename('incidents'),
    headers: [
      'Reference',
      'Occurred',
      'Type',
      'Severity',
      'Status',
      'Title',
      'Site',
      'Description',
      'Location',
    ],
    rows: rows.map(({ incident, site }) => [
      incident.reference,
      new Date(incident.occurredAt).toISOString(),
      incident.type,
      incident.severity,
      incident.status,
      incident.title,
      site?.name ?? '',
      incident.description ?? '',
      incident.location ?? '',
    ]),
  })
}
