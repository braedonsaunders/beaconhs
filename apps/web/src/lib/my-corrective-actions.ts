import { and, asc, count, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { correctiveActions } from '@beaconhs/db/schema'

// The one definition of "corrective actions still on my plate", shared by
// /my, /my/tasks, the dashboard My Compliance widget, and /compliance/mine.
// Anything not closed/cancelled counts as open.

export const OPEN_CA_STATUSES = ['open', 'in_progress', 'pending_verification'] as const

export type MyCorrectiveActionItem = {
  id: string
  reference: string
  title: string
  severity: string
  status: string
  dueOn: string | null
}

export type MyCorrectiveActionsSummary = {
  total: number
  overdue: number
  /** Due today or within the next 7 days (not yet overdue). */
  dueSoon: number
  items: MyCorrectiveActionItem[]
}

export function myOpenCorrectiveActionsWhere(membershipId: string): SQL<unknown> {
  return and(
    eq(correctiveActions.ownerTenantUserId, membershipId),
    isNull(correctiveActions.deletedAt),
    inArray(correctiveActions.status, [...OPEN_CA_STATUSES]),
  ) as SQL<unknown>
}

/** Calendar-day arithmetic on a YYYY-MM-DD date (timezone-free by design). */
function shiftIsoDate(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T00:00:00.000Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

export const EMPTY_MY_CORRECTIVE_ACTIONS: MyCorrectiveActionsSummary = {
  total: 0,
  overdue: 0,
  dueSoon: 0,
  items: [],
}

/**
 * Open corrective actions assigned to one membership: totals plus the next
 * few by due date. `todayIso` must be today on the tenant's calendar
 * (see dateIsoInTimeZone in @/lib/datetime) — never the server's UTC date.
 */
export async function loadMyOpenCorrectiveActions(
  tx: Database,
  membershipId: string | null | undefined,
  todayIso: string,
  limit = 5,
): Promise<MyCorrectiveActionsSummary> {
  if (!membershipId) return EMPTY_MY_CORRECTIVE_ACTIONS
  const where = myOpenCorrectiveActionsWhere(membershipId)
  const dueSoonEnd = shiftIsoDate(todayIso, 7)
  const [summary] = await tx
    .select({
      total: count(),
      overdue: sql<number>`count(*) filter (where ${correctiveActions.dueOn} < ${todayIso})::int`,
      dueSoon: sql<number>`count(*) filter (where ${correctiveActions.dueOn} >= ${todayIso} and ${correctiveActions.dueOn} <= ${dueSoonEnd})::int`,
    })
    .from(correctiveActions)
    .where(where)
  const rows = await tx
    .select({
      id: correctiveActions.id,
      reference: correctiveActions.reference,
      title: correctiveActions.title,
      severity: correctiveActions.severity,
      status: correctiveActions.status,
      dueOn: correctiveActions.dueOn,
    })
    .from(correctiveActions)
    .where(where)
    .orderBy(sql`${correctiveActions.dueOn} asc nulls last`, asc(correctiveActions.createdAt))
    .limit(limit)
  return {
    total: Number(summary?.total ?? 0),
    overdue: Number(summary?.overdue ?? 0),
    dueSoon: Number(summary?.dueSoon ?? 0),
    items: rows.map((row) => ({ ...row, dueOn: row.dueOn ? String(row.dueOn) : null })),
  }
}
