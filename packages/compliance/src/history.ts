import { and, asc, desc, eq, gt, lte, ne, or, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { compliancePeriodSnapshots, auditLog, type CompliancePeriodRule } from '@beaconhs/db/schema'
import { type ResolvedMember } from './audience'
import { evaluateObligation, type ComplianceObligation, type EvalSubjectRow } from './evaluate'
import { resolveCronWindow, resolveFrequencyWindow, type ComplianceClock } from './schedule'

export const COMPLIANCE_HISTORY_LIMITS = [3, 6, 12, 24] as const

export function supportsComplianceHistory(
  ob: Pick<ComplianceObligation, 'recurrence' | 'sourceModule'>,
) {
  return (
    [
      'journal',
      'inspection',
      'hazard_assessment',
      'form',
      'document',
      'training',
      'cert_requirement',
      'skill_requirement',
    ].includes(ob.sourceModule) &&
    (ob.recurrence.kind === 'cron' ||
      (ob.recurrence.kind === 'frequency' &&
        Boolean(ob.recurrence.frequency) &&
        ob.recurrence.evidenceWindow !== 'rolling'))
  )
}

function periodWindow(ob: ComplianceObligation, clock: ComplianceClock) {
  if (!supportsComplianceHistory(ob)) return null
  if (ob.recurrence.kind === 'cron') {
    const window = resolveCronWindow(ob.recurrence, clock, ob.createdAt)
    if (!window.started) return null
    return { ...window, periodStartAt: window.scheduledAt }
  }
  return resolveFrequencyWindow(ob.recurrence, clock, ob.createdAt)
}

/** Retire only unfinished snapshots when an assignment is replaced or stopped. */
export async function discardOpenCompliancePeriods(
  tx: Database,
  tenantId: string,
  obligationId: string,
  now = new Date(),
) {
  await tx
    .delete(compliancePeriodSnapshots)
    .where(
      and(
        eq(compliancePeriodSnapshots.tenantId, tenantId),
        eq(compliancePeriodSnapshots.obligationId, obligationId),
        gt(compliancePeriodSnapshots.periodEndAt, now),
      ),
    )
}

/** Called under the obligation lock. Ended periods are never rewritten. */
export async function captureCompliancePeriod(
  tx: Database,
  tenantId: string,
  ob: ComplianceObligation,
  clock: ComplianceClock,
  members: ResolvedMember[],
  rows: EvalSubjectRow[],
) {
  const window = periodWindow(ob, clock)
  if (!window || window.periodEndAt <= clock.now || window.periodEndAt <= ob.createdAt) return
  await tx
    .delete(compliancePeriodSnapshots)
    .where(
      and(
        eq(compliancePeriodSnapshots.tenantId, tenantId),
        eq(compliancePeriodSnapshots.obligationId, ob.id),
        gt(compliancePeriodSnapshots.periodEndAt, clock.now),
        or(
          ne(compliancePeriodSnapshots.periodStartAt, window.periodStartAt),
          ne(compliancePeriodSnapshots.periodEndAt, window.periodEndAt),
        ),
      ),
    )
  const labels = new Map(rows.map((row) => [row.personId, row.label]))
  const rule: CompliancePeriodRule = {
    title: ob.title,
    workerType: ob.workerType,
    sourceModule: ob.sourceModule,
    subjectKind: ob.subjectKind,
    recurrence: ob.recurrence,
    targetRef: ob.targetRef,
    createdAt: ob.createdAt.toISOString(),
    members: members
      .map((member) => ({
        ...member,
        label: labels.get(member.personId) ?? '(unnamed)',
      }))
      .sort((a, b) => a.personId.localeCompare(b.personId)),
  }
  await tx
    .insert(compliancePeriodSnapshots)
    .values({
      tenantId,
      obligationId: ob.id,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      periodStartAt: window.periodStartAt,
      periodEndAt: window.periodEndAt,
      dueAt: window.dueAt,
      timezone: clock.timezone,
      rule,
      recordedAt: clock.now,
    })
    .onConflictDoUpdate({
      target: [
        compliancePeriodSnapshots.tenantId,
        compliancePeriodSnapshots.obligationId,
        compliancePeriodSnapshots.periodStartAt,
        compliancePeriodSnapshots.periodEndAt,
      ],
      set: { rule, dueAt: window.dueAt, timezone: clock.timezone, recordedAt: clock.now },
      setWhere: and(
        gt(compliancePeriodSnapshots.periodEndAt, clock.now),
        or(
          sql`${compliancePeriodSnapshots.rule} is distinct from ${JSON.stringify(rule)}::jsonb`,
          ne(compliancePeriodSnapshots.timezone, clock.timezone),
          ne(compliancePeriodSnapshots.dueAt, window.dueAt),
        ),
      ),
    })
}

export type ComplianceHistoryRow = EvalSubjectRow & {
  periodStart: string
  periodEnd: string
  periodKey: string
  periodStartAt: string
  periodEndAt: string
  timezone: string
  title: string
  recorded: boolean
  cronPeriod: boolean
}

/** Read-only history. Saved rules/rosters survive edits; evidence corrections remain visible. */
export async function evaluateComplianceHistory(
  tx: Database,
  tenantId: string,
  ob: ComplianceObligation,
  members: ResolvedMember[],
  clock: ComplianceClock,
  limit: number,
): Promise<ComplianceHistoryRow[]> {
  if (ob.tenantId !== tenantId)
    throw new Error('Cannot read compliance history for a different tenant')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 24)
    throw new Error('History is limited to 24 periods')
  const changes = await tx
    .select({
      at: auditLog.occurredAt,
      before: sql<string | null>`${auditLog.before}->>'status'`,
      after: sql<string>`${auditLog.after}->>'status'`,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.tenantId, tenantId),
        eq(auditLog.entityType, 'compliance_obligation'),
        eq(auditLog.entityId, ob.id),
        lte(auditLog.occurredAt, clock.now),
        sql`${auditLog.after}->>'status' in ('active','paused','archived')`,
      ),
    )
    .orderBy(asc(auditLog.occurredAt))
  const initial = changes[0]?.before ?? 'active'
  const last = changes.at(-1)?.after ?? initial
  if (last !== ob.status) changes.push({ at: ob.updatedAt, before: last, after: ob.status })
  if (ob.deletedAt) changes.push({ at: ob.deletedAt, before: null, after: 'archived' })
  changes.sort((a, b) => a.at.getTime() - b.at.getTime())
  const activeAtEnd = (end: Date) => {
    if (ob.deletedAt && end > ob.deletedAt) return false
    let status = initial
    for (const change of changes) if (change.at < end) status = change.after
    return status === 'active'
  }
  const candidates = await tx
    .select()
    .from(compliancePeriodSnapshots)
    .where(
      and(
        eq(compliancePeriodSnapshots.tenantId, tenantId),
        eq(compliancePeriodSnapshots.obligationId, ob.id),
        lte(compliancePeriodSnapshots.periodEndAt, clock.now),
        lte(compliancePeriodSnapshots.dueAt, clock.now),
      ),
    )
    .orderBy(desc(compliancePeriodSnapshots.periodEndAt))
    .limit(limit * 2)
  const unique = new Map<string, (typeof candidates)[number]>()
  for (const row of candidates) {
    if (!activeAtEnd(row.periodEndAt)) continue
    const key =
      row.rule.recurrence.kind === 'cron'
        ? row.periodStartAt.toISOString()
        : `${row.rule.recurrence.frequency}:${row.periodStart}:${row.periodEnd}`
    const prior = unique.get(key)
    if (!prior || row.recordedAt > prior.recordedAt) unique.set(key, row)
  }
  const saved = [...unique.values()]
    .sort((a, b) => b.periodEndAt.getTime() - a.periodEndAt.getTime())
    .slice(0, limit)
  const windows: {
    window: NonNullable<ReturnType<typeof periodWindow>>
    rule?: CompliancePeriodRule
    timezone: string
  }[] = saved.map((row) => ({
    window: {
      ...row,
      scheduledAt: row.periodStartAt,
      evidenceStartAt: row.periodStartAt,
      dueOn: row.periodEnd,
      nextDueAt: row.periodEndAt,
    },
    rule: row.rule,
    timezone: row.timezone,
  }))
  let current = periodWindow(ob, clock)
  for (let attempt = 0; current && attempt < limit + 2; attempt++) {
    if (!ob.recurrence.deadline && current.scheduledAt < ob.createdAt) break
    if (
      activeAtEnd(current.periodEndAt) &&
      current.periodEndAt <= clock.now &&
      current.dueAt < clock.now &&
      current.periodEndAt > ob.createdAt &&
      !saved.some(
        (row) =>
          row.periodStartAt < current!.periodEndAt && row.periodEndAt > current!.periodStartAt,
      )
    ) {
      windows.push({ window: current, timezone: clock.timezone })
    }
    const anchor = new Date(current.periodStartAt.getTime() - 1)
    if (anchor < ob.createdAt) break
    const previous = periodWindow(ob, { ...clock, periodAt: anchor })
    if (!previous || previous.periodStartAt >= current.periodStartAt) break
    current = previous
  }
  windows.sort((a, b) => b.window.periodEndAt.getTime() - a.window.periodEndAt.getTime())
  const rows: ComplianceHistoryRow[] = []
  for (const { window, rule, timezone } of windows.slice(0, limit)) {
    const historical = rule ? { ...ob, ...rule, createdAt: new Date(rule.createdAt) } : ob
    const roster = rule?.members ?? members
    const result = await evaluateObligation(
      tx,
      tenantId,
      historical,
      [],
      {
        now: new Date(window.periodEndAt.getTime() - 1),
        periodAt: window.periodStartAt,
        timezone,
      },
      roster,
    )
    const labels = rule
      ? new Map(rule.members.map((member) => [member.personId, member.label]))
      : null
    rows.push(
      ...result.rows.map((row) => ({
        ...row,
        status:
          row.status === 'pending' || row.status === 'in_progress'
            ? ('overdue' as const)
            : row.status,
        label: labels?.get(row.personId ?? '') ?? row.label,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
        periodKey: `${window.periodStartAt.toISOString()}:${window.periodEndAt.toISOString()}`,
        periodStartAt: window.periodStartAt.toISOString(),
        periodEndAt: window.periodEndAt.toISOString(),
        timezone,
        title: historical.title,
        recorded: Boolean(rule),
        cronPeriod: historical.recurrence.kind === 'cron',
      })),
    )
  }
  return rows
}
