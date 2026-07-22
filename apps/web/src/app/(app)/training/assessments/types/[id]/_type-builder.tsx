'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardCheck, Plus, Save, Trash2 } from 'lucide-react'
import { Badge, Button, Drawer, Input, Label, Select, Textarea } from '@beaconhs/ui'
import {
  GeneratedText,
  GeneratedValue,
  useGeneratedTranslations,
  useGeneratedValueTranslations,
} from '@/i18n/generated'
import { toast } from '@/lib/toast'
import {
  BuilderRailHeader,
  BuilderRailNavigation,
  BuilderScroll,
  BuilderShell,
  BuilderSurfaceHeader,
} from '@/components/builder/builder-shell'
import {
  BuilderDangerZone,
  useBuilderActionRunner,
  useConfirmedBuilderDelete,
} from '@/components/builder/checklist-builder'
import { SortableList, SortableRow, useDebouncedCallback } from '@/components/builder/sortable-list'
import {
  createAssessmentQuestion,
  deleteAssessmentQuestion,
  deleteAssessmentType,
  reorderAssessmentQuestions,
  updateAssessmentQuestion,
  updateAssessmentType,
} from '../../../_actions/assessment-types'

const KIND_LABELS: Record<string, string> = {
  text: 'Free text',
  single_choice: 'Single choice',
  multi_choice: 'Multi choice',
  numeric: 'Numeric',
  true_false: 'True / false',
}

type AssessmentType = {
  id: string
  name: string
  description: string | null
  passingScore: number
  courseId: string | null
  preAssessmentMessage: string | null
  postAssessmentMessage: string | null
  graded: boolean
  active: boolean
}
type CourseOption = { id: string; name: string; code: string }
type Question = {
  id: string
  prompt: string
  kind: string
  options: unknown
  correctAnswer: string | null
  helpText: string | null
  points: number
  mandatory: boolean
  entityOrder: number
}
type ChoiceOption = { value: string; label: string }

function questionChoiceOptions(question: Question | null): ChoiceOption[] {
  if (Array.isArray(question?.options)) {
    const options = question.options.filter(
      (option): option is ChoiceOption =>
        option != null &&
        typeof option === 'object' &&
        'value' in option &&
        typeof option.value === 'string' &&
        'label' in option &&
        typeof option.label === 'string',
    )
    if (options.length >= 2) return options
  }
  return [
    { value: 'option_1', label: '' },
    { value: 'option_2', label: '' },
  ]
}

function nextChoiceValue(options: ChoiceOption[]): string {
  const existing = new Set(options.map((option) => option.value))
  let index = 1
  while (existing.has(`option_${index}`)) index += 1
  return `option_${index}`
}

export function TrainingAssessmentTypeBuilder({
  type,
  courses,
  questions: serverQuestions,
  activitySlot,
}: {
  type: AssessmentType
  courses: CourseOption[]
  questions: Question[]
  activitySlot: React.ReactNode
}) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const router = useRouter()
  const run = useBuilderActionRunner(tGenerated('m_1b61b8c39cc4f3'))
  const [leftTab, setLeftTab] = React.useState<'build' | 'settings' | 'activity'>('build')
  const [questions, setQuestions] = React.useState(serverQuestions)
  const [editing, setEditing] = React.useState<Question | 'new' | null>(null)

  const persistOrder = useDebouncedCallback((next: Question[]) => {
    run(async () => {
      await reorderAssessmentQuestions(
        type.id,
        next.map((question) => question.id),
      )
      router.refresh()
    })
  })
  function reorder(next: Question[]) {
    setQuestions(next)
    persistOrder(next)
  }
  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= questions.length) return
    const next = [...questions]
    const [question] = next.splice(index, 1)
    if (!question) return
    next.splice(target, 0, question)
    reorder(next)
  }
  function remove(question: Question) {
    run(async () => {
      await deleteAssessmentQuestion(type.id, question.id)
      setQuestions((current) => current.filter((item) => item.id !== question.id))
      if (editing !== 'new' && editing?.id === question.id) setEditing(null)
      router.refresh()
    })
  }

  const points = questions.reduce((total, question) => total + question.points, 0)
  return (
    <>
      <BuilderShell
        left={
          <>
            <BuilderRailHeader
              icon={<ClipboardCheck size={15} />}
              title={tGeneratedValue(type.name)}
              subtitle={tGenerated('m_113f97aaa99c6c')}
            />
            <BuilderRailNavigation active={leftTab} onChange={setLeftTab} />
            <BuilderScroll>
              <GeneratedValue
                value={
                  leftTab === 'build' ? (
                    <div className="space-y-4">
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        <GeneratedText id="m_103471fdf5a837" />
                      </p>
                      <Button className="w-full" onClick={() => setEditing('new')}>
                        <Plus size={14} /> <GeneratedText id="m_029dffafbff34b" />
                      </Button>
                      <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        {Object.entries(KIND_LABELS).map(([kind, label]) => (
                          <div key={kind} className="flex items-center justify-between gap-2">
                            <span>{label}</span>
                            <Badge variant="outline">{kind.replace('_', ' ')}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : leftTab === 'settings' ? (
                    <SettingsPanel
                      type={type}
                      courses={courses}
                      onDeleted={() => router.push('/training/assessments/types')}
                    />
                  ) : (
                    activitySlot
                  )
                }
              />
            </BuilderScroll>
          </>
        }
        right={
          <>
            <BuilderSurfaceHeader
              icon={<ClipboardCheck size={16} />}
              title={
                <span>
                  Questions <span className="font-normal text-slate-400">({questions.length})</span>
                </span>
              }
              actions={
                <>
                  <Badge variant="outline">
                    {points} <GeneratedText id="m_157ded1999a421" />
                  </Badge>
                  <Badge variant={type.active ? 'success' : 'secondary'}>
                    <GeneratedValue
                      value={
                        type.active ? (
                          <GeneratedText id="m_1e1b1fdb7dd78e" />
                        ) : (
                          <GeneratedText id="m_0f47ea07c99dba" />
                        )
                      }
                    />
                  </Badge>
                </>
              }
            />
            <BuilderScroll className="lg:p-6">
              {questions.length === 0 ? (
                <button
                  type="button"
                  onClick={() => setEditing('new')}
                  className="grid w-full place-items-center rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-20 text-center dark:border-slate-700 dark:bg-slate-900"
                >
                  <Plus size={24} className="text-slate-400" />
                  <span className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <GeneratedText id="m_0e4b7e5092c260" />
                  </span>
                </button>
              ) : (
                <SortableList
                  items={questions}
                  onReorder={reorder}
                  className="space-y-2 divide-y-0"
                >
                  {questions.map((question, index) => (
                    <SortableRow
                      key={question.id}
                      value={question}
                      onSelect={() => setEditing(question)}
                      onMoveUp={() => move(index, -1)}
                      onMoveDown={() => move(index, 1)}
                      onDelete={() => remove(question)}
                      canUp={index > 0}
                      canDown={index < questions.length - 1}
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {question.prompt}
                      </span>
                      <Badge variant="secondary">
                        {KIND_LABELS[question.kind] ?? question.kind}
                      </Badge>
                      <Badge variant="outline">
                        {question.points} <GeneratedText id="m_07fd31c97533c2" />
                      </Badge>
                      {question.mandatory ? (
                        <Badge variant="warning">
                          <GeneratedText id="m_12fe2fe7a9ddad" />
                        </Badge>
                      ) : null}
                    </SortableRow>
                  ))}
                </SortableList>
              )}
            </BuilderScroll>
          </>
        }
      />
      <QuestionDrawer
        key={editing === 'new' ? 'new' : (editing?.id ?? 'closed')}
        typeId={type.id}
        question={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          router.refresh()
          toast.success(tGenerated('m_0a0569b726b225'))
        }}
      />
    </>
  )
}

function SettingsPanel({
  type,
  courses,
  onDeleted,
}: {
  type: AssessmentType
  courses: CourseOption[]
  onDeleted: () => void
}) {
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const deleteType = useConfirmedBuilderDelete({
    confirmMessage: tGenerated('m_1d68b9e7ba9139'),
    action: () => deleteAssessmentType(type.id),
    onDeleted,
  })
  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          await updateAssessmentType(type.id, formData)
          router.refresh()
          toast.success(tGenerated('m_0a0569b726b225'))
        })
      }
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_02b18d5c7f6f2d" />
        </Label>
        <Input name="name" required defaultValue={type.name} />
      </div>
      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_14d923495cf14c" />
        </Label>
        <Textarea name="description" rows={3} defaultValue={type.description ?? ''} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_0983c76465bdb2" />
          </Label>
          <Input
            name="passingScore"
            type="number"
            min={0}
            max={100}
            required
            defaultValue={type.passingScore}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_0a4456ce9a12f5" />
          </Label>
          <Select name="courseId" defaultValue={type.courseId ?? '__none__'}>
            <option value="__none__">{tGenerated('m_09e46a1f8b0329')}</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.code} · {course.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_1370e68133c5fa" />
        </Label>
        <Textarea
          name="preAssessmentMessage"
          rows={2}
          defaultValue={type.preAssessmentMessage ?? ''}
        />
      </div>
      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_13e0f0f4e548fe" />
        </Label>
        <Textarea
          name="postAssessmentMessage"
          rows={2}
          defaultValue={type.postAssessmentMessage ?? ''}
        />
      </div>
      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="graded" defaultChecked={type.graded} />{' '}
          <GeneratedText id="m_08773e0a52facb" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={type.active} />{' '}
          <GeneratedText id="m_1e1b1fdb7dd78e" />
        </label>
      </fieldset>
      <Button type="submit" disabled={pending} className="w-full">
        <Save size={14} /> <GeneratedText id="m_0bdcc953ae29cd" />
      </Button>
      <BuilderDangerZone
        title={tGenerated('m_0c1907b9a5392f')}
        description={tGenerated('m_0551ec72a74917')}
        buttonLabel={tGenerated('m_12fda1066d2e96')}
        onDelete={deleteType}
      />
    </form>
  )
}

function QuestionDrawer({
  typeId,
  question,
  open,
  onClose,
  onSaved,
}: {
  typeId: string
  question: Question | null
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const tGenerated = useGeneratedTranslations()
  const [pending, startTransition] = React.useTransition()
  const [kind, setKind] = React.useState(question?.kind ?? 'single_choice')
  const [options, setOptions] = React.useState<ChoiceOption[]>(() =>
    questionChoiceOptions(question),
  )
  const [correctChoices, setCorrectChoices] = React.useState<string[]>(() =>
    (question?.correctAnswer ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  const choiceQuestion = kind === 'single_choice' || kind === 'multi_choice'
  const correctAnswer =
    kind === 'single_choice'
      ? (correctChoices[0] ?? '')
      : options
          .filter((option) => correctChoices.includes(option.value))
          .map((option) => option.value)
          .join(',')
  const choiceEditorComplete =
    !choiceQuestion ||
    (options.length >= 2 &&
      options.every((option) => option.label.trim().length > 0) &&
      correctAnswer.length > 0)

  function removeOption(value: string) {
    if (options.length <= 2) return
    setOptions((current) => current.filter((option) => option.value !== value))
    setCorrectChoices((current) => current.filter((item) => item !== value))
  }

  function toggleCorrectChoice(value: string, checked: boolean) {
    if (kind === 'single_choice') {
      setCorrectChoices(checked ? [value] : [])
      return
    }
    setCorrectChoices((current) =>
      checked
        ? current.includes(value)
          ? current
          : [...current, value]
        : current.filter((item) => item !== value),
    )
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={tGenerated(question ? 'm_06b6a61fd2d8b0' : 'm_029dffafbff34b')}
      description={tGenerated('m_1b7fe8563102ab')}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button
            type="submit"
            form="assessment-question-form"
            disabled={pending || !choiceEditorComplete}
          >
            <GeneratedValue
              value={
                question ? (
                  <GeneratedText id="m_0a471ad7911858" />
                ) : (
                  <GeneratedText id="m_029dffafbff34b" />
                )
              }
            />
          </Button>
        </div>
      }
    >
      <form
        id="assessment-question-form"
        action={(formData) =>
          startTransition(async () => {
            if (question) await updateAssessmentQuestion(typeId, question.id, formData)
            else await createAssessmentQuestion(typeId, formData)
            onSaved()
          })
        }
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_1a895b5691321b" />
          </Label>
          <Textarea name="prompt" required rows={3} defaultValue={question?.prompt ?? ''} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_10fb4d4125aba0" />
            </Label>
            <Select name="kind" value={kind} onChange={(event) => setKind(event.target.value)}>
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_08e7a76c4ab77f" />
            </Label>
            <Input name="points" type="number" min={1} defaultValue={question?.points ?? 1} />
          </div>
        </div>
        {choiceQuestion ? (
          <fieldset className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <legend className="text-sm leading-none font-medium text-slate-900 dark:text-slate-100">
                <GeneratedText id="m_13425e9e2e5168" />
              </legend>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                <GeneratedText
                  id={kind === 'single_choice' ? 'm_0a0de23acdd3a9' : 'm_12f9ab3443f098'}
                />
              </span>
            </div>
            <input type="hidden" name="options" value={JSON.stringify(options)} />
            <input type="hidden" name="correctAnswer" value={correctAnswer} />
            <div className="space-y-2">
              {options.map((option, index) => {
                const inputId = `assessment-choice-${index}`
                return (
                  <div
                    key={option.value}
                    className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-950"
                  >
                    <input
                      id={inputId}
                      type={kind === 'single_choice' ? 'radio' : 'checkbox'}
                      checked={
                        kind === 'single_choice'
                          ? correctChoices[0] === option.value
                          : correctChoices.includes(option.value)
                      }
                      onChange={(event) =>
                        toggleCorrectChoice(option.value, event.currentTarget.checked)
                      }
                      className="h-4 w-4 shrink-0 accent-sky-600"
                      aria-label={tGenerated('m_0ce645817b8812', { value0: index + 1 })}
                    />
                    <Input
                      value={option.label}
                      onChange={(event) =>
                        setOptions((current) =>
                          current.map((item) =>
                            item.value === option.value
                              ? { ...item, label: event.currentTarget.value }
                              : item,
                          ),
                        )
                      }
                      placeholder={tGenerated('m_1e0081bf0fdcad', { value0: index + 1 })}
                      aria-label={tGenerated('m_1e0081bf0fdcad', { value0: index + 1 })}
                      required
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeOption(option.value)}
                      disabled={options.length <= 2}
                      aria-label={tGenerated('m_10fe694e346e34', { value0: index + 1 })}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                )
              })}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={options.length >= 50}
              onClick={() =>
                setOptions((current) => [
                  ...current,
                  { value: nextChoiceValue(current), label: '' },
                ])
              }
            >
              <Plus size={14} /> <GeneratedText id="m_0f4383c7906865" />
            </Button>
          </fieldset>
        ) : null}
        {kind !== 'text' ? (
          <div className="space-y-1.5">
            {!choiceQuestion ? (
              <>
                <Label>
                  <GeneratedText id="m_101746dffd63c7" />
                </Label>
                {kind === 'true_false' ? (
                  <Select name="correctAnswer" defaultValue={question?.correctAnswer ?? 'true'}>
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </Select>
                ) : (
                  <Input
                    name="correctAnswer"
                    type="number"
                    step="any"
                    required
                    defaultValue={question?.correctAnswer ?? ''}
                    placeholder={tGenerated('m_14570dbd7256db')}
                  />
                )}
              </>
            ) : null}
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_0d04877b1a742b" />
          </Label>
          <Input name="helpText" defaultValue={question?.helpText ?? ''} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="mandatory" defaultChecked={question?.mandatory ?? true} />{' '}
          <GeneratedText id="m_1482d01137d25a" />
        </label>
        {!question ? <input type="hidden" name="mandatory" value="off" /> : null}
      </form>
    </Drawer>
  )
}
