'use client'

// Client wrapper that runs the shared CoursePresenter as a full-screen route
// (launched from a class, or opened directly to rehearse). Closing returns to
// wherever the instructor came from.

import { useRouter } from 'next/navigation'
import { CoursePresenter } from '../_presenter'
import type { AssessmentMeta, AttachmentMeta, ItemContent, QuizQuestion } from '../_presenter'
import type { ModuleLite } from '../_workspace'

export function ClassPresentClient({
  courseName,
  courseId,
  modules,
  items,
  quizQuestions,
  assessmentMeta,
  attachmentMeta,
  backHref,
}: {
  courseName: string
  courseId: string
  modules: ModuleLite[]
  items: Record<string, ItemContent>
  quizQuestions: Record<string, QuizQuestion[]>
  assessmentMeta: Record<string, AssessmentMeta>
  attachmentMeta: Record<string, AttachmentMeta>
  backHref: string
}) {
  const router = useRouter()
  return (
    <CoursePresenter
      courseId={courseId}
      courseName={courseName}
      modules={modules}
      items={items}
      quizQuestions={quizQuestions}
      assessmentMeta={assessmentMeta}
      attachmentMeta={attachmentMeta}
      onClose={() => router.push(backHref)}
    />
  )
}
