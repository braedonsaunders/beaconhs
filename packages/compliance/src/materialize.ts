// Materialisation: evaluate an obligation and persist the per-subject result
// into `compliance_status` (the scoreboard the hub reads + the worker keeps
// fresh). Idempotent upsert keyed on (obligationId, subjectKey) + delete-stale.

import { and, eq, isNull, notInArray } from 'drizzle-orm'
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
        label: r.label,
        from,
        to: r.status,
        dueOn: r.dueOn,
      })
    }
  }

  for (const r of result.rows) {
    const percent =
      r.status === 'completed'
        ? 100
        : r.expected
          ? Math.round(((r.count ?? 0) / r.expected) * 100)
          : 0
    const values = {
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
    await tx
      .insert(complianceStatus)
      .values(values)
      .onConflictDoUpdate({
        target: [complianceStatus.obligationId, complianceStatus.subjectKey],
        set: {
          personId: values.personId,
          subjectRef: values.subjectRef,
          dueOn: values.dueOn,
          status: values.status,
          completedOn: values.completedOn,
          count: values.count,
          expected: values.expected,
          percent: values.percent,
          computedAt: now,
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
 * Materialise every active obligation for a tenant. Returns per-obligation
 * evaluation results (for reminder dispatch). Caller supplies a tenant-scoped
 * or super-admin tx.
 */
export async function materializeTenant(
  tx: Tx,
  tenantId: string,
  today?: string,
): Promise<{ obligation: ComplianceObligation; result: EvalResult; transitions: ComplianceTransition[] }[]> {
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
