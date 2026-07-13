'use client'

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
          toast.error(e instanceof Error ? e.message : 'Something went wrong')
          router.refresh()
        }
      })
    },
    [router],
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
              title={type.name}
              subtitle="Assessment type"
            />
            <BuilderRailTabs>
              <BuilderRailTab
                active={leftTab === 'build'}
                onClick={() => setLeftTab('build')}
                icon={<ListChecks size={14} />}
                label="Build"
              />
              <BuilderRailTab
                active={leftTab === 'settings'}
                onClick={() => setLeftTab('settings')}
                icon={<Settings2 size={14} />}
                label="Settings"
              />
            </BuilderRailTabs>
            <BuilderScroll>
              {leftTab === 'build' ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Compose what new assessments of this type start with. Attach Builder apps, and
                    seed default PPE and intake questions — drag to reorder.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => setEditor({ kind: 'app', mode: 'add' })}
                  >
                    <Boxes size={14} /> Attach app
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => setEditor({ kind: 'ppe', mode: 'add' })}
                  >
                    <Package size={14} /> Add PPE
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => setEditor({ kind: 'question', mode: 'add' })}
                  >
                    <ListChecks size={14} /> Add question
                  </Button>
                </div>
              ) : (
                <SettingsPanel
                  type={type}
                  hazardSets={hazardSets}
                  groups={groups}
                  onDeleted={() => router.push('/hazard-assessments/types')}
                />
              )}
            </BuilderScroll>
          </>
        }
        right={
          <>
            <BuilderSurfaceHeader
              icon={<Boxes size={15} />}
              title="Build surface"
              actions={
                <>
                  <Badge variant="secondary">Apps {apps.length}</Badge>
                  <Badge variant="secondary">PPE {ppe.length}</Badge>
                  <Badge variant="secondary">Questions {questions.length}</Badge>
                </>
              }
            />
            <BuilderScroll className="space-y-4 lg:p-6">
              <ListSection
                title="Builder apps"
                subtitle="Published Builder apps embedded as assessment sections."
                count={apps.length}
                addLabel="Attach"
                onAdd={() => setEditor({ kind: 'app', mode: 'add' })}
                empty={apps.length === 0 ? 'No apps attached.' : null}
              >
                <SortableList items={sortedApps} onReorder={reorderApps}>
                  {sortedApps.map((a, i) => (
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
                        {a.label}
                      </span>
                      <span className="hidden shrink-0 text-[11px] text-slate-400 sm:inline">
                        {a.templateName}
                      </span>
                      {a.required ? (
                        <Badge variant="outline" className="text-[10px]">
                          required
                        </Badge>
                      ) : null}
                      {a.autoCreate ? (
                        <Badge variant="secondary" className="text-[10px]">
                          auto
                        </Badge>
                      ) : null}
                    </SortableRow>
                  ))}
                </SortableList>
              </ListSection>

              <ListSection
                title="Default PPE"
                subtitle="Seed PPE rows into new assessments of this type."
                count={ppe.length}
                addLabel="Add"
                onAdd={() => setEditor({ kind: 'ppe', mode: 'add' })}
                empty={ppe.length === 0 ? 'No default PPE.' : null}
              >
                <SortableList items={sortedPPE} onReorder={reorderPPE}>
                  {sortedPPE.map((p, i) => (
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
                        {p.name}
                      </span>
                      {p.required ? (
                        <Badge variant="outline" className="text-[10px]">
                          required
                        </Badge>
                      ) : null}
                    </SortableRow>
                  ))}
                </SortableList>
              </ListSection>

              <ListSection
                title="Default questions"
                subtitle="Intake and verification questions seeded on each assessment."
                count={questions.length}
                addLabel="Add"
                onAdd={() => setEditor({ kind: 'question', mode: 'add' })}
                empty={questions.length === 0 ? 'No default questions.' : null}
              >
                <SortableList items={sortedQuestions} onReorder={reorderQuestions}>
                  {sortedQuestions.map((q, i) => (
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
                        {q.question}
                      </span>
                      <span className="hidden shrink-0 text-[11px] text-slate-400 sm:inline">
                        {QUESTION_TYPE_LABELS[q.questionType]}
                      </span>
                      {q.requiresYes ? (
                        <Badge variant="outline" className="text-[10px]">
                          requires yes
                        </Badge>
                      ) : null}
                    </SortableRow>
                  ))}
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
            {title} <Badge variant="secondary">{count}</Badge>
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus size={13} /> {addLabel}
        </Button>
      </header>
      <div className="p-2">
        {empty ? (
          <p className="px-2 py-3 text-center text-xs text-slate-400 dark:text-slate-500">
            {empty}
          </p>
        ) : (
          children
        )}
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
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={submit}>
            {isAdd ? 'Add' : 'Save'}
          </Button>
        </>
      }
    >
      {kind === 'ppe' ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hard hat"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input
              value={ppeDesc}
              onChange={(e) => setPpeDesc(e.target.value)}
              placeholder="When / why"
            />
          </div>
          <CheckRow label="Required" checked={ppeRequired} onChange={setPpeRequired} />
        </div>
      ) : kind === 'question' ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Question</Label>
            <Textarea
              rows={2}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. Are permits posted?"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={questionType}
              onChange={(e) => setQuestionType(e.target.value as QuestionType)}
            >
              {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => (
                <option key={t} value={t}>
                  {QUESTION_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          {questionType === 'multi_select' ? (
            <div className="space-y-1.5">
              <Label>Options (one per line)</Label>
              <Textarea rows={3} value={answers} onChange={(e) => setAnswers(e.target.value)} />
            </div>
          ) : null}
          <CheckRow
            label='Requires "Yes" for completion'
            checked={requiresYes}
            onChange={setRequiresYes}
          />
        </div>
      ) : kind === 'app' ? (
        <div className="space-y-4">
          {isAdd ? (
            <div className="space-y-1.5">
              <Label>Published app</Label>
              <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Select an app…</option>
                {appTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Defaults to app name"
            />
          </div>
          {isAdd ? (
            <div className="space-y-1.5">
              <Label>Key</Label>
              <Input
                value={appKey}
                onChange={(e) => setAppKey(e.target.value)}
                placeholder="e.g. confined_space"
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input
              value={appDesc}
              onChange={(e) => setAppDesc(e.target.value)}
              placeholder="Shown on the app card"
            />
          </div>
          <CheckRow label="Required" checked={appRequired} onChange={setAppRequired} />
          <CheckRow
            label="Create draft on new assessments"
            checked={autoCreate}
            onChange={setAutoCreate}
          />
        </div>
      ) : null}
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
        toast.success('Saved')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to save')
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
        toast.error(e instanceof Error ? e.message : 'Failed to delete')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Name *</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label>Description</Label>
        <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Style</Label>
        <Select value={style} onChange={(e) => setStyle(e.target.value as Style)}>
          <option value="task_based">Task-based</option>
          <option value="hazard_based">Hazard-based</option>
        </Select>
      </div>
      {isHazardBased ? (
        <div className="space-y-1.5">
          <Label>Default hazard set</Label>
          <Select
            value={defaultHazardSetId}
            onChange={(e) => setDefaultHazardSetId(e.target.value)}
          >
            <option value="">— none —</option>
            {hazardSets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-medium text-slate-500">Optional sections</legend>
        <CheckRow label="PPE" checked={hasPPE} onChange={setHasPPE} />
        <CheckRow label="Questions & Answers" checked={hasQuestions} onChange={setHasQuestions} />
      </fieldset>
      {groups.length > 0 ? (
        <div className="space-y-1.5">
          <Label>Available to (person groups)</Label>
          <p className="text-xs text-slate-500">
            Leave all unchecked to offer this type to everyone.
          </p>
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2 dark:border-slate-800">
            {groups.map((g) => (
              <CheckRow
                key={g.id}
                label={g.name}
                checked={groupIds.includes(g.id)}
                onChange={() => toggleGroup(g.id)}
              />
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button onClick={save}>
          <Save size={14} /> Save
        </Button>
      </div>

      <div className="mt-4 rounded-md border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-950 dark:bg-rose-950/20">
        <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-300">
          Delete assessment type
        </h3>
        <p className="mt-0.5 text-xs text-rose-700/80 dark:text-rose-300/80">
          Removes this type from the library.
        </p>
        <div className="mt-2 flex justify-end">
          <Button variant="outline" className="text-rose-600 hover:bg-rose-50" onClick={del}>
            Delete type
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
      <span>{label}</span>
    </label>
  )
}
