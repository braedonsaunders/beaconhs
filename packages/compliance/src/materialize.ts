// Materialisation: evaluate an obligation and persist the per-subject result
// into `compliance_status` (the scoreboard the hub reads + the worker keeps
// fresh). Idempotent upsert keyed on (tenantId, obligationId, subjectKey) plus
// delete-stale. The obligation row is also the shared serialization lock for
// every caller: web mutations, evidence writers, sync, and the worker.

import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  complianceAudience,
  complianceDispatches,
  complianceObligations,
  complianceStatus,
  tenantNotificationPolicy,
} from '@beaconhs/db/schema'
import { type AudienceItem } from './audience'
import {
  type ComplianceObligation,
  type EvalResult,
  type EvalSubjectRow,
  type EvalStatus,
  evaluateObligation,
} from './evaluate'
import type { ComplianceClock } from './schedule'

type Tx = Database

/**
 * A per-subject status change detected during materialisation. This is the
 * heartbeat of the unified detection layer: the worker turns transitions INTO an
 * actionable state (overdue/expiring) into person-targeted notifications, and we
 * only fire when the status actually changes — no more "re-alert every scan".
 */
export type ComplianceTransition = {
  subjectKey: string
  personId: string | null
  // Direct login user to self-target (record-owned subjects like CAs), preferred
  // over the personId→people.userId bridge in the dispatcher.
  userId: string | null
  label: string
  from: EvalStatus | null
  to: EvalStatus
  dueOn: string | null
}

export type MaterializeResult = {
  /** The current row reloaded under the materialization lock; null after a hard delete. */
  obligation: ComplianceObligation | null
  result: EvalResult
  transitions: ComplianceTransition[]
  /** Durable outbox row created for actionable transitions, if any. */
  dispatchId: string | null
  /** False when a stale caller reached an obligation that was paused/deleted. */
  materialized: boolean
}

export type ComplianceClockOptions = {
  now?: Date
  timezone?: string
}

type ActionableComplianceTransition = ComplianceTransition & {
  to: 'overdue' | 'expiring' | 'pending'
}

type DispatchAlertTransition = NonNullable<
  (typeof complianceDispatches.$inferSelect)['alertPayload']
>['transitions'][number]

function emptyResult(): EvalResult {
  return {
    rows: [],
    totals: { total: 0, completed: 0, overdue: 0, pending: 0 },
    percent: 0,
    nextDueAt: null,
  }
}

/**
 * Only transitions into an actionable state publish. Scheduled forms also
 * alert when a new period becomes ready; other pending work remains visible in
 * the compliance hub without generating an assignment notification.
 */
export function actionableComplianceTransitions(
  obligation: Pick<ComplianceObligation, 'sourceModule'>,
  transitions: readonly ComplianceTransition[],
): ActionableComplianceTransition[] {
  return transitions.filter(
    (transition): transition is ActionableComplianceTransition =>
      transition.to === 'overdue' ||
      transition.to === 'expiring' ||
      (obligation.sourceModule === 'form' && transition.to === 'pending'),
  )
}

async function lockCurrentObligation(
  tx: Tx,
  tenantId: string,
  obligationId: string,
): Promise<ComplianceObligation | null> {
  const [current] = await tx
    .select()
    .from(complianceObligations)
    .where(
      and(eq(complianceObligations.tenantId, tenantId), eq(complianceObligations.id, obligationId)),
    )
    .limit(1)
    .for('update')
  return current ?? null
}

/** Stop every unpublished alert for an obligation that is no longer live. */
export async function skipQueuedComplianceDispatches(
  tx: Tx,
  tenantId: string,
  obligationId: string,
  reason = 'Compliance obligation is no longer active',
): Promise<void> {
  await tx
    .update(complianceDispatches)
    .set({
      status: 'skipped',
      error: reason,
      publishLeaseId: null,
      publishClaimedAt: null,
    })
    .where(
      and(
        eq(complianceDispatches.tenantId, tenantId),
        eq(complianceDispatches.obligationId, obligationId),
        eq(complianceDispatches.status, 'queued'),
      ),
    )
}

async function queueActionableTransitions(
  tx: Tx,
  tenantId: string,
  obligation: ComplianceObligation,
  transitions: readonly ComplianceTransition[],
  occurredAt: Date,
): Promise<string | null> {
  const actionable = actionableComplianceTransitions(obligation, transitions)
  if (actionable.length === 0) return null

  // The obligation lock serializes every canonical writer, so advancing one
  // millisecond past the latest occurrence gives each distinct state edge a
  // collision-free ledger key without weakening deterministic scan retries.
  const [latest] = await tx
    .select({ occurredAt: complianceDispatches.occurredAt })
    .from(complianceDispatches)
    .where(
      and(
        eq(complianceDispatches.tenantId, tenantId),
        eq(complianceDispatches.obligationId, obligation.id),
      ),
    )
    .orderBy(desc(complianceDispatches.occurredAt))
    .limit(1)
  const latestTime = latest?.occurredAt.getTime() ?? Number.NEGATIVE_INFINITY
  const uniqueOccurredAt =
    latestTime >= occurredAt.getTime() ? new Date(latestTime + 1) : occurredAt

  const [dispatch] = await tx
    .insert(complianceDispatches)
    .values({
      tenantId,
      obligationId: obligation.id,
      occurredAt: uniqueOccurredAt,
      status: 'queued',
      alertPayload: { transitions: actionable },
    })
    .onConflictDoNothing({
      target: [
        complianceDispatches.tenantId,
        complianceDispatches.obligationId,
        complianceDispatches.occurredAt,
      ],
    })
    .returning({ id: complianceDispatches.id })
  return dispatch?.id ?? null
}

function actionableTransitionForRow(
  obligation: Pick<ComplianceObligation, 'sourceModule'>,
  row: EvalSubjectRow,
): ActionableComplianceTransition | null {
  const [actionable] = actionableComplianceTransitions(obligation, [
    {
      subjectKey: row.key,
      personId: row.personId,
      userId: row.userId ?? null,
      label: row.label,
      from: null,
      to: row.status,
      dueOn: row.dueOn,
    },
  ])
  return actionable ?? null
}

function sameDispatchTransition(
  prior: DispatchAlertTransition,
  current: ActionableComplianceTransition,
): boolean {
  return (
    prior.subjectKey === current.subjectKey &&
    prior.personId === current.personId &&
    (prior.userId ?? null) === current.userId &&
    prior.label === current.label &&
    prior.to === current.to &&
    prior.dueOn === current.dueOn
  )
}

/**
 * Retire unpublished alert snapshots contradicted by this evaluation. Evidence
 * writers materialize in their own transaction after changing a form,
 * credential, acknowledgment, or assessment. If a scanner queued an old edge
 * immediately beforehand, the new truth must cancel that payload rather than
 * letting an overdue alert publish after completion. Mixed dispatches retain
 * their still-current subjects in one replacement row.
 */
async function reconcileAndQueueActionableTransitions(
  tx: Tx,
  tenantId: string,
  obligation: ComplianceObligation,
  result: EvalResult,
  transitions: readonly ComplianceTransition[],
  occurredAt: Date,
): Promise<string | null> {
  const queued = await tx
    .select({ id: complianceDispatches.id, alertPayload: complianceDispatches.alertPayload })
    .from(complianceDispatches)
    .where(
      and(
        eq(complianceDispatches.tenantId, tenantId),
        eq(complianceDispatches.obligationId, obligation.id),
        eq(complianceDispatches.status, 'queued'),
      ),
    )
    .orderBy(asc(complianceDispatches.occurredAt), asc(complianceDispatches.id))
    .for('update')

  const currentBySubject = new Map(
    result.rows.map((row) => [row.key, actionableTransitionForRow(obligation, row)]),
  )
  const staleDispatchIds: string[] = []
  const replacementBySubject = new Map<string, ActionableComplianceTransition>()
  const unchangedBySubject = new Map<string, ActionableComplianceTransition>()

  for (const dispatch of queued) {
    const priorTransitions = dispatch.alertPayload?.transitions
    if (!priorTransitions?.length) continue

    let stale = false
    const currentForDispatch: ActionableComplianceTransition[] = []
    const subjectsInDispatch = new Set<string>()
    for (const prior of priorTransitions) {
      const current = currentBySubject.get(prior.subjectKey) ?? null
      if (
        !current ||
        !sameDispatchTransition(prior, current) ||
        unchangedBySubject.has(prior.subjectKey) ||
        subjectsInDispatch.has(prior.subjectKey)
      ) {
        stale = true
      }
      if (current) {
        currentForDispatch.push(current)
        subjectsInDispatch.add(current.subjectKey)
      }
    }

    if (stale) {
      staleDispatchIds.push(dispatch.id)
      for (const current of currentForDispatch) {
        replacementBySubject.set(current.subjectKey, current)
      }
    } else {
      for (const current of currentForDispatch) {
        unchangedBySubject.set(current.subjectKey, current)
      }
    }
  }

  if (staleDispatchIds.length > 0) {
    await tx
      .update(complianceDispatches)
      .set({
        status: 'skipped',
        error: 'Superseded by newer compliance evidence',
        publishLeaseId: null,
        publishClaimedAt: null,
      })
      .where(
        and(
          eq(complianceDispatches.tenantId, tenantId),
          eq(complianceDispatches.obligationId, obligation.id),
          eq(complianceDispatches.status, 'queued'),
          inArray(complianceDispatches.id, staleDispatchIds),
        ),
      )
  }

  for (const transition of actionableComplianceTransitions(obligation, transitions)) {
    if (!unchangedBySubject.has(transition.subjectKey)) {
      replacementBySubject.set(transition.subjectKey, transition)
    }
  }
  for (const subjectKey of unchangedBySubject.keys()) {
    replacementBySubject.delete(subjectKey)
  }

  return queueActionableTransitions(
    tx,
    tenantId,
    obligation,
    [...replacementBySubject.values()],
    occurredAt,
  )
}

/**
 * Resolve the tenant's canonical compliance clock. Frequency obligations and
 * the scan gate intentionally share `scanTimezone`, so the same scheduled
 * instant is interpreted identically in the web app, worker, and CLI repair
 * script. Callers may pin the instant/timezone for a deterministic scan.
 */
export async function resolveComplianceClock(
  tx: Tx,
  tenantId: string,
  options: ComplianceClockOptions = {},
): Promise<ComplianceClock> {
  const now = options.now ?? new Date()
  if (Number.isNaN(now.getTime())) throw new Error('The compliance scan time is invalid')

  let timezone = options.timezone?.trim()
  if (!timezone) {
    const [policy] = await tx
      .select({ timezone: tenantNotificationPolicy.scanTimezone })
      .from(tenantNotificationPolicy)
      .where(eq(tenantNotificationPolicy.tenantId, tenantId))
      .limit(1)
    timezone = policy?.timezone.trim() || 'UTC'
  }
  return { now, timezone }
}

/** Load an obligation's audience rows as engine AudienceItems. */
export async function loadAudience(
  tx: Tx,
  tenantId: string,
  obligationId: string,
): Promise<AudienceItem[]> {
  const rows = await tx
    .select({ kind: complianceAudience.kind, entityKey: complianceAudience.entityKey })
    .from(complianceAudience)
    .where(
      and(
        eq(complianceAudience.tenantId, tenantId),
        eq(complianceAudience.obligationId, obligationId),
      ),
    )
  return rows.map((r) => ({ kind: r.kind as AudienceItem['kind'], entityKey: r.entityKey }))
}

/**
 * Evaluate one obligation and upsert its per-subject rows into
 * compliance_status, removing rows for subjects no longer in scope. Returns the
 * evaluation so callers (the worker) can act on overdue/expiring counts.
 */
export async function materializeObligation(
  tx: Tx,
  tenantId: string,
  ob: ComplianceObligation,
  options: ComplianceClockOptions = {},
): Promise<MaterializeResult> {
  if (ob.tenantId !== tenantId) {
    throw new Error('Cannot materialize an obligation for a different tenant')
  }

  // This lock is deliberately the first mutable-domain operation. Every
  // materializer uses the same row, so a scan cannot evaluate an old target or
  // audience and commit after a concurrent edit/pause/delete. Reloading after
  // the lock wait is essential under PostgreSQL READ COMMITTED semantics.
  const current = await lockCurrentObligation(tx, tenantId, ob.id)
  if (!current || current.status !== 'active' || current.deletedAt) {
    await tx
      .delete(complianceStatus)
      .where(and(eq(complianceStatus.tenantId, tenantId), eq(complianceStatus.obligationId, ob.id)))
    await skipQueuedComplianceDispatches(tx, tenantId, ob.id)
    return {
      obligation: current,
      result: emptyResult(),
      transitions: [],
      dispatchId: null,
      materialized: false,
    }
  }

  const clock = await resolveComplianceClock(tx, tenantId, options)
  const audience = await loadAudience(tx, tenantId, current.id)
  const result = await evaluateObligation(tx, tenantId, current, audience, clock)

  const now = clock.now
  const keys = result.rows.map((r) => r.key)

  // Snapshot prior status per subject so we can detect transitions (this scan's
  // status vs. last scan's). New subjects transition from `null`.
  const priorRows = await tx
    .select({
      subjectKey: complianceStatus.subjectKey,
      status: complianceStatus.status,
      periodStart: complianceStatus.periodStart,
      periodEnd: complianceStatus.periodEnd,
    })
    .from(complianceStatus)
    .where(
      and(eq(complianceStatus.tenantId, tenantId), eq(complianceStatus.obligationId, current.id)),
    )
  const prior = new Map<
    string,
    { status: EvalStatus; periodStart: string | null; periodEnd: string | null }
  >(
    priorRows.map((r) => [
      r.subjectKey,
      { status: r.status as EvalStatus, periodStart: r.periodStart, periodEnd: r.periodEnd },
    ]),
  )
  const transitions: ComplianceTransition[] = []
  for (const r of result.rows) {
    const previous = prior.get(r.key)
    const from = previous?.status ?? null
    const periodChanged =
      previous !== undefined &&
      (previous.periodStart !== (r.periodStart ?? null) ||
        previous.periodEnd !== (r.periodEnd ?? null))
    if (from !== r.status || periodChanged) {
      transitions.push({
        subjectKey: r.key,
        personId: r.personId,
        userId: r.userId ?? null,
        label: r.label,
        from,
        to: r.status,
        dueOn: r.dueOn,
      })
    }
  }

  // Batched upsert: per-record adapters can return thousands of rows per
  // obligation. Insert in chunks with a single onConflictDoUpdate using
  // `excluded.*` references instead of one round-trip per subject.
  const valueRows = result.rows.map((r) => {
    const percent =
      r.percent ??
      (r.status === 'completed'
        ? 100
        : r.expected
          ? Math.round(((r.count ?? 0) / r.expected) * 100)
          : 0)
    return {
      tenantId,
      obligationId: current.id,
      personId: r.personId,
      subjectRef: r.subjectRef,
      subjectKey: r.key,
      periodStart: r.periodStart ?? null,
      periodEnd: r.periodEnd ?? null,
      dueOn: r.dueOn,
      status: r.status as never,
      completedOn: r.completedOn,
      count: r.count ?? 0,
      expected: r.expected ?? 0,
      percent,
      computedAt: now,
    }
  })
  const CHUNK = 500
  for (let i = 0; i < valueRows.length; i += CHUNK) {
    await tx
      .insert(complianceStatus)
      .values(valueRows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [
          complianceStatus.tenantId,
          complianceStatus.obligationId,
          complianceStatus.subjectKey,
        ],
        set: {
          personId: sql`excluded.person_id`,
          subjectRef: sql`excluded.subject_ref`,
          periodStart: sql`excluded.period_start`,
          periodEnd: sql`excluded.period_end`,
          dueOn: sql`excluded.due_on`,
          status: sql`excluded.status`,
          completedOn: sql`excluded.completed_on`,
          count: sql`excluded.count`,
          expected: sql`excluded.expected`,
          percent: sql`excluded.percent`,
          computedAt: sql`excluded.computed_at`,
        },
      })
  }

  // Drop status rows for subjects no longer present.
  await tx
    .delete(complianceStatus)
    .where(
      and(
        eq(complianceStatus.tenantId, tenantId),
        eq(complianceStatus.obligationId, current.id),
        keys.length > 0 ? notInArray(complianceStatus.subjectKey, keys) : undefined,
      ),
    )

  await tx
    .update(complianceObligations)
    .set({ lastScannedAt: now, nextDueAt: result.nextDueAt })
    .where(
      and(
        eq(complianceObligations.tenantId, tenantId),
        eq(complianceObligations.id, current.id),
        eq(complianceObligations.status, 'active'),
        isNull(complianceObligations.deletedAt),
      ),
    )

  // The ledger write is part of the same transaction as the status edge. An
  // immediate web/evidence materialization therefore cannot consume an alert
  // transition before the worker has durable work to publish after commit.
  const dispatchId = await reconcileAndQueueActionableTransitions(
    tx,
    tenantId,
    current,
    result,
    transitions,
    clock.now,
  )
  const obligation = { ...current, lastScannedAt: now, nextDueAt: result.nextDueAt }
  return { obligation, result, transitions, dispatchId, materialized: true }
}

/**
 * Provision the built-in obligations that aren't user-authored — currently the
 * corrective-action "closed by due date" rule. These are SYSTEM obligations (no
 * audience, per_record): the unified engine owns CA-overdue detection instead of
 * a per-module scan. Idempotent via the (sourceKey, sourceId) unique index, so
 * it's safe to call on every scan. Keyed by tenantId → exactly one per tenant.
 */
export async function ensureSystemObligations(tx: Tx, tenantId: string): Promise<void> {
  await tx
    .insert(complianceObligations)
    .values({
      tenantId,
      sourceModule: 'corrective_action' as never,
      subjectKind: 'per_record' as never,
      title: 'Corrective actions closed by due date',
      status: 'active',
      targetRef: {},
      recurrence: { kind: 'event' } as never,
      recurrenceKind: 'event' as never,
      sourceKey: 'system:corrective_action',
      sourceId: tenantId,
    })
    .onConflictDoNothing({
      target: [
        complianceObligations.tenantId,
        complianceObligations.sourceKey,
        complianceObligations.sourceId,
      ],
    })
}

/**
 * Materialise every active obligation for a tenant. Returns per-obligation
 * evaluation results (for reminder dispatch). Caller supplies a tenant-scoped
 * or super-admin tx.
 */
export async function materializeTenant(
  tx: Tx,
  tenantId: string,
  options: ComplianceClockOptions = {},
): Promise<
  {
    obligation: ComplianceObligation
    result: EvalResult
    transitions: ComplianceTransition[]
    dispatchId: string | null
  }[]
> {
  const clock = await resolveComplianceClock(tx, tenantId, options)
  await ensureSystemObligations(tx, tenantId)
  const obligations = await tx
    .select()
    .from(complianceObligations)
    .where(
      and(
        eq(complianceObligations.tenantId, tenantId),
        eq(complianceObligations.status, 'active'),
        isNull(complianceObligations.deletedAt),
      ),
    )
    .orderBy(asc(complianceObligations.id))
  const out: {
    obligation: ComplianceObligation
    result: EvalResult
    transitions: ComplianceTransition[]
    dispatchId: string | null
  }[] = []
  for (const ob of obligations) {
    const materialized = await materializeObligation(tx, tenantId, ob, clock)
    if (!materialized.materialized || !materialized.obligation) continue
    out.push({
      obligation: materialized.obligation,
      result: materialized.result,
      transitions: materialized.transitions,
      dispatchId: materialized.dispatchId,
    })
  }
  return out
}
