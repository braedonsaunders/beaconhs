'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Hazard-assessment TYPE builder — 1/3 settings rail + 2/3 build surface with
// three drag-reorderable lists (attached apps, default PPE, default questions),
// each edited in a drawer. Same look as the inspection type builder.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Boxes, ListChecks, Package, Plus, Save, Settings2 } from 'lucide-react'
import { Badge, Button, Drawer, Input, Label, Select, Textarea } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { confirmDialog } from '@/lib/confirm'
import { useReseededState } from '@/lib/use-reseeded-state'
import {
  BuilderRailHeader,
  BuilderRailTab,
  BuilderRailTabs,
  BuilderScroll,
  BuilderShell,
  BuilderSurfaceHeader,
} from '@/components/builder/builder-shell'
import { SortableList, SortableRow, useDebouncedCallback } from '@/components/builder/sortable-list'
import {
  addTypeApp,
  addTypePPE,
  addTypeQuestion,
  deleteAssessmentType,
  deleteTypeApp,
  deleteTypePPE,
  deleteTypeQuestion,
  reorderTypeApps,
  reorderTypePPE,
  reorderTypeQuestions,
  updateAssessmentType,
  updateTypeApp,
  updateTypePPE,
  updateTypeQuestion,
} from '../_actions'

type Style = 'task_based' | 'hazard_based'
type QuestionType = 'yes_no' | 'text' | 'multi_select'
const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  yes_no: 'Yes / No',
  text: 'Free text',
  multi_select: 'Multi-select',
}

type BuilderType = {
  id: string
  name: string
  description: string | null
  style: Style
  defaultHazardSetId: string | null
  hasPPE: boolean
  hasQuestions: boolean
  availableToGroupIds: string[]
}
type PPE = {
  id: string
  name: string
  description: string | null
  required: boolean
  entityOrder: number
}
type Question = {
  id: string
  question: string
  questionType: QuestionType
  answers: string[]
  requiresYes: boolean
  entityOrder: number
}
type AppRow = {
  id: string
  label: string
  key: string
  description: string | null
  required: boolean
  autoCreate: boolean
  entityOrder: number
  templateName: string
}
type Ref = { id: string; name: string }

type Editor =
  | { kind: 'ppe'; mode: 'add' | 'edit'; item?: PPE }
  | { kind: 'question'; mode: 'add' | 'edit'; item?: Question }
  | { kind: 'app'; mode: 'add' | 'edit'; item?: AppRow }

export function HazardTypeBuilder({
  type,
  ppe: initialPPE,
  questions: initialQuestions,
  apps: initialApps,
  appTemplates,
  hazardSets,
  groups,
}: {
  type: BuilderType
  ppe: PPE[]
  questions: Question[]
  apps: AppRow[]
  appTemplates: Ref[]
  hazardSets: Ref[]
  groups: Ref[]
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [, startTransition] = React.useTransition()
  const [ppe, setPPE] = useReseededState(initialPPE, initialPPE)
  const [questions, setQuestions] = useReseededState(initialQuestions, initialQuestions)
  const [apps, setApps] = useReseededState(initialApps, initialApps)
  const [leftTab, setLeftTab] = React.useState<'build' | 'settings'>('build')
  const [editor, setEditor] = React.useState<Editor | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  const run = React.useCallback(
    (fn: () => Promise<unknown>) => {
      startTransition(async () => {
        try {
          await fn()
        } catch (e) {
          toast.error(
            tGeneratedValue(e instanceof Error ? e.message : tGenerated('m_036ddb5b822740')),
          )
          router.refresh()
        }
      })
    },
    [router, tGenerated, tGeneratedValue],
  )

  const persistPPE = useDebouncedCallback((ids: string[]) =>
    run(() => reorderTypePPE({ typeId: type.id, ids })),
  )
  const persistQuestions = useDebouncedCallback((ids: string[]) =>
    run(() => reorderTypeQuestions({ typeId: type.id, ids })),
  )
  const persistApps = useDebouncedCallback((ids: string[]) =>
    run(() => reorderTypeApps({ typeId: type.id, ids })),
  )

  const sortedPPE = [...ppe].sort((a, b) => a.entityOrder - b.entityOrder)
  const sortedQuestions = [...questions].sort((a, b) => a.entityOrder - b.entityOrder)
  const sortedApps = [...apps].sort((a, b) => a.entityOrder - b.entityOrder)

  function reorderPPE(next: PPE[]) {
    const reseq = next.map((x, i) => ({ ...x, entityOrder: i }))
    setPPE(reseq)
    persistPPE(reseq.map((x) => x.id))
  }
  function reorderQuestions(next: Question[]) {
    const reseq = next.map((x, i) => ({ ...x, entityOrder: i }))
    setQuestions(reseq)
    persistQuestions(reseq.map((x) => x.id))
  }
  function reorderApps(next: AppRow[]) {
    const reseq = next.map((x, i) => ({ ...x, entityOrder: i }))
    setApps(reseq)
    persistApps(reseq.map((x) => x.id))
  }
  function movePPE(c: PPE, d: -1 | 1) {
    const i = sortedPPE.findIndex((x) => x.id === c.id)
    const j = i + d
    if (j < 0 || j >= sortedPPE.length) return
    const next = [...sortedPPE]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    reorderPPE(next)
  }
  function moveQuestion(c: Question, d: -1 | 1) {
    const i = sortedQuestions.findIndex((x) => x.id === c.id)
    const j = i + d
    if (j < 0 || j >= sortedQuestions.length) return
    const next = [...sortedQuestions]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    reorderQuestions(next)
  }
  function moveApp(c: AppRow, d: -1 | 1) {
    const i = sortedApps.findIndex((x) => x.id === c.id)
    const j = i + d
    if (j < 0 || j >= sortedApps.length) return
    const next = [...sortedApps]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    reorderApps(next)
  }

  function saveEditor(data: Record<string, unknown>) {
    if (!editor) return
    if (editor.kind === 'ppe') {
      const d = data as { name: string; description: string | null; required: boolean }
      if (editor.mode === 'add') {
        const order = ppe.length
        run(async () => {
          const res = await addTypePPE({ typeId: type.id, ...d })
          if (res?.id) setPPE((all) => [...all, { id: res.id!, entityOrder: order, ...d }])
        })
      } else if (editor.item) {
        const id = editor.item.id
        setPPE((all) => all.map((x) => (x.id === id ? { ...x, ...d } : x)))
        run(() => updateTypePPE({ typeId: type.id, id, ...d }))
      }
    } else if (editor.kind === 'question') {
      const d = data as {
        question: string
        questionType: QuestionType
        answers: string[]
        requiresYes: boolean
      }
      if (editor.mode === 'add') {
        const order = questions.length
        run(async () => {
          const res = await addTypeQuestion({ typeId: type.id, ...d })
          if (res?.id) setQuestions((all) => [...all, { id: res.id!, entityOrder: order, ...d }])
        })
      } else if (editor.item) {
        const id = editor.item.id
        setQuestions((all) => all.map((x) => (x.id === id ? { ...x, ...d } : x)))
        run(() => updateTypeQuestion({ typeId: type.id, id, ...d }))
      }
    } else if (editor.kind === 'app') {
      if (editor.mode === 'add') {
        const d = data as {
          templateId: string
          label: string | null
          key: string | null
          description: string | null
          required: boolean
          autoCreate: boolean
        }
        run(async () => {
          const res = await addTypeApp({ typeId: type.id, ...d })
          if (res?.id)
            setApps((all) => [
              ...all,
              {
                id: res.id,
                label: res.label,
                key: res.key,
                description: res.description,
                required: res.required,
                autoCreate: res.autoCreate,
                entityOrder: res.entityOrder,
                templateName: res.templateName,
              },
            ])
        })
      } else if (editor.item) {
        const d = data as {
          label: string
          description: string | null
          required: boolean
          autoCreate: boolean
        }
        const id = editor.item.id
        setApps((all) => all.map((x) => (x.id === id ? { ...x, ...d } : x)))
        run(() => updateTypeApp({ typeId: type.id, id, ...d }))
      }
    }
    setEditor(null)
  }

  return (
    <>
      <BuilderShell
        left={
          <>
            <BuilderRailHeader
              icon={<Settings2 size={15} />}
              title={tGeneratedValue(type.name)}
              subtitle={tGenerated('m_169ce2294296b8')}
            />
            <BuilderRailTabs>
              <BuilderRailTab
                active={leftTab === 'build'}
                onClick={() => setLeftTab('build')}
                icon={<ListChecks size={14} />}
                label={tGenerated('m_0adae4a94c7be3')}
              />
              <BuilderRailTab
                active={leftTab === 'settings'}
                onClick={() => setLeftTab('settings')}
                icon={<Settings2 size={14} />}
                label={tGenerated('m_151769a9fde954')}
              />
            </BuilderRailTabs>
            <BuilderScroll>
              <GeneratedValue
                value={
                  leftTab === 'build' ? (
                    <div className="space-y-3">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <GeneratedText id="m_00f539e210a735" />
                      </p>
                      <Button
                        variant="outline"
                        className="w-full justify-start"
                        onClick={() => setEditor({ kind: 'app', mode: 'add' })}
                      >
                        <Boxes size={14} /> <GeneratedText id="m_047fb1ff03fd59" />
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full justify-start"
                        onClick={() => setEditor({ kind: 'ppe', mode: 'add' })}
                      >
                        <Package size={14} /> <GeneratedText id="m_0068c6e22ca766" />
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full justify-start"
                        onClick={() => setEditor({ kind: 'question', mode: 'add' })}
                      >
                        <ListChecks size={14} /> <GeneratedText id="m_029dffafbff34b" />
                      </Button>
                    </div>
                  ) : (
                    <SettingsPanel
                      type={type}
                      hazardSets={hazardSets}
                      groups={groups}
                      onDeleted={() => router.push('/hazard-assessments/types')}
                    />
                  )
                }
              />
            </BuilderScroll>
          </>
        }
        right={
          <>
            <BuilderSurfaceHeader
              icon={<Boxes size={15} />}
              title={tGenerated('m_0b120bda8434d5')}
              actions={
                <>
                  <Badge variant="secondary">
                    <GeneratedText id="m_0bdfc62977f9d0" /> <GeneratedValue value={apps.length} />
                  </Badge>
                  <Badge variant="secondary">
                    <GeneratedText id="m_18391e161b9ed6" /> <GeneratedValue value={ppe.length} />
                  </Badge>
                  <Badge variant="secondary">
                    <GeneratedText id="m_06d84b0874d447" />{' '}
                    <GeneratedValue value={questions.length} />
                  </Badge>
                </>
              }
            />
            <BuilderScroll className="space-y-4 lg:p-6">
              <ListSection
                title={tGenerated('m_0c770d55914bfa')}
                subtitle={tGenerated('m_121829a2cc68e2')}
                count={apps.length}
                addLabel="Attach"
                onAdd={() => setEditor({ kind: 'app', mode: 'add' })}
                empty={apps.length === 0 ? 'No apps attached.' : null}
              >
                <SortableList items={sortedApps} onReorder={reorderApps}>
                  <GeneratedValue
                    value={sortedApps.map((a, i) => (
                      <SortableRow
                        key={a.id}
                        value={a}
                        selected={selectedId === a.id}
                        onSelect={() => {
                          setSelectedId(a.id)
                          setEditor({ kind: 'app', mode: 'edit', item: a })
                        }}
                        onMoveUp={() => moveApp(a, -1)}
                        onMoveDown={() => moveApp(a, 1)}
                        onDelete={() => {
                          setApps((all) => all.filter((x) => x.id !== a.id))
                          run(() => deleteTypeApp({ typeId: type.id, id: a.id }))
                        }}
                        canUp={i > 0}
                        canDown={i < sortedApps.length - 1}
                      >
                        <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          <GeneratedValue value={a.label} />
                        </span>
                        <span className="hidden shrink-0 text-[11px] text-slate-400 sm:inline">
                          <GeneratedValue value={a.templateName} />
                        </span>
                        <GeneratedValue
                          value={
                            a.required ? (
                              <Badge variant="outline" className="text-[10px]">
                                <GeneratedText id="m_07ca2266909f33" />
                              </Badge>
                            ) : null
                          }
                        />
                        <GeneratedValue
                          value={
                            a.autoCreate ? (
                              <Badge variant="secondary" className="text-[10px]">
                                <GeneratedText id="m_0e4a54b8ee5d61" />
                              </Badge>
                            ) : null
                          }
                        />
                      </SortableRow>
                    ))}
                  />
                </SortableList>
              </ListSection>

              <ListSection
                title={tGenerated('m_00208cf63d88c8')}
                subtitle={tGenerated('m_1f87aa91a93382')}
                count={ppe.length}
                addLabel="Add"
                onAdd={() => setEditor({ kind: 'ppe', mode: 'add' })}
                empty={ppe.length === 0 ? 'No default PPE.' : null}
              >
                <SortableList items={sortedPPE} onReorder={reorderPPE}>
                  <GeneratedValue
                    value={sortedPPE.map((p, i) => (
                      <SortableRow
                        key={p.id}
                        value={p}
                        selected={selectedId === p.id}
                        onSelect={() => {
                          setSelectedId(p.id)
                          setEditor({ kind: 'ppe', mode: 'edit', item: p })
                        }}
                        onMoveUp={() => movePPE(p, -1)}
                        onMoveDown={() => movePPE(p, 1)}
                        onDelete={() => {
                          setPPE((all) => all.filter((x) => x.id !== p.id))
                          run(() => deleteTypePPE({ typeId: type.id, id: p.id }))
                        }}
                        canUp={i > 0}
                        canDown={i < sortedPPE.length - 1}
                      >
                        <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          <GeneratedValue value={p.name} />
                        </span>
                        <GeneratedValue
                          value={
                            p.required ? (
                              <Badge variant="outline" className="text-[10px]">
                                <GeneratedText id="m_07ca2266909f33" />
                              </Badge>
                            ) : null
                          }
                        />
                      </SortableRow>
                    ))}
                  />
                </SortableList>
              </ListSection>

              <ListSection
                title={tGenerated('m_1c55c8b42e9776')}
                subtitle={tGenerated('m_0e850280ab682a')}
                count={questions.length}
                addLabel="Add"
                onAdd={() => setEditor({ kind: 'question', mode: 'add' })}
                empty={questions.length === 0 ? 'No default questions.' : null}
              >
                <SortableList items={sortedQuestions} onReorder={reorderQuestions}>
                  <GeneratedValue
                    value={sortedQuestions.map((q, i) => (
                      <SortableRow
                        key={q.id}
                        value={q}
                        selected={selectedId === q.id}
                        onSelect={() => {
                          setSelectedId(q.id)
                          setEditor({ kind: 'question', mode: 'edit', item: q })
                        }}
                        onMoveUp={() => moveQuestion(q, -1)}
                        onMoveDown={() => moveQuestion(q, 1)}
                        onDelete={() => {
                          setQuestions((all) => all.filter((x) => x.id !== q.id))
                          run(() => deleteTypeQuestion({ typeId: type.id, id: q.id }))
                        }}
                        canUp={i > 0}
                        canDown={i < sortedQuestions.length - 1}
                      >
                        <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          <GeneratedValue value={q.question} />
                        </span>
                        <span className="hidden shrink-0 text-[11px] text-slate-400 sm:inline">
                          <GeneratedValue value={QUESTION_TYPE_LABELS[q.questionType]} />
                        </span>
                        <GeneratedValue
                          value={
                            q.requiresYes ? (
                              <Badge variant="outline" className="text-[10px]">
                                <GeneratedText id="m_1579cafa005687" />
                              </Badge>
                            ) : null
                          }
                        />
                      </SortableRow>
                    ))}
                  />
                </SortableList>
              </ListSection>
            </BuilderScroll>
          </>
        }
      />

      <EditorDrawer
        editor={editor}
        appTemplates={appTemplates}
        onClose={() => setEditor(null)}
        onSave={saveEditor}
      />
    </>
  )
}

function ListSection({
  title,
  subtitle,
  count,
  addLabel,
  onAdd,
  empty,
  children,
}: {
  title: string
  subtitle: string
  count: number
  addLabel: string
  onAdd: () => void
  empty: string | null
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <GeneratedValue value={title} />{' '}
            <Badge variant="secondary">
              <GeneratedValue value={count} />
            </Badge>
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            <GeneratedValue value={subtitle} />
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus size={13} /> <GeneratedValue value={addLabel} />
        </Button>
      </header>
      <div className="p-2">
        <GeneratedValue
          value={
            empty ? (
              <p className="px-2 py-3 text-center text-xs text-slate-400 dark:text-slate-500">
                <GeneratedValue value={empty} />
              </p>
            ) : (
              children
            )
          }
        />
      </div>
    </section>
  )
}

// --- editor drawer (per kind) ----------------------------------------------

function EditorDrawer({
  editor,
  appTemplates,
  onClose,
  onSave,
}: {
  editor: Editor | null
  appTemplates: Ref[]
  onClose: () => void
  onSave: (data: Record<string, unknown>) => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  // PPE
  const [name, setName] = useReseededState(
    editor,
    editor?.kind === 'ppe' ? (editor.item?.name ?? '') : '',
  )
  const [ppeDesc, setPpeDesc] = useReseededState(
    editor,
    editor?.kind === 'ppe' ? (editor.item?.description ?? '') : '',
  )
  const [ppeRequired, setPpeRequired] = useReseededState(
    editor,
    editor?.kind === 'ppe' ? (editor.item?.required ?? true) : true,
  )
  // Question
  const [question, setQuestion] = useReseededState(
    editor,
    editor?.kind === 'question' ? (editor.item?.question ?? '') : '',
  )
  const [questionType, setQuestionType] = useReseededState<QuestionType>(
    editor,
    editor?.kind === 'question' ? (editor.item?.questionType ?? 'yes_no') : 'yes_no',
  )
  const [answers, setAnswers] = useReseededState(
    editor,
    editor?.kind === 'question' ? (editor.item?.answers ?? []).join('\n') : '',
  )
  const [requiresYes, setRequiresYes] = useReseededState(
    editor,
    editor?.kind === 'question' ? (editor.item?.requiresYes ?? false) : false,
  )
  // App
  const [templateId, setTemplateId] = useReseededState(editor, '')
  const [label, setLabel] = useReseededState(
    editor,
    editor?.kind === 'app' ? (editor.item?.label ?? '') : '',
  )
  const [appKey, setAppKey] = useReseededState(
    editor,
    editor?.kind === 'app' ? (editor.item?.key ?? '') : '',
  )
  const [appDesc, setAppDesc] = useReseededState(
    editor,
    editor?.kind === 'app' ? (editor.item?.description ?? '') : '',
  )
  const [appRequired, setAppRequired] = useReseededState(
    editor,
    editor?.kind === 'app' ? (editor.item?.required ?? false) : false,
  )
  const [autoCreate, setAutoCreate] = useReseededState(
    editor,
    editor?.kind === 'app' ? (editor.item?.autoCreate ?? true) : true,
  )

  const kind = editor?.kind
  const isAdd = editor?.mode === 'add'
  const titleMap = { ppe: 'PPE', question: 'question', app: 'app' } as const
  const title = editor ? `${isAdd ? 'Add' : 'Edit'} ${titleMap[editor.kind]}` : ''

  const answerList = answers
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  const canSave =
    kind === 'ppe'
      ? name.trim().length > 0
      : kind === 'question'
        ? question.trim().length > 0
        : isAdd
          ? templateId.length > 0
          : label.trim().length > 0

  function submit() {
    if (kind === 'ppe') {
      onSave({ name: name.trim(), description: ppeDesc.trim() || null, required: ppeRequired })
    } else if (kind === 'question') {
      onSave({
        question: question.trim(),
        questionType,
        answers: answerList,
        requiresYes,
      })
    } else if (kind === 'app') {
      if (isAdd) {
        onSave({
          templateId,
          label: label.trim() || null,
          key: appKey.trim() || null,
          description: appDesc.trim() || null,
          required: appRequired,
          autoCreate,
        })
      } else {
        onSave({
          label: label.trim(),
          description: appDesc.trim() || null,
          required: appRequired,
          autoCreate,
        })
      }
    }
  }

  return (
    <Drawer
      open={!!editor}
      onClose={onClose}
      title={tGeneratedValue(title)}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button disabled={!canSave} onClick={submit}>
            <GeneratedValue
              value={
                isAdd ? (
                  <GeneratedText id="m_16c8592e5020a4" />
                ) : (
                  <GeneratedText id="m_19e6bff894c3c7" />
                )
              }
            />
          </Button>
        </>
      }
    >
      <GeneratedValue
        value={
          kind === 'ppe' ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_02b18d5c7f6f2d" />
                </Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={tGenerated('m_04f8a80faaa9d2')}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_14d923495cf14c" />
                </Label>
                <Input
                  value={ppeDesc}
                  onChange={(e) => setPpeDesc(e.target.value)}
                  placeholder={tGenerated('m_140a30a86c0ace')}
                />
              </div>
              <CheckRow
                label={tGenerated('m_12fe2fe7a9ddad')}
                checked={ppeRequired}
                onChange={setPpeRequired}
              />
            </div>
          ) : kind === 'question' ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_1a895b5691321b" />
                </Label>
                <Textarea
                  rows={2}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={tGenerated('m_1441acb202be91')}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_074ba2f160c506" />
                </Label>
                <Select
                  value={questionType}
                  onChange={(e) => setQuestionType(e.target.value as QuestionType)}
                >
                  <GeneratedValue
                    value={(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => (
                      <option key={t} value={t}>
                        <GeneratedValue value={QUESTION_TYPE_LABELS[t]} />
                      </option>
                    ))}
                  />
                </Select>
              </div>
              <GeneratedValue
                value={
                  questionType === 'multi_select' ? (
                    <div className="space-y-1.5">
                      <Label>
                        <GeneratedText id="m_02057adc77a443" />
                      </Label>
                      <Textarea
                        rows={3}
                        value={answers}
                        onChange={(e) => setAnswers(e.target.value)}
                      />
                    </div>
                  ) : null
                }
              />
              <CheckRow
                label={tGenerated('m_01b4f1b5df17f0')}
                checked={requiresYes}
                onChange={setRequiresYes}
              />
            </div>
          ) : kind === 'app' ? (
            <div className="space-y-4">
              <GeneratedValue
                value={
                  isAdd ? (
                    <div className="space-y-1.5">
                      <Label>
                        <GeneratedText id="m_13554479175be8" />
                      </Label>
                      <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                        <option value="">
                          <GeneratedText id="m_0dbb32383dd60f" />
                        </option>
                        <GeneratedValue
                          value={appTemplates.map((t) => (
                            <option key={t.id} value={t.id}>
                              <GeneratedValue value={t.name} />
                            </option>
                          ))}
                        />
                      </Select>
                    </div>
                  ) : null
                }
              />
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_1d088977412efb" />
                </Label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={tGenerated('m_1a6aced2ae215f')}
                />
              </div>
              <GeneratedValue
                value={
                  isAdd ? (
                    <div className="space-y-1.5">
                      <Label>
                        <GeneratedText id="m_169ff65a3cfc14" />
                      </Label>
                      <Input
                        value={appKey}
                        onChange={(e) => setAppKey(e.target.value)}
                        placeholder={tGenerated('m_17c9b4e6f7a6bc')}
                      />
                    </div>
                  ) : null
                }
              />
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_14d923495cf14c" />
                </Label>
                <Input
                  value={appDesc}
                  onChange={(e) => setAppDesc(e.target.value)}
                  placeholder={tGenerated('m_1444f72a8fb9d4')}
                />
              </div>
              <CheckRow
                label={tGenerated('m_12fe2fe7a9ddad')}
                checked={appRequired}
                onChange={setAppRequired}
              />
              <CheckRow
                label={tGenerated('m_1a3414cf0c5f06')}
                checked={autoCreate}
                onChange={setAutoCreate}
              />
            </div>
          ) : null
        }
      />
    </Drawer>
  )
}

// --- settings panel --------------------------------------------------------

function SettingsPanel({
  type,
  hazardSets,
  groups,
  onDeleted,
}: {
  type: BuilderType
  hazardSets: Ref[]
  groups: Ref[]
  onDeleted: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [, start] = React.useTransition()
  const [name, setName] = React.useState(type.name)
  const [description, setDescription] = React.useState(type.description ?? '')
  const [style, setStyle] = React.useState<Style>(type.style)
  const [defaultHazardSetId, setDefaultHazardSetId] = React.useState(type.defaultHazardSetId ?? '')
  const [hasPPE, setHasPPE] = React.useState(type.hasPPE)
  const [hasQuestions, setHasQuestions] = React.useState(type.hasQuestions)
  const [groupIds, setGroupIds] = React.useState<string[]>(type.availableToGroupIds)
  const isHazardBased = style === 'hazard_based'

  function toggleGroup(id: string) {
    setGroupIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }
  function save() {
    start(async () => {
      try {
        await updateAssessmentType({
          id: type.id,
          name,
          description,
          style,
          defaultHazardSetId: isHazardBased ? defaultHazardSetId || null : null,
          hasPPE,
          hasQuestions,
          availableToGroupIds: groupIds,
        })
        toast.success(tGenerated('m_0a0569b726b225'))
      } catch (e) {
        toast.error(
          tGeneratedValue(e instanceof Error ? e.message : tGenerated('m_084d4d5382264e')),
        )
      }
    })
  }
  async function del() {
    if (
      !(await confirmDialog({
        message: 'Delete this assessment type? This cannot be undone.',
        tone: 'danger',
      }))
    )
      return
    start(async () => {
      try {
        await deleteAssessmentType({ id: type.id })
        onDeleted()
      } catch (e) {
        toast.error(
          tGeneratedValue(e instanceof Error ? e.message : tGenerated('m_1ac2672da698ce')),
        )
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_1a9978900838e6" />
        </Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_14d923495cf14c" />
        </Label>
        <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_03cf3a97d03fef" />
        </Label>
        <Select value={style} onChange={(e) => setStyle(e.target.value as Style)}>
          <option value="task_based">
            <GeneratedText id="m_09d335688e31af" />
          </option>
          <option value="hazard_based">
            <GeneratedText id="m_0f250d076f1225" />
          </option>
        </Select>
      </div>
      <GeneratedValue
        value={
          isHazardBased ? (
            <div className="space-y-1.5">
              <Label>
                <GeneratedText id="m_14b0cc3abaca8d" />
              </Label>
              <Select
                value={defaultHazardSetId}
                onChange={(e) => setDefaultHazardSetId(e.target.value)}
              >
                <option value="">
                  <GeneratedText id="m_0206c945814606" />
                </option>
                <GeneratedValue
                  value={hazardSets.map((s) => (
                    <option key={s.id} value={s.id}>
                      <GeneratedValue value={s.name} />
                    </option>
                  ))}
                />
              </Select>
            </div>
          ) : null
        }
      />
      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-medium text-slate-500">
          <GeneratedText id="m_0715227000cfd5" />
        </legend>
        <CheckRow label={tGenerated('m_18391e161b9ed6')} checked={hasPPE} onChange={setHasPPE} />
        <CheckRow
          label={tGenerated('m_049fefa2074149')}
          checked={hasQuestions}
          onChange={setHasQuestions}
        />
      </fieldset>
      <GeneratedValue
        value={
          groups.length > 0 ? (
            <div className="space-y-1.5">
              <Label>
                <GeneratedText id="m_05d7dad9d61d38" />
              </Label>
              <p className="text-xs text-slate-500">
                <GeneratedText id="m_1adf81e42e1cda" />
              </p>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2 dark:border-slate-800">
                <GeneratedValue
                  value={groups.map((g) => (
                    <CheckRow
                      key={g.id}
                      label={tGeneratedValue(g.name)}
                      checked={groupIds.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                    />
                  ))}
                />
              </div>
            </div>
          ) : null
        }
      />
      <div className="flex justify-end">
        <Button onClick={save}>
          <Save size={14} /> <GeneratedText id="m_19e6bff894c3c7" />
        </Button>
      </div>

      <div className="mt-4 rounded-md border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-950 dark:bg-rose-950/20">
        <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-300">
          <GeneratedText id="m_0c1907b9a5392f" />
        </h3>
        <p className="mt-0.5 text-xs text-rose-700/80 dark:text-rose-300/80">
          <GeneratedText id="m_16047894db0315" />
        </p>
        <div className="mt-2 flex justify-end">
          <Button variant="outline" className="text-rose-600 hover:bg-rose-50" onClick={del}>
            <GeneratedText id="m_12fda1066d2e96" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
      />
      <span>
        <GeneratedValue value={label} />
      </span>
    </label>
  )
}
