import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { complianceObligations, complianceStatus } from '@beaconhs/db/schema'

type OutstandingCourseRequirement = {
  obligationId: string
  dueOn: string | null
  computedAt: Date
}

/** The earliest live training/certification requirement this person still owes for a course. */
export async function findOutstandingCourseRequirement(
  tx: Database,
  args: { tenantId: string; personId: string; courseId: string },
): Promise<OutstandingCourseRequirement | null> {
  const rows = await tx
    .select({
      obligationId: complianceObligations.id,
      dueOn: complianceStatus.dueOn,
      computedAt: complianceStatus.computedAt,
    })
    .from(complianceStatus)
    .innerJoin(
      complianceObligations,
      and(
        eq(complianceObligations.tenantId, complianceStatus.tenantId),
        eq(complianceObligations.id, complianceStatus.obligationId),
      ),
    )
    .where(
      and(
        eq(complianceStatus.tenantId, args.tenantId),
        eq(complianceStatus.personId, args.personId),
        inArray(complianceStatus.status, ['pending', 'in_progress', 'overdue', 'expiring']),
        inArray(complianceObligations.sourceModule, ['training', 'cert_requirement']),
        eq(complianceObligations.status, 'active'),
        isNull(complianceObligations.deletedAt),
        sql`${complianceObligations.targetRef}->>'courseId' = ${args.courseId}`,
      ),
    )
    .orderBy(asc(complianceStatus.dueOn), asc(complianceObligations.id))
  const earliest = rows[0]
  if (!earliest) return null
  const newestComputation = rows.reduce(
    (latest, row) => (row.computedAt.getTime() > latest.getTime() ? row.computedAt : latest),
    earliest.computedAt,
  )
  return { ...earliest, computedAt: newestComputation }
}

/**
 * A stale scoreboard row computed before the enrollment completed must not
 * immediately erase that completion. A calculation made afterwards proves the
 * engine evaluated the completion and still requires a new period.
 */
export function requiresEnrollmentRenewal(
  enrollment: { status: string; completedAt: Date | null } | null,
  requirement: OutstandingCourseRequirement | null,
): boolean {
  if (!enrollment || enrollment.status !== 'completed' || !requirement) return false
  return (
    !enrollment.completedAt || requirement.computedAt.getTime() > enrollment.completedAt.getTime()
  )
}

/** Decide whether the one-row-per-person/course enrollment must begin a fresh attempt. */
export function shouldRestartEnrollment(
  enrollment: { status: string; completedAt: Date | null; deletedAt: Date | null },
  args: { assigning: boolean; requirement: OutstandingCourseRequirement | null },
): boolean {
  return (
    enrollment.status === 'not_started' ||
    enrollment.status === 'withdrawn' ||
    enrollment.status === 'expired' ||
    Boolean(enrollment.deletedAt) ||
    (args.assigning && enrollment.status === 'completed') ||
    requiresEnrollmentRenewal(enrollment, args.requirement)
  )
}
