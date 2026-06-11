import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, type SQL } from 'drizzle-orm'
import { lwSessions, orgUnits, tenantUsers, user } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { parseListParams, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

const SORTS = ['started_at', 'next_checkin_due_at', 'status'] as const

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const params = parseListParams(sp, {
    sort: 'started_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const ctx = await requireRequestContext()

  const rows = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (statusFilter) filters.push(eq(lwSessions.status, statusFilter as any))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'next_checkin_due_at'
        ? [
            params.dir === 'asc'
              ? asc(lwSessions.nextCheckinDueAt)
              : desc(lwSessions.nextCheckinDueAt),
          ]
        : params.sort === 'status'
          ? [params.dir === 'asc' ? asc(lwSessions.status) : desc(lwSessions.status)]
          : [params.dir === 'asc' ? asc(lwSessions.startedAt) : desc(lwSessions.startedAt)]

    return tx
      .select({
        session: lwSessions,
        site: orgUnits,
        worker: tenantUsers,
        workerAccount: user,
      })
      .from(lwSessions)
      .leftJoin(orgUnits, eq(orgUnits.id, lwSessions.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, lwSessions.workerTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(10_000)
  })

  await recordAudit(ctx, {
    entityType: 'lw_session',
    action: 'export',
    summary: `Exported ${rows.length} lone-worker sessions to CSV`,
    metadata: { format: 'csv', filters: { status: statusFilter ?? null } },
  })

  return csvResponse({
    filename: csvFilename('lone-worker-sessions'),
    headers: ['Worker', 'Site', 'Task', 'Status', 'Started', 'Next check-in due', 'Ended'],
    rows: rows.map(({ session, site, workerAccount }) => [
      workerAccount?.name ?? '',
      site?.name ?? '',
      session.task ?? '',
      session.status,
      new Date(session.startedAt).toISOString(),
      new Date(session.nextCheckinDueAt).toISOString(),
      session.endedAt ? new Date(session.endedAt).toISOString() : '',
    ]),
  })
}
