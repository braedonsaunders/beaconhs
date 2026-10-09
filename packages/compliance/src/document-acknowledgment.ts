import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { complianceObligations, documentAcknowledgments } from '@beaconhs/db/schema'
import { resolveObligationAudience } from './audience'
import { evidenceInWindow, resolveEvidenceEvaluationWindow } from './evidence-evaluation'
import { loadAudience, resolveComplianceClock } from './materialize'

/**
 * A historical signature remains evidence, but does not suppress a new cadence
 * requirement. Readers and both signing paths use the same eligibility check.
 * Writers hold the document owner lock before calling this, so retries cannot
 * create a second acknowledgment after the first satisfies the active period.
 */
export async function currentDocumentAcknowledgment(
  tx: Database,
  tenantId: string,
  documentId: string,
  versionId: string,
  personId: string,
): Promise<{ acknowledgedAt: Date } | null> {
  const clock = await resolveComplianceClock(tx, tenantId)
  const [latest] = await tx
    .select({ acknowledgedAt: documentAcknowledgments.acknowledgedAt })
    .from(documentAcknowledgments)
    .where(
      and(
        eq(documentAcknowledgments.tenantId, tenantId),
        eq(documentAcknowledgments.documentId, documentId),
        eq(documentAcknowledgments.versionId, versionId),
        eq(documentAcknowledgments.personId, personId),
        lte(documentAcknowledgments.acknowledgedAt, clock.now),
      ),
    )
    .orderBy(desc(documentAcknowledgments.acknowledgedAt))
    .limit(1)
  if (!latest) return null

  const obligations = await tx
    .select()
    .from(complianceObligations)
    .where(
      and(
        eq(complianceObligations.tenantId, tenantId),
        eq(complianceObligations.sourceModule, 'document'),
        eq(complianceObligations.status, 'active'),
        isNull(complianceObligations.deletedAt),
        eq(sql<string>`${complianceObligations.targetRef}->>'documentId'`, documentId),
      ),
    )
  for (const obligation of obligations) {
    if (obligation.recurrence.kind !== 'frequency' && obligation.recurrence.kind !== 'cron')
      continue
    const audience = await loadAudience(tx, tenantId, obligation.id)
    const members = await resolveObligationAudience(tx, tenantId, audience)
    if (!members.some((member) => member.personId === personId)) continue
    const window = resolveEvidenceEvaluationWindow(
      obligation.recurrence,
      clock,
      obligation.createdAt,
    )
    if (!evidenceInWindow(latest.acknowledgedAt, window)) return null
  }
  return latest
}
