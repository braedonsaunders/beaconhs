import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { materializeObligation } from '@beaconhs/compliance'
import type { Database } from '@beaconhs/db'
import { complianceObligations } from '@beaconhs/db/schema'

type JobTitleObligation = typeof complianceObligations.$inferSelect

/**
 * Lock every active job-title obligation before its underlying assignment,
 * task, or acknowledgement evidence changes. The compliance scanner locks the
 * obligation before reading evidence, so evidence writers must do the same to
 * prevent a stale evaluation/dispatch from committing between the evidence
 * mutation and its reconciliation.
 */
export async function lockJobTitleObligations(
  tx: Database,
  tenantId: string,
  titleIds: readonly string[],
): Promise<JobTitleObligation[]> {
  const uniqueTitleIds = [...new Set(titleIds.map((id) => id.trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  )
  if (uniqueTitleIds.length === 0) return []
  return tx
    .select()
    .from(complianceObligations)
    .where(
      and(
        eq(complianceObligations.tenantId, tenantId),
        eq(complianceObligations.sourceModule, 'job_title_signoff'),
        eq(complianceObligations.status, 'active'),
        isNull(complianceObligations.deletedAt),
        inArray(sql<string>`${complianceObligations.targetRef} ->> 'jobTitleId'`, uniqueTitleIds),
      ),
    )
    .orderBy(asc(complianceObligations.id))
    .for('update')
}

/** Reconcile a deterministically pre-locked obligation set after mutation. */
export async function materializeLockedJobTitleObligations(
  tx: Database,
  tenantId: string,
  obligations: readonly JobTitleObligation[],
): Promise<void> {
  for (const obligation of obligations) {
    await materializeObligation(tx, tenantId, obligation)
  }
}
