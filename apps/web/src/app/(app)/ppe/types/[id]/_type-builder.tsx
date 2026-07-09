'use client'

// PPE TYPE builder — 1/3 settings rail + 2/3 build surface, mirroring the
// inspections type builder. The type owns its criteria directly, organised into
// drag-reorderable, kind-scoped sections. A "Pre-use / Annual" toggle switches
// which checklist you're building; each kind keeps its own sections + criteria.
// Criteria carry PPE severity (a failed high/critical check auto-spawns a
// corrective action). "Import from bank" copies a PPE criteria bank in as a new
// section in the active kind.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Reorder, useDragControls } from 'framer-motion'
import {
  Boxes,
  Camera,
  GripVertical,
  HardHat,
  LayoutList,
  ListChecks,
  Plus,
  Save,
  Settings2,
  Trash2,
} from 'lucide-react'
import { Badge, Button, Drawer, EmptyState, Input, Label, Select, Textarea } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { confirmDialog } from '@/lib/confirm'
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
  addTypeCriterion,
  addTypeGroup,
  deleteType,
  deleteTypeCriterion,
  deleteTypeGroup,
  importBankIntoType,
  renameTypeGroup,
  reorderTypeCriteria,
  reorderTypeGroups,
  updateType,
  updateTypeCriterion,
} from './_actions'

type Kind = 'pre_use' | 'annual'
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

export type BuilderType = {
  id: string
  name: string
  category: string | null
  isInspectable: boolean
  everyDays: number | null
  requiresCertificate: boolean
  sizingScheme: string[] | null
}
export type BuilderGroup = { id: string; label: string; sequence: number; inspectionKind: Kind }
export type BuilderCriterion = {
  id: string
  groupId: string | null
  sequence: number
  question: string
  description: string | null
  severity: Severity
  requiresPhoto: boolean
  inspectionKind: Kind
}
export type BuilderBank = {
  id: string
  name: string
  category: string | null
  criteriaCount: number
}

type EditorState = { mode: 'add' | 'edit'; groupId: string | null; criterion?: BuilderCriterion }

export function PpeTypeBuilder({
  type,
  groups: initialGroups,
  criteria: initialCriteria,
  banks,
  itemCount,
  activitySlot,
}: {
  type: BuilderType
  groups: BuilderGroup[]
  criteria: BuilderCriterion[]
  banks: BuilderBank[]
  itemCount: number
  activitySlot: React.ReactNode
}) {
  const router = useRouter()
  const [, startTransition] = React.useTransition()
  const [groups, setGroups] = React.useState(initialGroups)
  const [criteria, setCriteria] = React.useState(initialCriteria)
  const [kind, setKind] = React.useState<Kind>('pre_use')
  const [leftTab, setLeftTab] = React.useState<'build' | 'settings' | 'activity'>('build')
  const [editor, setEditor] = React.useState<EditorState | null>(null)
  const [importing, setImporting] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  React.useEffect(() => setGroups(initialGroups), [initialGroups])
  React.useEffect(() => setCriteria(initialCriteria), [initialCriteria])

  const run = React.useCallback(
    (fn: () => Promise<unknown>, errMsg = 'Something went wrong') => {
      startTransition(async () => {
        try {
          await fn()
        } catch (e) {
          toast.error(e instanceof Error ? e.message : errMsg)
          router.refresh()
        }
      })
    },
    [router],
  )

  const persistGroupOrder = useDebouncedCallback((ids: string[]) =>
    run(() => reorderTypeGroups({ typeId: type.id, kind, ids })),
  )
  const persistCriteriaOrder = useDebouncedCallback((groupId: string | null, ids: string[]) =>
    run(() => reorderTypeCriteria({ typeId: type.id, groupId, ids })),
  )

  const criteriaFor = React.useCallback(
    (groupId: string | null) =>
      criteria
        .filter((c) => c.inspectionKind === kind && (c.groupId ?? null) === groupId)
        .sort((a, b) => a.sequence - b.sequence),
    [criteria, kind],
  )
  const sortedGroups = groups
    .filter((g) => g.inspectionKind === kind)
    .sort((a, b) => a.sequence - b.sequence)
  const ungrouped = criteriaFor(null)
  const kindCriteria = criteria.filter((c) => c.inspectionKind === kind)
  const isEmpty = sortedGroups.length === 0 && ungrouped.length === 0
  const counts: Record<Kind, number> = {
    pre_use: criteria.filter((c) => c.inspectionKind === 'pre_use').length,
    annual: criteria.filter((c) => c.inspectionKind === 'annual').length,
  }

  // --- groups ---
  function handleAddGroup() {
    const seq = sortedGroups.length
    run(async () => {
      const res = await addTypeGroup({ typeId: type.id, kind })
      if (res?.id)
        setGroups((g) => [
          ...g,
          { id: res.id!, label: 'New section', sequence: seq, inspectionKind: kind },
        ])
    })
  }
  function handleGroupReorder(next: BuilderGroup[]) {
    const reseq = next.map((g, i) => ({ ...g, sequence: i }))
    setGroups((all) => [...all.filter((g) => g.inspectionKind !== kind), ...reseq])
    persistGroupOrder(reseq.map((g) => g.id))
  }
  function handleRenameGroup(id: string, label: string) {
    setGroups((g) => g.map((x) => (x.id === id ? { ...x, label } : x)))
    run(() => renameTypeGroup({ typeId: type.id, id, label }))
  }
  function handleDeleteGroup(id: string) {
    setCriteria((c) => c.map((x) => (x.groupId === id ? { ...x, groupId: null } : x)))
    setGroups((g) => g.filter((x) => x.id !== id))
    run(() => deleteTypeGroup({ typeId: type.id, id }))
  }

  // --- criteria ---
  function handleCriteriaReorder(groupId: string | null, next: BuilderCriterion[]) {
    const ids = new Set(next.map((c) => c.id))
    const reseq = next.map((c, i) => ({ ...c, sequence: i, groupId }))
    setCriteria((all) => [...all.filter((c) => !ids.has(c.id)), ...reseq])
    persistCriteriaOrder(
      groupId,
      reseq.map((c) => c.id),
    )
  }
  function moveCriterion(c: BuilderCriterion, delta: -1 | 1) {
    const list = criteriaFor(c.groupId ?? null)
    const i = list.findIndex((x) => x.id === c.id)
    const j = i + delta
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    handleCriteriaReorder(c.groupId ?? null, next)
  }
  function handleDeleteCriterion(c: BuilderCriterion) {
    setCriteria((all) => all.filter((x) => x.id !== c.id))
    if (selectedId === c.id) setSelectedId(null)
    run(() => deleteTypeCriterion({ typeId: type.id, id: c.id }))
  }
  function openAdd(groupId: string | null) {
    setEditor({ mode: 'add', groupId })
  }
  function openEdit(c: BuilderCriterion) {
    setSelectedId(c.id)
    setEditor({ mode: 'edit', groupId: c.groupId ?? null, criterion: c })
  }
  function saveCriterion(data: {
    question: string
    description: string | null
    severity: Severity
    requiresPhoto: boolean
    groupId: string | null
  }) {
    if (!editor) return
    if (editor.mode === 'add') {
      const seq = criteriaFor(data.groupId).length
      run(async () => {
        const res = await addTypeCriterion({ typeId: type.id, kind, ...data })
        if (res?.id)
          setCriteria((all) => [
            ...all,
            { id: res.id!, sequence: seq, inspectionKind: kind, ...data },
          ])
      })
    } else if (editor.criterion) {
      const id = editor.criterion.id
      const moving = (data.groupId ?? null) !== (editor.criterion.groupId ?? null)
      const seq = moving ? criteriaFor(data.groupId).length : editor.criterion.sequence
      setCriteria((all) => all.map((x) => (x.id === id ? { ...x, ...data, sequence: seq } : x)))
      run(() => updateTypeCriterion({ typeId: type.id, kind, id, ...data }))
    }
    setEditor(null)
  }

  // --- import ---
  function handleImport(bankId: string) {
    run(async () => {
      const res = await importBankIntoType({ typeId: type.id, bankId, kind })
      if (res?.group) {
        const g = res.group as BuilderGroup
        setGroups((prev) => [...prev, g])
        setCriteria((prev) => [
          ...prev,
          ...res.criteria.map(
            (c) => ({ ...c, groupId: g.id, inspectionKind: kind }) as BuilderCriterion,
          ),
        ])
        toast.success(`Imported ${res.criteria.length} criteria from "${res.bankName}"`)
      }
      setImporting(false)
    })
  }

  const kindLabel = kind === 'pre_use' ? 'Pre-use' : 'Annual'

  return (
    <>
      <BuilderShell
        left={
          <>
            <BuilderRailHeader icon={<HardHat size={15} />} title={type.name} subtitle="PPE type" />
            <BuilderRailTabs>
              <BuilderRailTab
                active={leftTab === 'build'}
                onClick={() => setLeftTab('build')}
                icon={<LayoutList size={14} />}
                label="Build"
              />
              <BuilderRailTab
                active={leftTab === 'settings'}
                onClick={() => setLeftTab('settings')}
                icon={<Settings2 size={14} />}
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
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500 dark:text-slate-400">Checklist</Label>
                    <KindToggle kind={kind} onChange={setKind} counts={counts} />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Build the {kindLabel.toLowerCase()} checklist this PPE type runs. Group
                    questions into sections, drag to reorder, or import a saved bank as a section.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={handleAddGroup}
                  >
                    <Plus size={14} /> Add section
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => openAdd(null)}
                  >
                    <ListChecks size={14} /> Add question
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => setImporting(true)}
                  >
                    <Boxes size={14} /> Import from bank
                  </Button>
                </div>
              ) : leftTab === 'settings' ? (
                <SettingsPanel
                  type={type}
                  itemCount={itemCount}
                  onDeleted={() => router.push('/ppe/types')}
                />
              ) : (
                activitySlot
              )}
            </BuilderScroll>
          </>
        }
        right={
          <>
            <BuilderSurfaceHeader
              icon={<LayoutList size={15} />}
              title={`${kindLabel} checklist`}
              actions={
                <>
                  <Badge variant="secondary">
                    {sortedGroups.length} section{sortedGroups.length === 1 ? '' : 's'}
                  </Badge>
                  <Badge variant="secondary">
                    {kindCriteria.length} criteri{kindCriteria.length === 1 ? 'on' : 'a'}
                  </Badge>
                </>
              }
            />
            <BuilderScroll className="space-y-3 lg:p-6">
              {isEmpty ? (
                <EmptyState
                  icon={<ListChecks size={24} />}
                  title={`No ${kindLabel.toLowerCase()} criteria yet`}
                  description="Add a section and questions, or import a saved bank to get started."
                />
              ) : null}

              <Reorder.Group
                axis="y"
                values={sortedGroups}
                onReorder={handleGroupReorder}
                as="div"
                className="space-y-3"
              >
                {sortedGroups.map((g) => (
                  <GroupCard
                    key={g.id}
                    group={g}
                    criteria={criteriaFor(g.id)}
                    selectedId={selectedId}
                    onRename={handleRenameGroup}
                    onAddCriterion={openAdd}
                    onDeleteGroup={handleDeleteGroup}
                    onReorder={handleCriteriaReorder}
                    onSelect={openEdit}
                    onMove={moveCriterion}
                    onDeleteCriterion={handleDeleteCriterion}
                  />
                ))}
              </Reorder.Group>

              {ungrouped.length > 0 ? (
                <CriteriaSection
                  title="Ungrouped"
                  criteria={ungrouped}
                  selectedId={selectedId}
                  onAddCriterion={() => openAdd(null)}
                  onReorder={(next) => handleCriteriaReorder(null, next)}
                  onSelect={openEdit}
                  onMove={moveCriterion}
                  onDeleteCriterion={handleDeleteCriterion}
                />
              ) : null}

              <Button variant="outline" className="w-full" onClick={handleAddGroup}>
                <Plus size={14} /> Add section
              </Button>
            </BuilderScroll>
          </>
        }
      />

      <CriterionEditorDrawer
        editor={editor}
        groups={sortedGroups}
        onClose={() => setEditor(null)}
        onSave={saveCriterion}
      />
      <ImportBankDrawer
        open={importing}
        banks={banks}
        kindLabel={kindLabel}
        onClose={() => setImporting(false)}
        onImport={handleImport}
      />
    </>
  )
}

function KindToggle({
  kind,
  onChange,
  counts,
}: {
  kind: Kind
  onChange: (k: Kind) => void
  counts: Record<Kind, number>
}) {
  return (
    <div className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-950">
      {(['pre_use', 'annual'] as Kind[]).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition ${
            kind === k
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {k === 'pre_use' ? 'Pre-use' : 'Annual'}
          <span className="ml-1.5 text-slate-400">{counts[k]}</span>
        </button>
      ))}
    </div>
  )
}

// --- group card (a draggable section) --------------------------------------

function GroupCard({
  group,
  criteria,
  selectedId,
  onRename,
  onAddCriterion,
  onDeleteGroup,
  onReorder,
  onSelect,
  onMove,
  onDeleteCriterion,
}: {
  group: BuilderGroup
  criteria: BuilderCriterion[]
  selectedId: string | null
  onRename: (id: string, label: string) => void
  onAddCriterion: (groupId: string) => void
  onDeleteGroup: (id: string) => void
  onReorder: (groupId: string, next: BuilderCriterion[]) => void
  onSelect: (c: BuilderCriterion) => void
  onMove: (c: BuilderCriterion, delta: -1 | 1) => void
  onDeleteCriterion: (c: BuilderCriterion) => void
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={group}
      dragListener={false}
      dragControls={controls}
      as="div"
      className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      <header className="flex items-center gap-2 border-b border-slate-100 px-2 py-1.5 dark:border-slate-800">
        <button
          type="button"
          aria-label="Drag section"
          onPointerDown={(e) => controls.start(e)}
          className="cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600"
        >
          <GripVertical size={15} />
        </button>
        <input
          defaultValue={group.label}
          aria-label="Section name"
          onBlur={(e) => {
            const v = e.target.value.trim() || 'Section'
            if (v !== group.label) onRename(group.id, v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-slate-900 hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:outline-none dark:text-slate-100 dark:hover:border-slate-700 dark:focus:bg-slate-950"
        />
        <Badge variant="secondary">{criteria.length}</Badge>
        <Button size="sm" variant="ghost" onClick={() => onAddCriterion(group.id)}>
          <Plus size={13} /> Question
        </Button>
        <button
          type="button"
          aria-label="Delete section"
          onClick={() => onDeleteGroup(group.id)}
          className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/40"
        >
          <Trash2 size={14} />
        </button>
      </header>
      <div className="p-2">
        {criteria.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-slate-400 dark:text-slate-500">
            No questions yet — add one or drag criteria here.
          </p>
        ) : (
          <SortableList items={criteria} onReorder={(next) => onReorder(group.id, next)}>
            {criteria.map((c, i) => (
              <SortableRow
                key={c.id}
                value={c}
                selected={selectedId === c.id}
                onSelect={() => onSelect(c)}
                onMoveUp={() => onMove(c, -1)}
                onMoveDown={() => onMove(c, 1)}
                onDelete={() => onDeleteCriterion(c)}
                canUp={i > 0}
                canDown={i < criteria.length - 1}
              >
                <CriterionContent c={c} />
              </SortableRow>
            ))}
          </SortableList>
        )}
      </div>
    </Reorder.Item>
  )
}

// A non-draggable section (used for the "Ungrouped" bucket).
function CriteriaSection({
  title,
  criteria,
  selectedId,
  onAddCriterion,
  onReorder,
  onSelect,
  onMove,
  onDeleteCriterion,
}: {
  title: string
  criteria: BuilderCriterion[]
  selectedId: string | null
  onAddCriterion: () => void
  onReorder: (next: BuilderCriterion[]) => void
  onSelect: (c: BuilderCriterion) => void
  onMove: (c: BuilderCriterion, delta: -1 | 1) => void
  onDeleteCriterion: (c: BuilderCriterion) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-dashed border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
      <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 dark:border-slate-800">
        <span className="flex-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
          {title}
        </span>
        <Badge variant="secondary">{criteria.length}</Badge>
        <Button size="sm" variant="ghost" onClick={onAddCriterion}>
          <Plus size={13} /> Question
        </Button>
      </header>
      <div className="p-2">
        <SortableList items={criteria} onReorder={onReorder}>
          {criteria.map((c, i) => (
            <SortableRow
              key={c.id}
              value={c}
              selected={selectedId === c.id}
              onSelect={() => onSelect(c)}
              onMoveUp={() => onMove(c, -1)}
              onMoveDown={() => onMove(c, 1)}
              onDelete={() => onDeleteCriterion(c)}
              canUp={i > 0}
              canDown={i < criteria.length - 1}
            >
              <CriterionContent c={c} />
            </SortableRow>
          ))}
        </SortableList>
      </div>
    </div>
  )
}

function CriterionContent({ c }: { c: BuilderCriterion }) {
  return (
    <>
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
    </>
  )
}

// --- criterion editor drawer (add / edit) ----------------------------------

function CriterionEditorDrawer({
  editor,
  groups,
  onClose,
  onSave,
}: {
  editor: EditorState | null
  groups: BuilderGroup[]
  onClose: () => void
  onSave: (data: {
    question: string
    description: string | null
    severity: Severity
    requiresPhoto: boolean
    groupId: string | null
  }) => void
}) {
  const [question, setQuestion] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [severity, setSeverity] = React.useState<Severity>('medium')
  const [requiresPhoto, setRequiresPhoto] = React.useState(false)
  const [groupId, setGroupId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!editor) return
    const c = editor.criterion
    setQuestion(c?.question ?? '')
    setDescription(c?.description ?? '')
    setSeverity(c?.severity ?? 'medium')
    setRequiresPhoto(c?.requiresPhoto ?? false)
    setGroupId(editor.groupId ?? c?.groupId ?? null)
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
                groupId,
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
        <div className="space-y-1.5">
          <Label>Section</Label>
          <Select value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value || null)}>
            <option value="">Ungrouped</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
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

function ImportBankDrawer({
  open,
  banks,
  kindLabel,
  onClose,
  onImport,
}: {
  open: boolean
  banks: BuilderBank[]
  kindLabel: string
  onClose: () => void
  onImport: (bankId: string) => void
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Import from a bank"
      description={`Copy a saved criteria bank in as a new section on the ${kindLabel.toLowerCase()} checklist. Edits afterwards stay on this type.`}
      size="sm"
    >
      {banks.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No published banks yet. Create one under PPE → Criteria banks.
        </p>
      ) : (
        <ul className="space-y-2">
          {banks.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-800"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  {b.name}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {b.category ? `${b.category.replace(/_/g, ' ')} · ` : ''}
                  {b.criteriaCount} criteri{b.criteriaCount === 1 ? 'on' : 'a'}
                </div>
              </div>
              <Button size="sm" onClick={() => onImport(b.id)}>
                Import
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  )
}

// --- settings panel --------------------------------------------------------

const CATEGORY_OPTIONS = [
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

function SettingsPanel({
  type,
  itemCount,
  onDeleted,
}: {
  type: BuilderType
  itemCount: number
  onDeleted: () => void
}) {
  const [, start] = React.useTransition()
  const [name, setName] = React.useState(type.name)
  const [category, setCategory] = React.useState(type.category ?? '')
  const [isInspectable, setIsInspectable] = React.useState(type.isInspectable)
  const [everyDays, setEveryDays] = React.useState(type.everyDays ? String(type.everyDays) : '')
  const [requiresCertificate, setRequiresCertificate] = React.useState(type.requiresCertificate)
  const [sizing, setSizing] = React.useState(
    type.sizingScheme && type.sizingScheme.length > 0 ? type.sizingScheme.join(', ') : '',
  )

  function save() {
    start(async () => {
      try {
        await updateType({
          id: type.id,
          name,
          category: category || null,
          isInspectable,
          everyDays: everyDays.trim() ? Number(everyDays) : null,
          requiresCertificate,
          sizingScheme: sizing.trim()
            ? sizing
                .split(/[,\n]/)
                .map((s) => s.trim())
                .filter(Boolean)
            : null,
        })
        toast.success('Saved')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to save')
      }
    })
  }
  async function del() {
    if (itemCount > 0) {
      toast.error(`Cannot delete — ${itemCount} item(s) reference this type`)
      return
    }
    if (!(await confirmDialog({ message: 'Delete this PPE type? This cannot be undone.', tone: 'danger' })))
      return
    start(async () => {
      try {
        await deleteType({ id: type.id })
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
        <Label>Category</Label>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </div>
      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-medium text-slate-500">Inspection</legend>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isInspectable}
            onChange={(e) => setIsInspectable(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
          />
          <span>This PPE type requires periodic inspection</span>
        </label>
        {isInspectable ? (
          <div className="space-y-1.5 pt-1">
            <Label className="text-xs">Inspection cadence (days)</Label>
            <Input
              type="number"
              min={1}
              value={everyDays}
              onChange={(e) => setEveryDays(e.target.value)}
              placeholder="e.g. 30"
            />
          </div>
        ) : null}
      </fieldset>
      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-medium text-slate-500">Certificates</legend>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={requiresCertificate}
            onChange={(e) => setRequiresCertificate(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
          />
          <span>This PPE type requires third-party recertification certificates</span>
        </label>
        <p className="px-1 text-xs text-slate-500 dark:text-slate-400">
          When on, items of this type get a Certificates tab for uploading the signed annual
          recertification (e.g. a harness inspection by a certified rigger).
        </p>
      </fieldset>
      <div className="space-y-1.5">
        <Label>Sizing scheme</Label>
        <Textarea
          rows={2}
          value={sizing}
          onChange={(e) => setSizing(e.target.value)}
          placeholder="S, M, L, XL"
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Comma- or newline-separated valid sizes. Shown as a dropdown when issuing or editing items
          of this type.
        </p>
      </div>
      <div className="flex justify-end">
        <Button onClick={save}>
          <Save size={14} /> Save
        </Button>
      </div>

      <div className="mt-4 rounded-md border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-950 dark:bg-rose-950/20">
        <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-300">Delete PPE type</h3>
        <p className="mt-0.5 text-xs text-rose-700/80 dark:text-rose-300/80">
          Removes this type and its criteria. Only allowed when no items reference it.
        </p>
        <div className="mt-2 flex justify-end">
          <Button
            variant="outline"
            className="text-rose-600 hover:bg-rose-50"
            disabled={itemCount > 0}
            onClick={del}
          >
            <Trash2 size={14} /> Delete type
          </Button>
        </div>
      </div>
    </div>
  )
}
