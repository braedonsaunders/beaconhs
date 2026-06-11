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
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { DetailGrid } from '@/components/detail-grid'
import { cancelAssessmentAttempt, submitAssessmentAttempt } from '../../_actions/assessments'

export const dynamic = 'force-dynamic'

export default async function AssessmentAttemptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(trainingAssessments)
      .where(eq(trainingAssessments.id, id))
      .limit(1)
    if (!attempt) return null
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
    return { attempt, type, person, course, results }
  })

  if (!data) notFound()
  const { attempt, type, person, course, results } = data

  const isInProgress = attempt.status === 'in_progress'
  const submitAction = submitAssessmentAttempt.bind(null, attempt.id)
  const cancelAction = cancelAssessmentAttempt.bind(null, attempt.id)

  return (
    <PageContainer>
      <div className="space-y-6">
        <DetailHeader
          back={{ href: '/training/assessments', label: 'Back to assessments' }}
          title={type?.name ?? 'Assessment'}
          subtitle={person ? `${person.firstName} ${person.lastName}` : 'Unknown person'}
          badge={
            attempt.status === 'in_progress' ? (
              <Badge variant="secondary">In progress</Badge>
            ) : attempt.status === 'cancelled' ? (
              <Badge variant="outline">Cancelled</Badge>
            ) : attempt.passed ? (
              <Badge variant="success">Pass</Badge>
            ) : (
              <Badge variant="destructive">Fail</Badge>
            )
          }
          actions={
            attempt.status === 'submitted' && attempt.passed ? (
              <Link href={`/training/assessments/${attempt.id}/certificate`}>
                <Button variant="outline">
                  <Award size={14} /> View certificate
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
              value: attempt.startedAt ? new Date(attempt.startedAt).toLocaleString() : '—',
            },
            {
              label: 'Completed',
              value: attempt.completedAt ? new Date(attempt.completedAt).toLocaleString() : '—',
            },
          ]}
        />

        {type?.preAssessmentMessage && isInProgress ? (
          <Card>
            <CardHeader>
              <CardTitle>Instructions</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap text-slate-700">
                {type.preAssessmentMessage}
              </p>
            </CardContent>
          </Card>
        ) : null}

        {type?.postAssessmentMessage && !isInProgress ? (
          <Card>
            <CardHeader>
              <CardTitle>Result message</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap text-slate-700">
                {type.postAssessmentMessage}
              </p>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Questions ({results.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {results.length === 0 ? (
              <p className="text-sm text-slate-500">No questions on this attempt.</p>
            ) : (
              <form action={submitAction} className="space-y-4">
                <ol className="space-y-4">
                  {results.map((r, i) => {
                    const opts = parseSnapshotOptions(r.kindSnapshot)
                    return (
                      <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs tracking-wide text-slate-500 uppercase">
                              Q{i + 1} · {r.kindSnapshot.replace('_', ' ')} · {r.pointsPossible}
                              pt
                            </div>
                            <p className="mt-1 text-sm font-medium text-slate-900">
                              {r.promptSnapshot}
                            </p>
                          </div>
                          {!isInProgress ? (
                            r.correct === true ? (
                              <Badge variant="success">
                                <Check size={12} /> Correct
                              </Badge>
                            ) : r.correct === false ? (
                              <Badge variant="destructive">
                                <X size={12} /> Incorrect
                              </Badge>
                            ) : (
                              <Badge variant="outline">N/A</Badge>
                            )
                          ) : null}
                        </div>
                        <div className="mt-3">
                          <AnswerInput
                            resultId={r.id}
                            kind={r.kindSnapshot}
                            answer={r.answer}
                            options={opts}
                            disabled={!isInProgress}
                          />
                        </div>
                        {!isInProgress && r.correctAnswerSnapshot ? (
                          <p className="mt-2 text-xs text-slate-500">
                            Correct answer:{' '}
                            <span className="font-mono">{r.correctAnswerSnapshot}</span>
                          </p>
                        ) : null}
                      </li>
                    )
                  })}
                </ol>
                {isInProgress ? (
                  <div className="flex items-center justify-between gap-2 pt-2">
                    <button
                      type="submit"
                      formAction={cancelAction}
                      formNoValidate
                      className="inline-flex items-center rounded border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Cancel attempt
                    </button>
                    <Button type="submit">Submit for grading</Button>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">
                    This attempt is locked. Submitted at{' '}
                    {attempt.completedAt ? new Date(attempt.completedAt).toLocaleString() : '—'}.
                  </div>
                )}
              </form>
            )}
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
  options: unknown
  disabled?: boolean
}) {
  const name = `answer_${resultId}`
  if (kind === 'text') {
    return (
      <Textarea
        name={name}
        rows={3}
        defaultValue={answer ?? ''}
        disabled={disabled}
        placeholder="Free-form answer (reviewed manually)…"
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
        <option value="">— Pick one —</option>
        <option value="true">True</option>
        <option value="false">False</option>
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
          placeholder='Comma-separated, e.g. "A,C"'
        />
        <p className="text-xs text-slate-500">
          Enter the letter values of every correct option, separated by commas.
        </p>
      </div>
    )
  }
  // single_choice (and fallback)
  return (
    <Input name={name} defaultValue={answer ?? ''} disabled={disabled} placeholder='e.g. "A"' />
  )
}

function parseSnapshotOptions(_kind: string): null {
  // We don't snapshot options on the result row (they live on the type's
  // question). For the in-attempt view the candidate types the letter
  // directly; a richer client-side multi-step UI can plug in later.
  return null
}
