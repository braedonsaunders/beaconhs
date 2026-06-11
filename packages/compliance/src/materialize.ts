// Materialisation: evaluate an obligation and persist the per-subject result
// into `compliance_status` (the scoreboard the hub reads + the worker keeps
// fresh). Idempotent upsert keyed on (obligationId, subjectKey) + delete-stale.

import { and, eq, isNull, notInArray } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { complianceAudience, complianceObligations, complianceStatus } from '@beaconhs/db/schema'
import { type AudienceItem } from './audience'
import { type ComplianceObligation, type EvalResult, evaluateObligation } from './evaluate'

type Tx = Database

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
): Promise<EvalResult> {
  const audience = await loadAudience(tx, ob.id)
  const result = await evaluateObligation(tx, tenantId, ob, audience, today)

  const now = new Date()
  const keys = result.rows.map((r) => r.key)

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

  return result
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
): Promise<{ obligation: ComplianceObligation; result: EvalResult }[]> {
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
  const out: { obligation: ComplianceObligation; result: EvalResult }[] = []
  for (const ob of obligations) {
    const result = await materializeObligation(tx, tenantId, ob, today)
    out.push({ obligation: ob, result })
  }
  return out
}
