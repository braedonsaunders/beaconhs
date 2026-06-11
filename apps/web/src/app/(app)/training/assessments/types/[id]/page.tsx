import Link from 'next/link'
import { notFound } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { CheckCircle, ChevronDown, ChevronUp, Trash2, XCircle } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import {
  trainingAssessmentTypeQuestions,
  trainingAssessmentTypes,
  trainingCourses,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { PageContainer } from '@/components/page-layout'
import { DetailGrid } from '@/components/detail-grid'
import {
  createAssessmentQuestion,
  deleteAssessmentQuestion,
  deleteAssessmentType,
  reorderAssessmentQuestion,
  updateAssessmentQuestion,
  updateAssessmentType,
} from '../../../_actions/assessment-types'

export const dynamic = 'force-dynamic'

const KIND_LABELS: Record<string, string> = {
  text: 'Free text',
  single_choice: 'Single choice',
  multi_choice: 'Multi choice',
  numeric: 'Numeric',
  true_false: 'True / false',
}

export default async function AssessmentTypeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireModuleManage('training')

  const data = await ctx.db(async (tx) => {
    const [type] = await tx
      .select()
      .from(trainingAssessmentTypes)
      .where(eq(trainingAssessmentTypes.id, id))
      .limit(1)
    if (!type) return null
    const [course] = type.courseId
      ? await tx
          .select()
          .from(trainingCourses)
          .where(eq(trainingCourses.id, type.courseId))
          .limit(1)
      : [null]
    const questions = await tx
      .select()
      .from(trainingAssessmentTypeQuestions)
      .where(eq(trainingAssessmentTypeQuestions.typeId, id))
      .orderBy(asc(trainingAssessmentTypeQuestions.entityOrder))
    const courses = await tx.select().from(trainingCourses).orderBy(asc(trainingCourses.name))
    return { type, course, questions, courses }
  })

  if (!data) notFound()
  const { type, course, questions, courses } = data
  const updateAction = updateAssessmentType.bind(null, id)
  const deleteAction = deleteAssessmentType.bind(null, id)
  const createQuestionAction = createAssessmentQuestion.bind(null, id)

  return (
    <PageContainer>
      <div className="space-y-6">
        <DetailHeader
          back={{
            href: '/training/assessments/types',
            label: 'Back to assessment types',
          }}
          title={type.name}
          subtitle={course ? `Linked to ${course.code} · ${course.name}` : 'No course linked'}
          badge={
            type.active ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="secondary">Inactive</Badge>
            )
          }
        />

        <DetailGrid
          rows={[
            { label: 'Passing score', value: `${type.passingScore}%` },
            { label: 'Graded', value: type.graded ? 'Yes' : 'No' },
            { label: 'Questions', value: String(questions.length) },
            { label: 'Linked course', value: course ? course.name : '—' },
            {
              label: 'Points possible',
              value: String(questions.reduce((s, q) => s + (q.points ?? 1), 0)),
            },
          ]}
        />

        {/* Edit form */}
        <Card>
          <CardHeader>
            <CardTitle>Edit details</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateAction} className="space-y-4">
              <Field label="Name" required>
                <Input name="name" required defaultValue={type.name} />
              </Field>
              <Field label="Description">
                <Textarea name="description" rows={3} defaultValue={type.description ?? ''} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Passing score (%)" required>
                  <Input
                    name="passingScore"
                    type="number"
                    min={0}
                    max={100}
                    required
                    defaultValue={type.passingScore}
                  />
                </Field>
                <Field label="Linked course">
                  <Select name="courseId" defaultValue={type.courseId ?? '__none__'}>
                    <option value="__none__">— No course —</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Pre-assessment message">
                <Textarea
                  name="preAssessmentMessage"
                  rows={2}
                  defaultValue={type.preAssessmentMessage ?? ''}
                />
              </Field>
              <Field label="Post-assessment message">
                <Textarea
                  name="postAssessmentMessage"
                  rows={2}
                  defaultValue={type.postAssessmentMessage ?? ''}
                />
              </Field>
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="graded" defaultChecked={type.graded} />
                  Graded
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={type.active} />
                  Active
                </label>
              </div>
              <div className="flex items-center justify-end">
                <Button type="submit">Save changes</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Questions */}
        <Card>
          <CardHeader>
            <CardTitle>Questions ({questions.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {questions.length === 0 ? (
              <p className="text-sm text-slate-500">
                No questions yet. Add the first one using the form below.
              </p>
            ) : (
              <ol className="space-y-3">
                {questions.map((q, i) => {
                  const updateQ = updateAssessmentQuestion.bind(null, id, q.id)
                  const deleteQ = deleteAssessmentQuestion.bind(null, id, q.id)
                  const reorderUp = reorderAssessmentQuestion.bind(null, id, q.id, 'up')
                  const reorderDown = reorderAssessmentQuestion.bind(null, id, q.id, 'down')
                  const opts = Array.isArray(q.options) ? q.options : []
                  return (
                    <li key={q.id} className="rounded-lg border border-slate-200 bg-white p-3">
                      <details>
                        <summary className="flex cursor-pointer items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-700">
                              {i + 1}
                            </span>
                            <span className="truncate font-medium text-slate-900">{q.prompt}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <Badge variant="secondary">{KIND_LABELS[q.kind] ?? q.kind}</Badge>
                            <Badge variant="outline">{q.points} pt</Badge>
                            <form action={reorderUp}>
                              <button
                                type="submit"
                                disabled={i === 0}
                                className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                                aria-label="Move up"
                              >
                                <ChevronUp size={14} />
                              </button>
                            </form>
                            <form action={reorderDown}>
                              <button
                                type="submit"
                                disabled={i === questions.length - 1}
                                className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                                aria-label="Move down"
                              >
                                <ChevronDown size={14} />
                              </button>
                            </form>
                          </span>
                        </summary>

                        <form action={updateQ} className="mt-4 space-y-3">
                          <Field label="Prompt" required>
                            <Textarea name="prompt" rows={2} required defaultValue={q.prompt} />
                          </Field>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <Field label="Kind">
                              <Select name="kind" defaultValue={q.kind}>
                                {Object.entries(KIND_LABELS).map(([v, lbl]) => (
                                  <option key={v} value={v}>
                                    {lbl}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <Field label="Points">
                              <Input name="points" type="number" min={1} defaultValue={q.points} />
                            </Field>
                            <div className="flex items-end">
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  name="mandatory"
                                  defaultChecked={q.mandatory}
                                />
                                Mandatory
                              </label>
                            </div>
                          </div>
                          {(q.kind === 'single_choice' || q.kind === 'multi_choice') && (
                            <Field label="Options (one per line)">
                              <Textarea
                                name="options"
                                rows={4}
                                defaultValue={opts.map((o) => o.label ?? o.value).join('\n')}
                                placeholder="One per line. Use the auto-assigned letters (A, B, C…) as the correct-answer value."
                              />
                            </Field>
                          )}
                          <Field label="Correct answer">
                            {q.kind === 'true_false' ? (
                              <Select name="correctAnswer" defaultValue={q.correctAnswer ?? 'true'}>
                                <option value="true">True</option>
                                <option value="false">False</option>
                              </Select>
                            ) : q.kind === 'text' ? (
                              <Input
                                name="correctAnswer"
                                disabled
                                placeholder="Free text — graded by reviewer"
                              />
                            ) : q.kind === 'multi_choice' ? (
                              <Input
                                name="correctAnswer"
                                defaultValue={q.correctAnswer ?? ''}
                                placeholder='Comma-separated, e.g. "A,C"'
                              />
                            ) : (
                              <Input
                                name="correctAnswer"
                                defaultValue={q.correctAnswer ?? ''}
                                placeholder={q.kind === 'numeric' ? '42' : 'A'}
                              />
                            )}
                          </Field>
                          <Field label="Help text">
                            <Input name="helpText" defaultValue={q.helpText ?? ''} />
                          </Field>
                          <div className="flex items-center justify-between">
                            <form action={deleteQ}>
                              <button
                                type="submit"
                                className="inline-flex items-center gap-1 rounded text-xs text-red-600 hover:underline"
                              >
                                <Trash2 size={12} /> Delete question
                              </button>
                            </form>
                            <Button type="submit" size="sm">
                              Save question
                            </Button>
                          </div>
                        </form>
                      </details>
                    </li>
                  )
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Add question */}
        <Card>
          <CardHeader>
            <CardTitle>Add question</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createQuestionAction} className="space-y-3">
              <Field label="Prompt" required>
                <Textarea
                  name="prompt"
                  rows={2}
                  required
                  placeholder="e.g. What does WHMIS stand for?"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Kind">
                  <Select name="kind" defaultValue="single_choice">
                    {Object.entries(KIND_LABELS).map(([v, lbl]) => (
                      <option key={v} value={v}>
                        {lbl}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Points">
                  <Input name="points" type="number" min={1} defaultValue={1} />
                </Field>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="mandatory" defaultChecked />
                    Mandatory
                  </label>
                </div>
              </div>
              <Field label="Options (one per line — for single/multi choice)">
                <Textarea
                  name="options"
                  rows={3}
                  placeholder="Workplace Hazardous Materials Information System&#10;Work Hazard Management Information System&#10;Workshop Hazard Material Inspection System"
                />
              </Field>
              <Field label="Correct answer">
                <Input
                  name="correctAnswer"
                  placeholder='e.g. "A" or "A,C" for multi-choice, "true" for true/false, "42" for numeric.'
                />
              </Field>
              <Field label="Help text">
                <Input name="helpText" placeholder="Optional hint shown to candidate." />
              </Field>
              <div className="flex justify-end">
                <Button type="submit">Add question</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Quick start attempt */}
        <Card>
          <CardHeader>
            <CardTitle>Take this assessment</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-500">
              Start a new attempt for someone — they'll be redirected straight to the question
              sheet.
            </p>
            <div className="mt-3">
              <Link
                href={{
                  pathname: '/training/assessments/new',
                  query: { typeId: type.id },
                }}
              >
                <Button>Start an attempt</Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Danger zone */}
        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={deleteAction}>
              <p className="mb-2 text-xs text-slate-500">
                Soft-deletes the assessment type. Existing attempts remain auditable.
              </p>
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
              >
                <XCircle size={14} /> Delete assessment type
              </button>
            </form>
          </CardContent>
        </Card>

        <p className="flex items-center gap-1 text-xs text-slate-400">
          <CheckCircle size={12} /> Saved updates persist immediately.
        </p>
      </div>
    </PageContainer>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
