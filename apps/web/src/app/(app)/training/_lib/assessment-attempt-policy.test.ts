import { describe, expect, it } from 'vitest'
import { assessmentAttemptRecordCourseId } from './assessment-attempt-policy'

describe('assessmentAttemptRecordCourseId', () => {
  it('keeps a linked course for standalone assessments', () => {
    expect(assessmentAttemptRecordCourseId('course-1', 'standalone')).toBe('course-1')
  })

  it('does not let an intermediate lesson quiz issue a course record', () => {
    expect(assessmentAttemptRecordCourseId('course-1', 'lesson_quiz')).toBeNull()
  })

  it('keeps an unlinked standalone assessment unlinked', () => {
    expect(assessmentAttemptRecordCourseId(null, 'standalone')).toBeNull()
  })
})
