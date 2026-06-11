import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import { correctiveActions, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { parseListParams, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

const SORTS = ['reference', 'title', 'severity', 'status', 'due_on', 'assigned_on'] as const

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const params = parseListParams(sp, {
    sort: 'due_on',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const sevFilter = pickString(sp.severity)
  const ctx = await requireRequestContext()

  const rows = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
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

    const orderBy =
      params.sort === 'reference'
        ? [
            params.dir === 'asc'
              ? asc(correctiveActions.reference)
              : desc(correctiveActions.reference),
          ]
        : params.sort === 'title'
          ? [params.dir === 'asc' ? asc(correctiveActions.title) : desc(correctiveActions.title)]
          : params.sort === 'severity'
            ? [
                params.dir === 'asc'
                  ? asc(correctiveActions.severity)
                  : desc(correctiveActions.severity),
              ]
            : params.sort === 'status'
              ? [
                  params.dir === 'asc'
                    ? asc(correctiveActions.status)
                    : desc(correctiveActions.status),
                ]
              : params.sort === 'assigned_on'
                ? [
                    params.dir === 'asc'
                      ? asc(correctiveActions.assignedOn)
                      : desc(correctiveActions.assignedOn),
                  ]
                : [
                    params.dir === 'asc'
                      ? asc(correctiveActions.dueOn)
                      : desc(correctiveActions.dueOn),
                  ]

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
