// Materialisation: evaluate an obligation and persist the per-subject result
// into `compliance_status` (the scoreboard the hub reads + the worker keeps
// fresh). Idempotent upsert keyed on (obligationId, subjectKey) + delete-stale.

import { and, eq, isNull, notInArray, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { complianceAudience, complianceObligations, complianceStatus } from '@beaconhs/db/schema'
import { type AudienceItem } from './audience'
import {
  type ComplianceObligation,
  type EvalResult,
  type EvalStatus,
  evaluateObligation,
} from './evaluate'

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

export type MaterializeResult = { result: EvalResult; transitions: ComplianceTransition[] }

/** Load an obligation's audience rows as engine AudienceItems. */
export async function loadAudience(tx: Tx, obligationId: string): Promise<AudienceItem[]> {
  const rows = await tx
    .select({ kind: complianceAudience.kind, entityKey: complianceAudience.entityKey })
    .from(complianceAudience)
    .where(eq(complianceAudience.obligationId, obligationId))
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
  today: string = new Date().toISOString().slice(0, 10),
): Promise<MaterializeResult> {
  const audience = await loadAudience(tx, ob.id)
  const result = await evaluateObligation(tx, tenantId, ob, audience, today)

  const now = new Date()
  const keys = result.rows.map((r) => r.key)

  // Snapshot prior status per subject so we can detect transitions (this scan's
  // status vs. last scan's). New subjects transition from `null`.
  const priorRows = await tx
    .select({ subjectKey: complianceStatus.subjectKey, status: complianceStatus.status })
    .from(complianceStatus)
    .where(eq(complianceStatus.obligationId, ob.id))
  const prior = new Map<string, EvalStatus>(
    priorRows.map((r) => [r.subjectKey, r.status as EvalStatus]),
  )
  const transitions: ComplianceTransition[] = []
  for (const r of result.rows) {
    const from = prior.get(r.key) ?? null
    if (from !== r.status) {
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
      r.status === 'completed'
        ? 100
        : r.expected
          ? Math.round(((r.count ?? 0) / r.expected) * 100)
          : 0
    return {
      tenantId,
      obligationId: ob.id,
      personId: r.personId,
      subjectRef: r.subjectRef,
      subjectKey: r.key,
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
        target: [complianceStatus.obligationId, complianceStatus.subjectKey],
        set: {
          personId: sql`excluded.person_id`,
          subjectRef: sql`excluded.subject_ref`,
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
        eq(complianceStatus.obligationId, ob.id),
        keys.length > 0 ? notInArray(complianceStatus.subjectKey, keys) : undefined,
      ),
    )

  await tx
    .update(complianceObligations)
    .set({ lastScannedAt: now })
    .where(eq(complianceObligations.id, ob.id))

  return { result, transitions }
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
      target: [complianceObligations.sourceKey, complianceObligations.sourceId],
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
  today?: string,
): Promise<
  { obligation: ComplianceObligation; result: EvalResult; transitions: ComplianceTransition[] }[]
> {
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
  const out: {
    obligation: ComplianceObligation
    result: EvalResult
    transitions: ComplianceTransition[]
  }[] = []
  for (const ob of obligations) {
    const { result, transitions } = await materializeObligation(tx, tenantId, ob, today)
    out.push({ obligation: ob, result, transitions })
  }
  return out
}
