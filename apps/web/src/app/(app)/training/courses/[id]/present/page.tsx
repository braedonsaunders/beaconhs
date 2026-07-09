import { notFound, redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { lessonProseCss } from '../../../_editor/prose'
import { loadCoursePresentation } from '../_lib/presentation'
import { ClassPresentClient } from './_client'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Present · ${id.slice(0, 8)}` }
}

// Only internal app paths are honoured as a return target — never an absolute
// or protocol-relative URL supplied by the caller.
function safeBackHref(from: string | undefined, fallback: string): string {
  if (from && from.startsWith('/') && !from.startsWith('//')) return from
  return fallback
}

export default async function CoursePresentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const ctx = await requireRequestContext()
  // Presenting is an instructor/author action.
  if (!can(ctx, 'training.class.manage') && !can(ctx, 'training.course.manage')) {
    redirect(`/training/courses/${id}`)
  }

  const presentation = await ctx.db((tx) => loadCoursePresentation(tx, id))
  if (!presentation) notFound()

  const backHref = safeBackHref(
    typeof sp.from === 'string' ? sp.from : undefined,
    `/training/courses/${id}`,
  )

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: lessonProseCss('.lesson-prose') }} />
      <ClassPresentClient
        courseName={presentation.course.name}
        modules={presentation.modules}
        items={presentation.itemContents}
        quizQuestions={presentation.quizQuestions}
        assessmentMeta={presentation.assessmentMeta}
        attachmentMeta={presentation.attachmentMeta}
        backHref={backHref}
      />
    </>
  )
}
