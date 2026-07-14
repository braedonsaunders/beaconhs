export type AssessmentAttemptSource = 'standalone' | 'lesson_quiz'

/**
 * Standalone course-linked assessments issue their own training record when
 * passed. Lesson quizzes are only one completion gate inside an enrollment, so
 * the course completion path must remain the sole record issuer.
 */
export function assessmentAttemptRecordCourseId(
  linkedCourseId: string | null,
  source: AssessmentAttemptSource,
): string | null {
  return source === 'lesson_quiz' ? null : linkedCourseId
}
