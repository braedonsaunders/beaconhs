import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import { correctiveActions, orgUnits } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireExportContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { parseListParams, pickString } from '@/lib/list-params'
import { moduleScopeWhere } from '@/lib/visibility'

export const dynamic = 'force-dynamic'

const SORTS = [
  'reference',
  'title',
  'severity',
  'status',
  'due_on',
  'assigned_on',
  'created_at',
  'site',
] as const

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const params = parseListParams(sp, {
    sort: 'created_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  // Mirror the list page: default to open, `status=all` shows every status.
  const statusRaw = pickString(sp.status) ?? 'open'
  const statusFilter = statusRaw === 'all' ? undefined : statusRaw
  const sevFilter = pickString(sp.severity)
  const ctx = await requireExportContext()

  // Require a read tier and scope rows to it (mirrors the /corrective-actions
  // list page): all → everything, site → my sites, self → actions I own.
  if (!can(ctx, 'ca.read.all') && !can(ctx, 'ca.read.site') && !can(ctx, 'ca.read.self')) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const rows = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'ca',
      ownerCols: [correctiveActions.ownerTenantUserId],
      siteCol: correctiveActions.siteOrgUnitId,
    })
    if (vis) filters.push(vis)
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(correctiveActions.reference, term),
        ilike(correctiveActions.title, term),
        ilike(correctiveActions.description, term),
      )
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(correctiveActions.status, statusFilter as any))
    if (sevFilter) filters.push(eq(correctiveActions.severity, sevFilter as any))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const dirFn = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'reference'
        ? [dirFn(correctiveActions.reference)]
        : params.sort === 'title'
          ? [dirFn(correctiveActions.title)]
          : params.sort === 'severity'
            ? [dirFn(correctiveActions.severity)]
            : params.sort === 'status'
              ? [dirFn(correctiveActions.status)]
              : params.sort === 'due_on'
                ? [dirFn(correctiveActions.dueOn)]
                : params.sort === 'assigned_on'
                  ? [dirFn(correctiveActions.assignedOn)]
                  : params.sort === 'site'
                    ? [dirFn(orgUnits.name)]
                    : [dirFn(correctiveActions.createdAt)]

    return tx
      .select({ ca: correctiveActions, site: orgUnits })
      .from(correctiveActions)
      .leftJoin(orgUnits, eq(orgUnits.id, correctiveActions.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(10_000)
  })

  await recordAudit(ctx, {
    entityType: 'corrective_action',
    action: 'export',
    summary: `Exported ${rows.length} corrective actions to CSV`,
    metadata: {
      format: 'csv',
      filters: { q: params.q ?? null, status: statusFilter ?? null, severity: sevFilter ?? null },
    },
  })

  return csvResponse({
    filename: csvFilename('corrective-actions'),
    headers: [
      'Reference',
      'Title',
      'Severity',
      'Status',
      'Assigned on',
      'Due on',
      'Closed on',
      'Site',
      'Description',
    ],
    rows: rows.map(({ ca, site }) => [
      ca.reference,
      ca.title,
      ca.severity,
      ca.status,
      ca.assignedOn ?? '',
      ca.dueOn ?? '',
      ca.closedAt ? new Date(ca.closedAt).toISOString() : '',
      site?.name ?? '',
      ca.description ?? '',
    ]),
  })
}
