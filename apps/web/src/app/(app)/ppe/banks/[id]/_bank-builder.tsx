'use client'

// PPE criteria BANK builder — same 1/3-2/3 shell + drag list as the type
// builder, but flat (a bank is just a reusable, severity-aware pool of criteria
// that PPE types import from).

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Boxes, Camera, ListChecks, Plus, Save } from 'lucide-react'
import { Badge, Button, Drawer, EmptyState, Input, Label, Select, Textarea } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
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
  addBankCriterion,
  deleteBankCriterion,
  reorderBankCriteria,
  toggleBankPublished,
  updateBank,
  updateBankCriterion,
} from '../_actions'

type Severity = 'low' | 'medium' | 'high' | 'critical'
const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical']
const SEVERITY_LABELS: Record<Severity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High (creates corrective action)',
  critical: 'Critical (creates corrective action)',
}
function severityVariant(s: Severity): 'destructive' | 'warning' | 'secondary' {
  return s === 'critical' || s === 'high' ? 'destructive' : s === 'medium' ? 'warning' : 'secondary'
}

const CATEGORIES = [
  { value: '', label: '— None —' },
  { value: 'head', label: 'Head protection' },
  { value: 'eye', label: 'Eye protection' },
  { value: 'hand', label: 'Hand protection' },
  { value: 'foot', label: 'Foot protection' },
  { value: 'fall', label: 'Fall protection' },
  { value: 'respiratory', label: 'Respiratory protection' },
  { value: 'hearing', label: 'Hearing protection' },
  { value: 'high_vis', label: 'High visibility' },
  { value: 'other', label: 'Other' },
]

export type BuilderBank = {
  id: string
  name: string
  description: string | null
  category: string | null
  isPublished: boolean
}
export type BuilderBankCriterion = {
  id: string
  sequence: number
  question: string
  description: string | null
  severity: Severity
  requiresPhoto: boolean
}

type EditorState = { mode: 'add' | 'edit'; criterion?: BuilderBankCriterion }

export function PpeBankBuilder({
  bank,
  criteria: initialCriteria,
  activitySlot,
}: {
  bank: BuilderBank
  criteria: BuilderBankCriterion[]
  activitySlot: React.ReactNode
}) {
  const router = useRouter()
  const [, startTransition] = React.useTransition()
  const [criteria, setCriteria] = React.useState(initialCriteria)
  const [leftTab, setLeftTab] = React.useState<'build' | 'settings' | 'activity'>('build')
  const [published, setPublished] = React.useState(bank.isPublished)
  const [editor, setEditor] = React.useState<EditorState | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  React.useEffect(() => setCriteria(initialCriteria), [initialCriteria])

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

  const persistOrder = useDebouncedCallback((ids: string[]) =>
    run(() => reorderBankCriteria({ bankId: bank.id, ids })),
  )

  const sorted = [...criteria].sort((a, b) => a.sequence - b.sequence)

  function handleReorder(next: BuilderBankCriterion[]) {
    const reseq = next.map((c, i) => ({ ...c, sequence: i }))
    setCriteria(reseq)
    persistOrder(reseq.map((c) => c.id))
  }
  function moveCriterion(c: BuilderBankCriterion, delta: -1 | 1) {
    const i = sorted.findIndex((x) => x.id === c.id)
    const j = i + delta
    if (j < 0 || j >= sorted.length) return
    const next = [...sorted]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    handleReorder(next)
  }
  function handleDelete(c: BuilderBankCriterion) {
    setCriteria((all) => all.filter((x) => x.id !== c.id))
    if (selectedId === c.id) setSelectedId(null)
    run(() => deleteBankCriterion({ bankId: bank.id, id: c.id }))
  }
  function saveCriterion(data: {
    question: string
    description: string | null
    severity: Severity
    requiresPhoto: boolean
  }) {
    if (!editor) return
    if (editor.mode === 'add') {
      const seq = criteria.length
      run(async () => {
        const res = await addBankCriterion({ bankId: bank.id, ...data })
        if (res?.id) setCriteria((all) => [...all, { id: res.id!, sequence: seq, ...data }])
      })
    } else if (editor.criterion) {
      const id = editor.criterion.id
      setCriteria((all) => all.map((x) => (x.id === id ? { ...x, ...data } : x)))
      run(() => updateBankCriterion({ bankId: bank.id, id, ...data }))
    }
    setEditor(null)
  }
  function togglePublish() {
    const next = !published
    setPublished(next)
    run(() => toggleBankPublished({ id: bank.id, next }))
  }

  return (
    <>
      <BuilderShell
        left={
          <>
            <BuilderRailHeader
              icon={<Boxes size={15} />}
              title={bank.name}
              subtitle="Criteria bank"
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
                label="Settings"
              />
              <BuilderRailTab
                active={leftTab === 'activity'}
                onClick={() => setLeftTab('activity')}
                label="Activity"
              />
            </BuilderRailTabs>
            <BuilderScroll>
              {leftTab === 'build' ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    A bank is a reusable pool of questions. Build it once, then import it into any
                    PPE type as a section.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => setEditor({ mode: 'add' })}
                  >
                    <Plus size={14} /> Add question
                  </Button>
                </div>
              ) : leftTab === 'settings' ? (
                <BankSettingsPanel bank={bank} />
              ) : (
                activitySlot
              )}
            </BuilderScroll>
          </>
        }
        right={
          <>
            <BuilderSurfaceHeader
              icon={<ListChecks size={15} />}
              title="Criteria"
              actions={
                <>
                  <Badge variant="secondary">
                    {criteria.length} criteri{criteria.length === 1 ? 'on' : 'a'}
                  </Badge>
                  <Button
                    size="sm"
                    variant={published ? 'outline' : 'default'}
                    onClick={togglePublish}
                  >
                    {published ? 'Unpublish' : 'Publish'}
                  </Button>
                </>
              }
            />
            <BuilderScroll className="space-y-3 lg:p-6">
              {criteria.length === 0 ? (
                <EmptyState
                  icon={<ListChecks size={24} />}
                  title="No criteria yet"
                  description="Add questions inspectors will answer. You can reorder them anytime."
                />
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
                  <SortableList items={sorted} onReorder={handleReorder}>
                    {sorted.map((c, i) => (
                      <SortableRow
                        key={c.id}
                        value={c}
                        selected={selectedId === c.id}
                        onSelect={() => {
                          setSelectedId(c.id)
                          setEditor({ mode: 'edit', criterion: c })
                        }}
                        onMoveUp={() => moveCriterion(c, -1)}
                        onMoveDown={() => moveCriterion(c, 1)}
                        onDelete={() => handleDelete(c)}
                        canUp={i > 0}
                        canDown={i < sorted.length - 1}
                      >
                        <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          {c.question}
                        </span>
                        <Badge variant={severityVariant(c.severity)} className="text-[10px]">
                          {c.severity}
                        </Badge>
                        {c.requiresPhoto ? (
                          <Badge variant="outline" className="text-[10px]">
                            photo
                          </Badge>
                        ) : null}
                      </SortableRow>
                    ))}
                  </SortableList>
                </div>
              )}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setEditor({ mode: 'add' })}
              >
                <Plus size={14} /> Add question
              </Button>
            </BuilderScroll>
          </>
        }
      />

      <BankCriterionEditorDrawer
        editor={editor}
        onClose={() => setEditor(null)}
        onSave={saveCriterion}
      />
    </>
  )
}

function BankCriterionEditorDrawer({
  editor,
  onClose,
  onSave,
}: {
  editor: EditorState | null
  onClose: () => void
  onSave: (data: {
    question: string
    description: string | null
    severity: Severity
    requiresPhoto: boolean
  }) => void
}) {
  const [question, setQuestion] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [severity, setSeverity] = React.useState<Severity>('medium')
  const [requiresPhoto, setRequiresPhoto] = React.useState(false)

  React.useEffect(() => {
    if (!editor) return
    const c = editor.criterion
    setQuestion(c?.question ?? '')
    setDescription(c?.description ?? '')
    setSeverity(c?.severity ?? 'medium')
    setRequiresPhoto(c?.requiresPhoto ?? false)
  }, [editor])

  return (
    <Drawer
      open={!!editor}
      onClose={onClose}
      title={editor?.mode === 'add' ? 'Add question' : 'Edit question'}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!question.trim()}
            onClick={() =>
              onSave({
                question: question.trim(),
                description: description.trim() || null,
                severity,
                requiresPhoto,
              })
            }
          >
            {editor?.mode === 'add' ? 'Add' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Question</Label>
          <Textarea
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Webbing free of cuts, fraying, or burns?"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional guidance shown to the inspector."
          />
        </div>
        <div className="space-y-1.5">
          <Label>Severity on fail</Label>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requiresPhoto}
              onChange={(e) => setRequiresPhoto(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
            />
            <span className="flex items-center gap-1.5">
              <Camera size={13} /> Require a photo
            </span>
          </label>
        </div>
      </div>
    </Drawer>
  )
}

function BankSettingsPanel({ bank }: { bank: BuilderBank }) {
  const [, start] = React.useTransition()
  const [name, setName] = React.useState(bank.name)
  const [description, setDescription] = React.useState(bank.description ?? '')
  const [category, setCategory] = React.useState(bank.category ?? '')

  function save() {
    start(async () => {
      try {
        await updateBank({ id: bank.id, name, description, category: category || null })
        toast.success('Saved')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to save')
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
        <Label>Category</Label>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex justify-end">
        <Button onClick={save}>
          <Save size={14} /> Save
        </Button>
      </div>
    </div>
  )
}
