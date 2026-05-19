import type { NextRequest } from 'next/server'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import {
  orgUnits,
  tenantUsers,
  toolboxJournalAttendees,
  toolboxJournals,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { parseListParams, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

const SORTS = ['reference', 'occurred_on', 'title', 'status'] as const

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const params = parseListParams(sp, {
    sort: 'occurred_on',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const fromFilter = pickString(sp.from)
  const toFilter = pickString(sp.to)
  const foremanFilter = pickString(sp.foreman)
  const siteFilter = pickString(sp.site)
  const ctx = await requireRequestContext()

  const { rows, attendeeCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(toolboxJournals.reference, term),
        ilike(toolboxJournals.title, term),
        ilike(toolboxJournals.topic, term),
        ilike(toolboxJournals.discussionNotes, term),
      )
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(toolboxJournals.status, statusFilter as any))
    if (fromFilter) filters.push(gte(toolboxJournals.occurredOn, fromFilter))
    if (toFilter) filters.push(lte(toolboxJournals.occurredOn, toFilter))
    if (foremanFilter) filters.push(eq(toolboxJournals.foremanTenantUserId, foremanFilter))
    if (siteFilter) filters.push(eq(toolboxJournals.siteOrgUnitId, siteFilter))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'reference'
        ? [
            params.dir === 'asc'
              ? asc(toolboxJournals.reference)
              : desc(toolboxJournals.reference),
          ]
        : params.sort === 'title'
          ? [params.dir === 'asc' ? asc(toolboxJournals.title) : desc(toolboxJournals.title)]
          : params.sort === 'status'
            ? [params.dir === 'asc' ? asc(toolboxJournals.status) : desc(toolboxJournals.status)]
            : [
                params.dir === 'asc'
                  ? asc(toolboxJournals.occurredOn)
                  : desc(toolboxJournals.occurredOn),
              ]

    const data = await tx
      .select({
        j: toolboxJournals,
        site: orgUnits,
        foremanMembership: tenantUsers,
        foremanUser: user,
      })
      .from(toolboxJournals)
      .leftJoin(orgUnits, eq(orgUnits.id, toolboxJournals.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, toolboxJournals.foremanTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(10_000)

    const journalIds = data.map((d) => d.j.id)
    let counts: Record<string, number> = {}
    if (journalIds.length > 0) {
      const rows = await tx
        .select({
          journalId: toolboxJournalAttendees.journalId,
          c: count(),
        })
        .from(toolboxJournalAttendees)
        .where(sql`${toolboxJournalAttendees.journalId} = ANY(${journalIds})`)
        .groupBy(toolboxJournalAttendees.journalId)
      counts = Object.fromEntries(rows.map((r) => [r.journalId, Number(r.c)]))
    }
    return { rows: data, attendeeCounts: counts }
  })

  await recordAudit(ctx, {
    entityType: 'toolbox_journal',
    action: 'export',
    summary: `Exported ${rows.length} toolbox talks to CSV`,
    metadata: {
      format: 'csv',
      filters: {
        q: params.q ?? null,
        status: statusFilter ?? null,
        from: fromFilter ?? null,
        to: toFilter ?? null,
        foreman: foremanFilter ?? null,
        site: siteFilter ?? null,
      },
    },
  })

  return csvResponse({
    filename: csvFilename('toolbox-talks'),
    headers: [
      'Reference',
      'Date',
      'Title',
      'Topic',
      'Site',
      'Foreman',
      'Status',
      'Attendees',
      'Locked',
    ],
    rows: rows.map(({ j, site, foremanMembership, foremanUser }) => [
      j.reference,
      j.occurredOn,
      j.title,
      j.topic ?? '',
      site?.name ?? '',
      foremanUser?.name ?? foremanMembership?.displayName ?? '',
      j.status,
      String(attendeeCounts[j.id] ?? 0),
      j.locked ? 'yes' : 'no',
    ]),
  })
}
