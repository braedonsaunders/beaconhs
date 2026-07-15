import { getGeneratedValueTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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
import { isUuid } from '@/lib/list-params'
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

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
          title={tGeneratedValue(type.name)}
          subtitle={tGeneratedValue(
            course
              ? tGenerated('m_064a934398b9f2', { value0: course.code, value1: course.name })
              : tGenerated('m_14d479873061dd'),
          )}
          badge={
            type.active ? (
              <Badge variant="success">
                <GeneratedText id="m_1e1b1fdb7dd78e" />
              </Badge>
            ) : (
              <Badge variant="secondary">
                <GeneratedText id="m_0f47ea07c99dba" />
              </Badge>
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
            <CardTitle>
              <GeneratedText id="m_09ff2b2cb08089" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateAction} className="space-y-4">
              <Field label={tGenerated('m_02b18d5c7f6f2d')} required>
                <Input name="name" required defaultValue={type.name} />
              </Field>
              <Field label={tGenerated('m_14d923495cf14c')}>
                <Textarea name="description" rows={3} defaultValue={type.description ?? ''} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={tGenerated('m_0eb4d25aca9afd')} required>
                  <Input
                    name="passingScore"
                    type="number"
                    min={0}
                    max={100}
                    required
                    defaultValue={type.passingScore}
                  />
                </Field>
                <Field label={tGenerated('m_0a4456ce9a12f5')}>
                  <Select name="courseId" defaultValue={type.courseId ?? '__none__'}>
                    <option value="__none__">
                      <GeneratedText id="m_14e7dba9bb1899" />
                    </option>
                    <GeneratedValue
                      value={courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          <GeneratedValue value={c.code} /> · <GeneratedValue value={c.name} />
                        </option>
                      ))}
                    />
                  </Select>
                </Field>
              </div>
              <Field label={tGenerated('m_1163296e41f5dc')}>
                <Textarea
                  name="preAssessmentMessage"
                  rows={2}
                  defaultValue={type.preAssessmentMessage ?? ''}
                />
              </Field>
              <Field label={tGenerated('m_10c927b1f443a8')}>
                <Textarea
                  name="postAssessmentMessage"
                  rows={2}
                  defaultValue={type.postAssessmentMessage ?? ''}
                />
              </Field>
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="graded" defaultChecked={type.graded} />
                  <GeneratedText id="m_05407ee4fbb68c" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={type.active} />
                  <GeneratedText id="m_1e1b1fdb7dd78e" />
                </label>
              </div>
              <div className="flex items-center justify-end">
                <Button type="submit">
                  <GeneratedText id="m_1ab9025ed1067c" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Questions */}
        <Card>
          <CardHeader>
            <CardTitle>
              <GeneratedText id="m_0bb649d5a9f63f" />
              <GeneratedValue value={questions.length} />)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <GeneratedValue
              value={
                questions.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    <GeneratedText id="m_02d79d5222b71e" />
                  </p>
                ) : (
                  <ol className="space-y-3">
                    <GeneratedValue
                      value={questions.map((q, i) => {
                        const updateQ = updateAssessmentQuestion.bind(null, id, q.id)
                        const deleteQ = deleteAssessmentQuestion.bind(null, id, q.id)
                        const reorderUp = reorderAssessmentQuestion.bind(null, id, q.id, 'up')
                        const reorderDown = reorderAssessmentQuestion.bind(null, id, q.id, 'down')
                        const opts = Array.isArray(q.options) ? q.options : []
                        return (
                          <li
                            key={q.id}
                            className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                          >
                            <details>
                              <summary className="flex cursor-pointer items-center justify-between gap-3">
                                <span className="flex min-w-0 items-center gap-2">
                                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                    <GeneratedValue value={i + 1} />
                                  </span>
                                  <span className="truncate font-medium text-slate-900 dark:text-slate-100">
                                    <GeneratedValue value={q.prompt} />
                                  </span>
                                </span>
                                <span className="flex shrink-0 items-center gap-2">
                                  <Badge variant="secondary">
                                    <GeneratedValue value={KIND_LABELS[q.kind] ?? q.kind} />
                                  </Badge>
                                  <Badge variant="outline">
                                    <GeneratedValue value={q.points} />{' '}
                                    <GeneratedText id="m_07fd31c97533c2" />
                                  </Badge>
                                  <form action={reorderUp}>
                                    <button
                                      type="submit"
                                      disabled={i === 0}
                                      className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
                                      aria-label={tGenerated('m_1ec1460770eaa0')}
                                    >
                                      <ChevronUp size={14} />
                                    </button>
                                  </form>
                                  <form action={reorderDown}>
                                    <button
                                      type="submit"
                                      disabled={i === questions.length - 1}
                                      className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
                                      aria-label={tGenerated('m_14ab8cefda3cf9')}
                                    >
                                      <ChevronDown size={14} />
                                    </button>
                                  </form>
                                </span>
                              </summary>

                              <form action={updateQ} className="mt-4 space-y-3">
                                <Field label={tGenerated('m_037b038ea4c73d')} required>
                                  <Textarea
                                    name="prompt"
                                    rows={2}
                                    required
                                    defaultValue={q.prompt}
                                  />
                                </Field>
                                <div className="grid gap-3 sm:grid-cols-3">
                                  <Field label={tGenerated('m_1e578efe1574cd')}>
                                    <Select name="kind" defaultValue={q.kind}>
                                      <GeneratedValue
                                        value={Object.entries(KIND_LABELS).map(([v, lbl]) => (
                                          <option key={v} value={v}>
                                            <GeneratedValue value={lbl} />
                                          </option>
                                        ))}
                                      />
                                    </Select>
                                  </Field>
                                  <Field label={tGenerated('m_08e7a76c4ab77f')}>
                                    <Input
                                      name="points"
                                      type="number"
                                      min={1}
                                      defaultValue={q.points}
                                    />
                                  </Field>
                                  <div className="flex items-end">
                                    <label className="flex items-center gap-2 text-sm">
                                      <input
                                        type="checkbox"
                                        name="mandatory"
                                        defaultChecked={q.mandatory}
                                      />
                                      <GeneratedText id="m_1587a996068e95" />
                                    </label>
                                  </div>
                                </div>
                                <GeneratedValue
                                  value={
                                    (q.kind === 'single_choice' || q.kind === 'multi_choice') && (
                                      <Field label={tGenerated('m_02057adc77a443')}>
                                        <Textarea
                                          name="options"
                                          rows={4}
                                          defaultValue={opts
                                            .map((o) => o.label ?? o.value)
                                            .join('\n')}
                                          placeholder={tGenerated('m_030250571e98a8')}
                                        />
                                      </Field>
                                    )
                                  }
                                />
                                <Field label={tGenerated('m_101746dffd63c7')}>
                                  <GeneratedValue
                                    value={
                                      q.kind === 'true_false' ? (
                                        <Select
                                          name="correctAnswer"
                                          defaultValue={q.correctAnswer ?? 'true'}
                                        >
                                          <option value="true">
                                            <GeneratedText id="m_135cfc93a0437b" />
                                          </option>
                                          <option value="false">
                                            <GeneratedText id="m_0e0397bd9d7ef3" />
                                          </option>
                                        </Select>
                                      ) : q.kind === 'text' ? (
                                        <Input
                                          name="correctAnswer"
                                          disabled
                                          placeholder={tGenerated('m_083d1aea0ddc19')}
                                        />
                                      ) : q.kind === 'multi_choice' ? (
                                        <Input
                                          name="correctAnswer"
                                          defaultValue={q.correctAnswer ?? ''}
                                          placeholder={tGenerated('m_00800734f33d24')}
                                        />
                                      ) : (
                                        <Input
                                          name="correctAnswer"
                                          defaultValue={q.correctAnswer ?? ''}
                                          placeholder={tGeneratedValue(
                                            q.kind === 'numeric'
                                              ? '42'
                                              : tGenerated('m_0fc47ff46a017d'),
                                          )}
                                        />
                                      )
                                    }
                                  />
                                </Field>
                                <Field label={tGenerated('m_0d04877b1a742b')}>
                                  <Input name="helpText" defaultValue={q.helpText ?? ''} />
                                </Field>
                                <div className="flex items-center justify-between">
                                  <form action={deleteQ}>
                                    <button
                                      type="submit"
                                      className="inline-flex items-center gap-1 rounded text-xs text-red-600 hover:underline dark:text-red-400"
                                    >
                                      <Trash2 size={12} /> <GeneratedText id="m_1a1217e160d913" />
                                    </button>
                                  </form>
                                  <Button type="submit" size="sm">
                                    <GeneratedText id="m_0a471ad7911858" />
                                  </Button>
                                </div>
                              </form>
                            </details>
                          </li>
                        )
                      })}
                    />
                  </ol>
                )
              }
            />
          </CardContent>
        </Card>

        {/* Add question */}
        <Card>
          <CardHeader>
            <CardTitle>
              <GeneratedText id="m_029dffafbff34b" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createQuestionAction} className="space-y-3">
              <Field label={tGenerated('m_037b038ea4c73d')} required>
                <Textarea
                  name="prompt"
                  rows={2}
                  required
                  placeholder={tGenerated('m_01d746a3541de3')}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={tGenerated('m_1e578efe1574cd')}>
                  <Select name="kind" defaultValue="single_choice">
                    <GeneratedValue
                      value={Object.entries(KIND_LABELS).map(([v, lbl]) => (
                        <option key={v} value={v}>
                          <GeneratedValue value={lbl} />
                        </option>
                      ))}
                    />
                  </Select>
                </Field>
                <Field label={tGenerated('m_08e7a76c4ab77f')}>
                  <Input name="points" type="number" min={1} defaultValue={1} />
                </Field>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="mandatory" defaultChecked />
                    <GeneratedText id="m_1587a996068e95" />
                  </label>
                </div>
              </div>
              <Field label={tGenerated('m_0746adb96dc7af')}>
                <Textarea name="options" rows={3} placeholder={tGenerated('m_0189e54a2678da')} />
              </Field>
              <Field label={tGenerated('m_101746dffd63c7')}>
                <Input name="correctAnswer" placeholder={tGenerated('m_12ede7feee675d')} />
              </Field>
              <Field label={tGenerated('m_0d04877b1a742b')}>
                <Input name="helpText" placeholder={tGenerated('m_00ae208ebecbcf')} />
              </Field>
              <div className="flex justify-end">
                <Button type="submit">
                  <GeneratedText id="m_029dffafbff34b" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Quick start attempt */}
        <Card>
          <CardHeader>
            <CardTitle>
              <GeneratedText id="m_0b6f635f7576aa" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              <GeneratedText id="m_0738ebb711a272" />
            </p>
            <div className="mt-3">
              <Link
                href={{
                  pathname: '/training/assessments/new',
                  query: { typeId: type.id },
                }}
              >
                <Button>
                  <GeneratedText id="m_183bea0becf504" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Danger zone */}
        <Card>
          <CardHeader>
            <CardTitle>
              <GeneratedText id="m_024e9c1e0bab8f" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={deleteAction}>
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_19ef758a861031" />
              </p>
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 dark:text-red-400"
              >
                <XCircle size={14} /> <GeneratedText id="m_0c1907b9a5392f" />
              </button>
            </form>
          </CardContent>
        </Card>

        <p className="flex items-center gap-1 text-xs text-slate-400">
          <CheckCircle size={12} /> <GeneratedText id="m_002ad5971ddcd7" />
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
        <GeneratedValue value={label} />
        <GeneratedValue
          value={required ? <span className="text-red-600 dark:text-red-400"> *</span> : null}
        />
      </Label>
      <GeneratedValue value={children} />
    </div>
  )
}
