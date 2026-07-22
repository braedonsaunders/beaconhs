import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import {
  people,
  trainingAssessmentTypes,
  trainingAssessments,
  trainingCourses,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { canSeeRecord } from '@/lib/visibility'
import { PrintButton } from './print-button'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

/**
 * Print-friendly certificate view. Strips all chrome and renders a centered
 * page with a flat, slightly-formal layout that prints cleanly to PDF via
 * browser "Save as PDF".
 *
 * Only renders for completed attempts that satisfied their graded pass mark or
 * their completion-only requirement.
 */
export default async function AssessmentCertificatePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  // Proctors run attempts for other people; either staff permission sees any
  // attempt's certificate. Everyone else is scoped by canSeeRecord (read.all →
  // any; otherwise only the viewer's own attempt).
  const isProctor = can(ctx, 'training.record.create') || can(ctx, 'training.class.manage')
  const data = await ctx.db(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(trainingAssessments)
      .where(eq(trainingAssessments.id, id))
      .limit(1)
    if (!attempt) return null
    if (
      !isProctor &&
      !(await canSeeRecord(ctx, tx, { prefix: 'training', personId: attempt.personId }))
    )
      return null
    if (attempt.status !== 'submitted' || !attempt.passed) return null
    const [type] = await tx
      .select()
      .from(trainingAssessmentTypes)
      .where(eq(trainingAssessmentTypes.id, attempt.typeId))
      .limit(1)
    const [person] = await tx.select().from(people).where(eq(people.id, attempt.personId)).limit(1)
    const [course] = attempt.courseId
      ? await tx
          .select()
          .from(trainingCourses)
          .where(eq(trainingCourses.id, attempt.courseId))
          .limit(1)
      : [null]
    return { attempt, type, person, course }
  })
  if (!data) notFound()
  const { attempt, type, person, course } = data
  const completed = attempt.completedAt ? new Date(attempt.completedAt) : null

  return (
    <div className="min-h-screen bg-white print:bg-white">
      <div className="mx-auto max-w-3xl px-12 py-16">
        <div className="mb-8 flex items-center justify-between">
          <p className="text-xs tracking-widest text-slate-500 uppercase">
            <GeneratedText id="m_10c5148a38f5cd" />
          </p>
          <p className="text-xs text-slate-500">
            <GeneratedText id="m_168a0278477786" />{' '}
            <GeneratedValue value={attempt.id.slice(0, 8)} />
          </p>
        </div>
        <h1 className="text-3xl font-semibold text-slate-900">
          <GeneratedValue value={type?.name ?? <GeneratedText id="m_1df1ba1205cf9e" />} />
        </h1>
        <GeneratedValue
          value={
            course ? (
              <p className="mt-1 text-sm text-slate-500">
                <GeneratedValue value={course.code} /> · <GeneratedValue value={course.name} />
              </p>
            ) : null
          }
        />

        <div className="my-10 border-y border-slate-200 py-10 text-center">
          <p className="text-xs tracking-widest text-slate-500 uppercase">
            <GeneratedText id="m_1db7c9459fcca3" />
          </p>
          <p className="mt-3 text-4xl font-semibold text-slate-900">
            <GeneratedValue value={person?.firstName} /> <GeneratedValue value={person?.lastName} />
          </p>
          <p className="mt-2 text-sm text-slate-500">
            <GeneratedText id="m_17414f59d8f567" />{' '}
            <GeneratedValue
              value={completed ? formatDate(completed, ctx.timezone, ctx.locale) : '—'}
            />
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-12 gap-y-3 text-sm">
          <GeneratedValue
            value={
              attempt.graded ? (
                <>
                  <div>
                    <dt className="text-xs tracking-wide text-slate-500 uppercase">
                      <GeneratedText id="m_1469688270fa41" />
                    </dt>
                    <dd className="font-semibold text-slate-900">
                      <GeneratedValue value={attempt.score} />%
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs tracking-wide text-slate-500 uppercase">
                      <GeneratedText id="m_0983c76465bdb2" />
                    </dt>
                    <dd className="text-slate-900">
                      <GeneratedValue value={attempt.passingScore} />%
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs tracking-wide text-slate-500 uppercase">
                      <GeneratedText id="m_08e7a76c4ab77f" />
                    </dt>
                    <dd className="text-slate-900">
                      <GeneratedValue value={attempt.pointsAwarded} /> /{' '}
                      <GeneratedValue value={attempt.pointsPossible} />
                    </dd>
                  </div>
                </>
              ) : null
            }
          />
          <div>
            <dt className="text-xs tracking-wide text-slate-500 uppercase">
              <GeneratedText id="m_0b9da892d6faf0" />
            </dt>
            <dd className="font-semibold text-green-700">
              <GeneratedValue value={attempt.graded ? 'Pass' : 'Completed'} />
            </dd>
          </div>
        </dl>

        <p className="mt-12 text-xs text-slate-400 print:text-slate-500">
          <GeneratedText id="m_137de9e5c8702d" />
          <GeneratedValue value={attempt.id} />.
        </p>

        <div className="mt-8 print:hidden">
          <PrintButton />
        </div>
      </div>
    </div>
  )
}
