import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { trainingCourses, trainingEnrollments } from '@beaconhs/db/schema'
import { assertTrainingEnrollmentOpen } from '@/lib/training-mutation-validation'

/**
 * Resolve and lock an enrollment before a runtime mutation. The course join
 * makes soft-deleted courses unavailable, while the row lock serializes lesson
 * starts, quiz attempts, evaluator updates, and final record issuance for the
 * same learner/course pair.
 */
export async function requireOpenTrainingEnrollment(
  tx: Database,
  args: {
    enrollmentId: string
    expectedPersonId?: string
    expectedCourseId?: string
  },
) {
  const [enrollment] = await tx
    .select({
      id: trainingEnrollments.id,
      courseId: trainingEnrollments.courseId,
      personId: trainingEnrollments.personId,
      status: trainingEnrollments.status,
      deliveryType: trainingCourses.deliveryType,
    })
    .from(trainingEnrollments)
    .innerJoin(
      trainingCourses,
      and(eq(trainingCourses.id, trainingEnrollments.courseId), isNull(trainingCourses.deletedAt)),
    )
    .where(
      and(eq(trainingEnrollments.id, args.enrollmentId), isNull(trainingEnrollments.deletedAt)),
    )
    .limit(1)
    .for('update')

  if (!enrollment) throw new Error('Enrollment not found')
  if (args.expectedPersonId && enrollment.personId !== args.expectedPersonId) {
    throw new Error('That enrollment is not yours')
  }
  if (args.expectedCourseId && enrollment.courseId !== args.expectedCourseId) {
    throw new Error('Enrollment not found')
  }
  assertTrainingEnrollmentOpen(enrollment.status)
  return enrollment
}
