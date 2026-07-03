import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
import { incidents, orgUnits } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireExportContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { csvColumns, selectCsvColumns } from '@/lib/export-columns'
import { parseListParams, pickString } from '@/lib/list-params'
import { moduleScopeWhere } from '@/lib/visibility'

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
  const ctx = await requireExportContext()

  // Require a read tier and scope rows to it (mirrors the /incidents list page):
  // all → everything, site → my sites, self → incidents I reported.
  if (
    !can(ctx, 'incidents.read.all') &&
    !can(ctx, 'incidents.read.site') &&
    !can(ctx, 'incidents.read.self')
  ) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const rows = await ctx.db(async (tx) => {
    // Mirror the /incidents list page: archived (soft-deleted) rows never export.
    const filters: SQL<unknown>[] = [isNull(incidents.deletedAt)]
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'incidents',
      ownerCols: [incidents.reportedByTenantUserId],
      siteCol: incidents.siteOrgUnitId,
    })
    if (vis) filters.push(vis)
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

  const columns = csvColumns([
    'Reference',
    'Occurred',
    'Type',
    'Severity',
    'Status',
    'Title',
    'Site',
    'Description',
    'Location',
  ])
  const selection = selectCsvColumns(url.searchParams, columns)

  return csvResponse({
    filename: csvFilename('incidents'),
    headers: selection.headers,
    rows: rows.map(({ incident, site }) =>
      selection.project([
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
    ),
  })
}
