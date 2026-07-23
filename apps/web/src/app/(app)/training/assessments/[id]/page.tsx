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
import { formatDate, formatDateTime } from '@/lib/datetime'
import { canSeeRecord } from '@/lib/visibility'
import { PageContainer } from '@/components/page-layout'
import { DetailGrid } from '@/components/detail-grid'
import { isUuid } from '@/lib/list-params'
import {
  cancelAssessmentAttempt,
  reviewAssessmentAttempt,
  submitAssessmentAttempt,
} from '../../_actions/assessments'

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
  const isMigratedLegacy = attempt.notes?.startsWith('Migrated legacy quiz attempt.') ?? false

  const isInProgress = attempt.status === 'in_progress'
  const isAwaitingReview = isInProgress && attempt.reviewStatus === 'pending'
  const isAnswering = isInProgress && !isAwaitingReview
  // Only the candidate (or a proctor) may record answers / submit / cancel —
  // mirrors the ownership checks in the server actions, so a read.all viewer
  // gets a read-only sheet instead of controls that would be rejected on POST.
  const canAct = isAnswering && (isMine || isProctor)
  const submitAction = submitAssessmentAttempt.bind(null, attempt.id)
  const reviewAction = reviewAssessmentAttempt.bind(null, attempt.id)
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
            isAwaitingReview ? (
              <Badge variant="warning">
                <GeneratedValue value="Awaiting review" />
              </Badge>
            ) : attempt.status === 'in_progress' ? (
              <Badge variant="secondary">
                <GeneratedText id="m_1a03b06872ffd9" />
              </Badge>
            ) : attempt.status === 'cancelled' ? (
              <Badge variant="outline">
                <GeneratedText id="m_1a7e1cf2be443e" />
              </Badge>
            ) : !attempt.graded ? (
              <Badge variant="success">
                <GeneratedValue value="Completed" />
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
            ...(attempt.graded
              ? [
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
                ]
              : [{ label: 'Assessment mode', value: 'Completion only' }]),
            {
              label: 'Started',
              value: attempt.startedAt
                ? formatDateTime(new Date(attempt.startedAt), ctx.timezone, ctx.locale)
                : '—',
            },
            {
              label: 'Completed',
              value: attempt.completedAt
                ? isMigratedLegacy
                  ? formatDate(new Date(attempt.completedAt), ctx.timezone, ctx.locale)
                  : formatDateTime(new Date(attempt.completedAt), ctx.timezone, ctx.locale)
                : '—',
            },
          ]}
        />

        <GeneratedValue
          value={
            type?.preAssessmentMessage && isAnswering ? (
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
            type?.postAssessmentMessage && attempt.status === 'submitted' ? (
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
                                  <GeneratedValue
                                    value={
                                      r.helpTextSnapshot ? (
                                        <p className="mt-1 text-xs whitespace-pre-wrap text-slate-500 dark:text-slate-400">
                                          <GeneratedValue value={r.helpTextSnapshot} />
                                        </p>
                                      ) : null
                                    }
                                  />
                                </div>
                                <GeneratedValue
                                  value={
                                    attempt.status === 'submitted' ? (
                                      !attempt.graded ? (
                                        <Badge variant="outline">
                                          <GeneratedValue value="Recorded" />
                                        </Badge>
                                      ) : r.kindSnapshot === 'text' ? (
                                        <Badge variant="secondary">
                                          <GeneratedValue value={r.pointsAwarded} /> /{' '}
                                          <GeneratedValue value={r.pointsPossible} />{' '}
                                          <GeneratedValue value="points" />
                                        </Badge>
                                      ) : r.correct === true ? (
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
                                    ) : isAwaitingReview ? (
                                      <Badge variant="warning">
                                        <GeneratedValue value="Awaiting review" />
                                      </Badge>
                                    ) : null
                                  }
                                />
                              </div>
                              <div className="mt-3">
                                <AnswerInput
                                  resultId={r.id}
                                  kind={r.kindSnapshot}
                                  options={r.optionsSnapshot}
                                  answer={r.answer}
                                  mandatory={r.mandatorySnapshot}
                                  disabled={!canAct}
                                />
                              </div>
                              {/* The answer key is proctor-only: candidates can retake
                            assessments, so revealing it would let a failed
                            attempt harvest every correct answer. */}
                              <GeneratedValue
                                value={
                                  attempt.status === 'submitted' &&
                                  attempt.graded &&
                                  r.kindSnapshot !== 'text' &&
                                  isProctor &&
                                  r.correctAnswerSnapshot ? (
                                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                      <GeneratedText id="m_08f8d29ea3c01e" />
                                      <GeneratedValue value={' '} />
                                      <span className="font-mono">
                                        <GeneratedValue
                                          value={formatChoiceAnswer(
                                            r.correctAnswerSnapshot,
                                            r.optionsSnapshot,
                                          )}
                                        />
                                      </span>
                                    </p>
                                  ) : null
                                }
                              />
                              <GeneratedValue
                                value={
                                  r.reviewNotes ? (
                                    <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                                      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                        <GeneratedValue value="Reviewer notes" />
                                      </div>
                                      <p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-200">
                                        <GeneratedValue value={r.reviewNotes} />
                                      </p>
                                    </div>
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
                              <GeneratedValue
                                value={
                                  attempt.graded ? 'Submit for grading' : 'Complete assessment'
                                }
                              />
                            </Button>
                          </div>
                        ) : isAwaitingReview ? (
                          <div className="text-xs text-amber-700 dark:text-amber-300">
                            <GeneratedValue value="Answers are locked and awaiting review by training staff." />
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
                                  ? isMigratedLegacy
                                    ? formatDate(
                                        new Date(attempt.completedAt),
                                        ctx.timezone,
                                        ctx.locale,
                                      )
                                    : formatDateTime(
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

        <GeneratedValue
          value={
            isAwaitingReview && isProctor ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <GeneratedValue value="Manual review" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form action={reviewAction} className="space-y-5">
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      <GeneratedValue value="Award whole-number points for each submitted free-text answer. The final score and pass or fail result are calculated when you complete the review." />
                    </p>
                    <GeneratedValue
                      value={results
                        .filter(
                          (result) => result.kindSnapshot === 'text' && result.answer !== null,
                        )
                        .map((result) => (
                          <div
                            key={result.id}
                            className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800"
                          >
                            <div>
                              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                <GeneratedValue value={result.promptSnapshot} />
                              </p>
                              <p className="mt-2 rounded-md bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                                <GeneratedValue value={result.answer} />
                              </p>
                            </div>
                            <label className="block space-y-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                              <span>
                                <GeneratedValue value="Points awarded" /> ({'0–'}
                                <GeneratedValue value={result.pointsPossible} />)
                              </span>
                              <Input
                                name={`points_${result.id}`}
                                type="number"
                                min={0}
                                max={result.pointsPossible}
                                step={1}
                                defaultValue={result.pointsAwarded}
                                required
                              />
                            </label>
                            <label className="block space-y-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                              <span>
                                <GeneratedValue value="Review notes (optional)" />
                              </span>
                              <Textarea
                                name={`reviewNotes_${result.id}`}
                                rows={3}
                                maxLength={2000}
                                defaultValue={result.reviewNotes ?? ''}
                              />
                            </label>
                          </div>
                        ))}
                    />
                    <div className="flex justify-end">
                      <Button type="submit">
                        <GeneratedValue value="Complete review" />
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            ) : null
          }
        />
      </div>
    </PageContainer>
  )
}

type ChoiceOption = { value: string; label: string }

function validChoiceOptions(options: unknown): ChoiceOption[] {
  if (!Array.isArray(options)) return []
  return options.filter(
    (option): option is ChoiceOption =>
      option != null &&
      typeof option === 'object' &&
      'value' in option &&
      typeof option.value === 'string' &&
      'label' in option &&
      typeof option.label === 'string',
  )
}

function formatChoiceAnswer(answer: string, options: unknown): string {
  const choices = validChoiceOptions(options)
  if (choices.length === 0) return answer
  const labels = new Map(choices.map((option) => [option.value, option.label]))
  return answer
    .split(',')
    .map((value) => labels.get(value.trim()) ?? value.trim())
    .filter(Boolean)
    .join(', ')
}

function AnswerInput({
  resultId,
  kind,
  options,
  answer,
  mandatory,
  disabled,
}: {
  resultId: string
  kind: string
  options: unknown
  answer: string | null
  mandatory: boolean
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
        required={mandatory}
        placeholder={tGenerated('m_03679ea3fca4d3')}
      />
    )
  }
  if (kind === 'numeric') {
    return (
      <Input
        name={name}
        type="number"
        step="any"
        defaultValue={answer ?? ''}
        disabled={disabled}
        required={mandatory}
      />
    )
  }
  if (kind === 'true_false') {
    return (
      <Select name={name} defaultValue={answer ?? ''} disabled={disabled} required={mandatory}>
        <option value="">{'— Pick one —'}</option>
        <option value="true">{'True'}</option>
        <option value="false">{'False'}</option>
      </Select>
    )
  }
  const choices = validChoiceOptions(options)
  if (kind === 'single_choice' || kind === 'multi_choice') {
    if (choices.length === 0) {
      return (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          <GeneratedText id="m_0988b671c7f65b" />
        </p>
      )
    }
    const selected = new Set(
      (answer ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    )
    return (
      <fieldset
        className="space-y-2"
        aria-label={tGenerated(kind === 'single_choice' ? 'm_17ca695e06a9f9' : 'm_09bbeb80f7afa2')}
      >
        {choices.map((option, index) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 transition-colors hover:bg-slate-50 has-[:checked]:border-sky-500 has-[:checked]:bg-sky-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900 dark:has-[:checked]:border-sky-500 dark:has-[:checked]:bg-sky-950/40"
          >
            <input
              type={kind === 'single_choice' ? 'radio' : 'checkbox'}
              name={name}
              value={option.value}
              defaultChecked={selected.has(option.value)}
              disabled={disabled}
              required={kind === 'single_choice' && mandatory}
              className="mt-0.5 h-4 w-4 shrink-0 accent-sky-600"
            />
            <span>
              <span className="mr-2 font-medium text-slate-500 dark:text-slate-400">
                {String.fromCharCode(65 + index)}.
              </span>
              {option.label}
            </span>
          </label>
        ))}
        {kind === 'multi_choice' ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_0ab7550e21edbf" />
          </p>
        ) : null}
      </fieldset>
    )
  }
  return null
}
