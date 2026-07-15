import { getGeneratedValueTranslations } from '@/i18n/generated.server'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { Award, Check, X } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  Input,
  Select,
  Textarea,
} from '@beaconhs/ui'
import {
  people,
  trainingAssessmentResults,
  trainingAssessmentTypes,
  trainingAssessments,
  trainingCourses,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { formatDateTime } from '@/lib/datetime'
import { canSeeRecord } from '@/lib/visibility'
import { PageContainer } from '@/components/page-layout'
import { DetailGrid } from '@/components/detail-grid'
import { isUuid } from '@/lib/list-params'
import { cancelAssessmentAttempt, submitAssessmentAttempt } from '../../_actions/assessments'

export const dynamic = 'force-dynamic'

export default async function AssessmentAttemptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  // Proctors (training.record.create / training.class.manage) run attempts for
  // other people, so either staff permission sees (and can grade) any attempt.
  const isProctor = can(ctx, 'training.record.create') || can(ctx, 'training.class.manage')

  const data = await ctx.db(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(trainingAssessments)
      .where(eq(trainingAssessments.id, id))
      .limit(1)
    if (!attempt) return null
    // Per-record visibility (mirrors /training/records/[id]): read.all and
    // proctors see any attempt; everyone else only their own. Closes the
    // read-by-URL gap that exposed colleagues' scores and answers.
    if (
      !isProctor &&
      !(await canSeeRecord(ctx, tx, { prefix: 'training', personId: attempt.personId }))
    )
      return null
    const [me] = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.userId, ctx.userId))
      .limit(1)
    const isMine = me != null && me.id === attempt.personId
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
    const results = await tx
      .select()
      .from(trainingAssessmentResults)
      .where(eq(trainingAssessmentResults.assessmentId, id))
      .orderBy(asc(trainingAssessmentResults.createdAt))
    return { attempt, type, person, course, results, isMine }
  })

  if (!data) notFound()
  const { attempt, type, person, course, results, isMine } = data

  const isInProgress = attempt.status === 'in_progress'
  // Only the candidate (or a proctor) may record answers / submit / cancel —
  // mirrors the ownership checks in the server actions, so a read.all viewer
  // gets a read-only sheet instead of controls that would be rejected on POST.
  const canAct = isInProgress && (isMine || isProctor)
  const submitAction = submitAssessmentAttempt.bind(null, attempt.id)
  const cancelAction = cancelAssessmentAttempt.bind(null, attempt.id)

  return (
    <PageContainer>
      <div className="space-y-6">
        <DetailHeader
          back={{ href: '/training/assessments', label: 'Back to assessments' }}
          title={tGeneratedValue(type?.name ?? tGenerated('m_1df1ba1205cf9e'))}
          subtitle={tGeneratedValue(
            person ? `${person.firstName} ${person.lastName}` : tGenerated('m_03029599bbfa85'),
          )}
          badge={
            attempt.status === 'in_progress' ? (
              <Badge variant="secondary">
                <GeneratedText id="m_1a03b06872ffd9" />
              </Badge>
            ) : attempt.status === 'cancelled' ? (
              <Badge variant="outline">
                <GeneratedText id="m_1a7e1cf2be443e" />
              </Badge>
            ) : attempt.passed ? (
              <Badge variant="success">
                <GeneratedText id="m_0e4b19568a01bf" />
              </Badge>
            ) : (
              <Badge variant="destructive">
                <GeneratedText id="m_169669494a86f8" />
              </Badge>
            )
          }
          actions={
            attempt.status === 'submitted' && attempt.passed ? (
              <Link href={`/training/assessments/${attempt.id}/certificate`}>
                <Button variant="outline">
                  <Award size={14} /> <GeneratedText id="m_12069317ccd53b" />
                </Button>
              </Link>
            ) : null
          }
        />

        <DetailGrid
          rows={[
            { label: 'Person', value: person ? `${person.firstName} ${person.lastName}` : '—' },
            { label: 'Type', value: type?.name ?? '—' },
            { label: 'Course', value: course?.name ?? '—' },
            { label: 'Passing score', value: `${attempt.passingScore}%` },
            {
              label: 'Score',
              value: attempt.score != null ? `${attempt.score}%` : '—',
            },
            {
              label: 'Points',
              value:
                attempt.pointsAwarded != null && attempt.pointsPossible != null
                  ? `${attempt.pointsAwarded} / ${attempt.pointsPossible}`
                  : '—',
            },
            {
              label: 'Started',
              value: attempt.startedAt
                ? formatDateTime(new Date(attempt.startedAt), ctx.timezone, ctx.locale)
                : '—',
            },
            {
              label: 'Completed',
              value: attempt.completedAt
                ? formatDateTime(new Date(attempt.completedAt), ctx.timezone, ctx.locale)
                : '—',
            },
          ]}
        />

        <GeneratedValue
          value={
            type?.preAssessmentMessage && isInProgress ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <GeneratedText id="m_146cd84bfd9be5" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                    <GeneratedValue value={type.preAssessmentMessage} />
                  </p>
                </CardContent>
              </Card>
            ) : null
          }
        />

        <GeneratedValue
          value={
            type?.postAssessmentMessage && !isInProgress ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <GeneratedText id="m_1e17c7577f99c4" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                    <GeneratedValue value={type.postAssessmentMessage} />
                  </p>
                </CardContent>
              </Card>
            ) : null
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>
              <GeneratedText id="m_0bb649d5a9f63f" />
              <GeneratedValue value={results.length} />)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <GeneratedValue
              value={
                results.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    <GeneratedText id="m_0f1106220ddd16" />
                  </p>
                ) : (
                  <form action={submitAction} className="space-y-4">
                    <ol className="space-y-4">
                      <GeneratedValue
                        value={results.map((r, i) => {
                          return (
                            <li
                              key={r.id}
                              className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                                    <GeneratedText id="m_1543089e390910" />
                                    <GeneratedValue value={i + 1} /> ·{' '}
                                    <GeneratedValue value={r.kindSnapshot.replace('_', ' ')} /> ·{' '}
                                    <GeneratedValue value={r.pointsPossible} />
                                    <GeneratedText id="m_07fd31c97533c2" />
                                  </div>
                                  <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                                    <GeneratedValue value={r.promptSnapshot} />
                                  </p>
                                </div>
                                <GeneratedValue
                                  value={
                                    !isInProgress ? (
                                      r.correct === true ? (
                                        <Badge variant="success">
                                          <Check size={12} />{' '}
                                          <GeneratedText id="m_0b8e912869ae1c" />
                                        </Badge>
                                      ) : r.correct === false ? (
                                        <Badge variant="destructive">
                                          <X size={12} /> <GeneratedText id="m_0daff82e544a72" />
                                        </Badge>
                                      ) : (
                                        <Badge variant="outline">
                                          <GeneratedText id="m_1b859977f25898" />
                                        </Badge>
                                      )
                                    ) : null
                                  }
                                />
                              </div>
                              <div className="mt-3">
                                <AnswerInput
                                  resultId={r.id}
                                  kind={r.kindSnapshot}
                                  answer={r.answer}
                                  disabled={!canAct}
                                />
                              </div>
                              {/* The answer key is proctor-only: candidates can retake
                            assessments, so revealing it would let a failed
                            attempt harvest every correct answer. */}
                              <GeneratedValue
                                value={
                                  !isInProgress && isProctor && r.correctAnswerSnapshot ? (
                                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                      <GeneratedText id="m_08f8d29ea3c01e" />
                                      <GeneratedValue value={' '} />
                                      <span className="font-mono">
                                        <GeneratedValue value={r.correctAnswerSnapshot} />
                                      </span>
                                    </p>
                                  ) : null
                                }
                              />
                            </li>
                          )
                        })}
                      />
                    </ol>
                    <GeneratedValue
                      value={
                        canAct ? (
                          <div className="flex items-center justify-between gap-2 pt-2">
                            <button
                              type="submit"
                              formAction={cancelAction}
                              formNoValidate
                              className="inline-flex items-center rounded border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60"
                            >
                              <GeneratedText id="m_1a7698c35ef272" />
                            </button>
                            <Button type="submit">
                              <GeneratedText id="m_1e73dbf5825a68" />
                            </Button>
                          </div>
                        ) : isInProgress ? (
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            <GeneratedText id="m_1f90bbbaef60bc" />
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            <GeneratedText id="m_1c5092a996f3c7" />
                            <GeneratedValue value={' '} />
                            <GeneratedValue
                              value={
                                attempt.completedAt
                                  ? formatDateTime(
                                      new Date(attempt.completedAt),
                                      ctx.timezone,
                                      ctx.locale,
                                    )
                                  : '—'
                              }
                            />
                            .
                          </div>
                        )
                      }
                    />
                  </form>
                )
              }
            />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

/**
 * Render the appropriate input for an answer based on the question kind. Because
 * we snapshot the `kind_snapshot` but not the option-list, we re-parse the
 * options from the originating question only at the type-detail page; here we
 * render a textarea-based fallback for choice questions (the candidate types
 * the option value). This keeps the page server-only with no client JS.
 */
function AnswerInput({
  resultId,
  kind,
  answer,
  disabled,
}: {
  resultId: string
  kind: string
  answer: string | null
  disabled?: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  const name = `answer_${resultId}`
  if (kind === 'text') {
    return (
      <Textarea
        name={name}
        rows={3}
        defaultValue={answer ?? ''}
        disabled={disabled}
        placeholder={tGenerated('m_03679ea3fca4d3')}
      />
    )
  }
  if (kind === 'numeric') {
    return (
      <Input name={name} type="number" step="any" defaultValue={answer ?? ''} disabled={disabled} />
    )
  }
  if (kind === 'true_false') {
    return (
      <Select name={name} defaultValue={answer ?? ''} disabled={disabled}>
        <option value="">
          <GeneratedText id="m_184af7c1f2cebc" />
        </option>
        <option value="true">
          <GeneratedText id="m_135cfc93a0437b" />
        </option>
        <option value="false">
          <GeneratedText id="m_0e0397bd9d7ef3" />
        </option>
      </Select>
    )
  }
  if (kind === 'multi_choice') {
    return (
      <div className="space-y-2">
        <Input
          name={name}
          defaultValue={answer ?? ''}
          disabled={disabled}
          placeholder={tGenerated('m_00800734f33d24')}
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_0202beb2abf5c8" />
        </p>
      </div>
    )
  }
  // single_choice (and fallback)
  return (
    <Input
      name={name}
      defaultValue={answer ?? ''}
      disabled={disabled}
      placeholder={tGenerated('m_0e2e5b38857229')}
    />
  )
}
