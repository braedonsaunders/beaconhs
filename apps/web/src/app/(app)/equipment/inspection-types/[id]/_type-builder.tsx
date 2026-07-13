'use client'

// Equipment inspection TYPE builder — 1/3 settings rail + 2/3 build surface,
// mirroring the inspections + PPE type builders. The type owns its criteria
// directly, organised into drag-reorderable sections; criteria drag within a
// section, and a criterion's drawer moves it between sections. Equipment
// criteria carry a kind (pass/fail · text · numeric · photo), a severity, and
// required/critical flags.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Reorder, useDragControls } from 'framer-motion'
import {
  ClipboardList,
  GripVertical,
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
import { useReseededState } from '@/lib/use-reseeded-state'
import { IntervalPicker, type IntervalValue } from '@/components/equipment/interval-picker'
import type { EquipmentIntervalUnit } from '@/lib/equipment/intervals'
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
  deleteEquipmentInspectionType,
  deleteTypeCriterion,
  deleteTypeGroup,
  renameTypeGroup,
  reorderTypeCriteria,
  reorderTypeGroups,
  updateEquipmentInspectionType,
  updateTypeCriterion,
} from '../_actions'

type Kind = 'pass_fail' | 'pass_fail_na' | 'text' | 'numeric' | 'photo'
const KINDS: Kind[] = ['pass_fail', 'pass_fail_na', 'text', 'numeric', 'photo']
const KIND_LABELS: Record<Kind, string> = {
  pass_fail: 'Pass / Fail',
  pass_fail_na: 'Pass / Fail / N/A',
  text: 'Text answer',
  numeric: 'Numeric',
  photo: 'Photo',
}

type Severity = 'low' | 'medium' | 'high' | 'critical'
const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical']
function severityVariant(s: Severity): 'destructive' | 'warning' | 'secondary' {
  return s === 'critical' || s === 'high' ? 'destructive' : s === 'medium' ? 'warning' : 'secondary'
}

type BuilderType = {
  id: string
  name: string
  description: string | null
  intervalValue: number | null
  intervalUnit: EquipmentIntervalUnit | null
  isPreUse: boolean
  appliesToTypeId: string | null
  allowPassAll: boolean
  failsSpawnWorkOrders: boolean
  isActive: boolean
}
type BuilderGroup = { id: string; label: string; sequence: number }
type BuilderCriterion = {
  id: string
  groupId: string | null
  sequence: number
  question: string
  description: string | null
  kind: Kind
  severity: Severity
  requiresPhoto: boolean
  requiresComment: boolean
  isRequired: boolean
  isCritical: boolean
}
type AppliesToOption = { id: string; name: string }

type CriterionData = Omit<BuilderCriterion, 'id' | 'sequence'>
type EditorState = { mode: 'add' | 'edit'; groupId: string | null; criterion?: BuilderCriterion }

export function EquipmentInspectionTypeBuilder({
  type,
  groups: initialGroups,
  criteria: initialCriteria,
  appliesToOptions,
  activitySlot,
}: {
  type: BuilderType
  groups: BuilderGroup[]
  criteria: BuilderCriterion[]
  appliesToOptions: AppliesToOption[]
  activitySlot: React.ReactNode
}) {
  const router = useRouter()
  const [, startTransition] = React.useTransition()
  const [groups, setGroups] = useReseededState(initialGroups, initialGroups)
  const [criteria, setCriteria] = useReseededState(initialCriteria, initialCriteria)
  const [leftTab, setLeftTab] = React.useState<'build' | 'settings' | 'activity'>('build')
  const [editor, setEditor] = React.useState<EditorState | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

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
    run(() => reorderTypeGroups({ typeId: type.id, ids })),
  )
  const persistCriteriaOrder = useDebouncedCallback((groupId: string | null, ids: string[]) =>
    run(() => reorderTypeCriteria({ typeId: type.id, groupId, ids })),
  )

  const criteriaFor = React.useCallback(
    (groupId: string | null) =>
      criteria
        .filter((c) => (c.groupId ?? null) === groupId)
        .sort((a, b) => a.sequence - b.sequence),
    [criteria],
  )
  const sortedGroups = [...groups].sort((a, b) => a.sequence - b.sequence)
  const ungrouped = criteriaFor(null)
  const isEmpty = groups.length === 0 && criteria.length === 0

  // --- groups ---
  function handleAddGroup() {
    const seq = groups.length
    run(async () => {
      const res = await addTypeGroup({ typeId: type.id })
      if (res?.id) setGroups((g) => [...g, { id: res.id!, label: 'New section', sequence: seq }])
    })
  }
  function handleGroupReorder(next: BuilderGroup[]) {
    const reseq = next.map((g, i) => ({ ...g, sequence: i }))
    setGroups(reseq)
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
  function saveCriterion(data: CriterionData) {
    if (!editor) return
    if (editor.mode === 'add') {
      const seq = criteriaFor(data.groupId).length
      run(async () => {
        const res = await addTypeCriterion({ typeId: type.id, ...data })
        if (res?.id) setCriteria((all) => [...all, { id: res.id!, sequence: seq, ...data }])
      })
    } else if (editor.criterion) {
      const id = editor.criterion.id
      const moving = (data.groupId ?? null) !== (editor.criterion.groupId ?? null)
      const seq = moving ? criteriaFor(data.groupId).length : editor.criterion.sequence
      setCriteria((all) => all.map((x) => (x.id === id ? { ...x, ...data, sequence: seq } : x)))
      run(() => updateTypeCriterion({ typeId: type.id, id, ...data }))
    }
    setEditor(null)
  }

  return (
    <>
      <BuilderShell
        left={
          <>
            <BuilderRailHeader
              icon={<ClipboardList size={15} />}
              title={type.name}
              subtitle="Equipment inspection type"
            />
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
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Build the checklist this inspection runs. Group questions into sections, drag to
                    reorder, and set each question&apos;s response type, severity, and flags.
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
                </div>
              ) : leftTab === 'settings' ? (
                <SettingsPanel
                  type={type}
                  appliesToOptions={appliesToOptions}
                  onDeleted={() => router.push('/equipment/inspection-types')}
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
              title="Build surface"
              actions={
                <>
                  <Badge variant="secondary">
                    {groups.length} section{groups.length === 1 ? '' : 's'}
                  </Badge>
                  <Badge variant="secondary">{criteria.length} criteria</Badge>
                </>
              }
            />
            <BuilderScroll className="space-y-3 lg:p-6">
              {isEmpty ? (
                <EmptyState
                  icon={<ListChecks size={24} />}
                  title="No criteria yet"
                  description="Add a section and questions to build this inspection checklist."
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
    </>
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
      <span className="hidden shrink-0 text-[11px] text-slate-400 sm:inline">
        {KIND_LABELS[c.kind]}
      </span>
      <Badge variant={severityVariant(c.severity)} className="text-[10px]">
        {c.severity}
      </Badge>
      {c.isCritical ? (
        <Badge variant="destructive" className="text-[10px]">
          critical
        </Badge>
      ) : null}
      {!c.isRequired ? (
        <Badge variant="outline" className="text-[10px]">
          optional
        </Badge>
      ) : null}
      {c.requiresPhoto ? (
        <Badge variant="outline" className="text-[10px]">
          photo
        </Badge>
      ) : null}
      {c.requiresComment ? (
        <Badge variant="outline" className="text-[10px]">
          comment
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
  onSave: (data: CriterionData) => void
}) {
  const criterion = editor?.criterion
  const [question, setQuestion] = useReseededState(editor, criterion?.question ?? '')
  const [description, setDescription] = useReseededState(editor, criterion?.description ?? '')
  const [kind, setKind] = useReseededState<Kind>(editor, criterion?.kind ?? 'pass_fail')
  const [severity, setSeverity] = useReseededState<Severity>(
    editor,
    criterion?.severity ?? 'medium',
  )
  const [requiresPhoto, setRequiresPhoto] = useReseededState(
    editor,
    criterion?.requiresPhoto ?? false,
  )
  const [requiresComment, setRequiresComment] = useReseededState(
    editor,
    criterion?.requiresComment ?? false,
  )
  const [isRequired, setIsRequired] = useReseededState(editor, criterion?.isRequired ?? true)
  const [isCritical, setIsCritical] = useReseededState(editor, criterion?.isCritical ?? false)
  const [groupId, setGroupId] = useReseededState<string | null>(
    editor,
    editor?.groupId ?? criterion?.groupId ?? null,
  )

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
                kind,
                severity,
                requiresPhoto,
                requiresComment,
                isRequired,
                isCritical,
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
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder='e.g. "Are the brake lights working?"'
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Response type</Label>
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Severity</Label>
            <Select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s[0]!.toUpperCase() + s.slice(1)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Help text</Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional guidance for the inspector"
          />
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
          <CheckboxRow label="Required answer" checked={isRequired} onChange={setIsRequired} />
          <CheckboxRow
            label="Require a photo"
            checked={requiresPhoto}
            onChange={setRequiresPhoto}
          />
          <CheckboxRow
            label="Require a comment"
            checked={requiresComment}
            onChange={setRequiresComment}
          />
          <CheckboxRow
            label="Critical (a fail forces a work order + red flag)"
            checked={isCritical}
            onChange={setIsCritical}
          />
        </div>
      </div>
    </Drawer>
  )
}

// --- settings panel --------------------------------------------------------

function SettingsPanel({
  type,
  appliesToOptions,
  onDeleted,
}: {
  type: BuilderType
  appliesToOptions: AppliesToOption[]
  onDeleted: () => void
}) {
  const [, start] = React.useTransition()
  const [name, setName] = React.useState(type.name)
  const [description, setDescription] = React.useState(type.description ?? '')
  const [interval, setInterval] = React.useState<IntervalValue>({
    isPreUse: type.isPreUse,
    intervalValue: type.intervalValue,
    intervalUnit: type.intervalUnit,
  })
  const [appliesToTypeId, setAppliesToTypeId] = React.useState(type.appliesToTypeId ?? '')
  const [allowPassAll, setAllowPassAll] = React.useState(type.allowPassAll)
  const [failsSpawnWorkOrders, setFailsSpawnWorkOrders] = React.useState(type.failsSpawnWorkOrders)
  const [isActive, setIsActive] = React.useState(type.isActive)

  function save() {
    start(async () => {
      try {
        await updateEquipmentInspectionType({
          id: type.id,
          name,
          description,
          intervalValue: interval.intervalValue,
          intervalUnit: interval.intervalUnit,
          isPreUse: interval.isPreUse,
          appliesToTypeId: appliesToTypeId || null,
          allowPassAll,
          failsSpawnWorkOrders,
          isActive,
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
        message: 'Delete this inspection type? Existing records are kept.',
        tone: 'danger',
      }))
    )
      return
    start(async () => {
      try {
        await deleteEquipmentInspectionType({ id: type.id })
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
        <Label>Applies to equipment type</Label>
        <Select value={appliesToTypeId} onChange={(e) => setAppliesToTypeId(e.target.value)}>
          <option value="">— Any equipment —</option>
          {appliesToOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </div>
      <IntervalPicker
        value={interval}
        onChange={setInterval}
        label="Default interval"
        allowPreUse
        idPrefix="eit-settings-interval"
      />
      <div className="space-y-1.5">
        <Label>Description</Label>
        <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-medium text-slate-500">Behaviour</legend>
        <CheckboxRow
          label='Allow "pass all" shortcut'
          checked={allowPassAll}
          onChange={setAllowPassAll}
        />
        <CheckboxRow
          label="Failed criterion auto-creates a work order"
          checked={failsSpawnWorkOrders}
          onChange={setFailsSpawnWorkOrders}
        />
        <CheckboxRow label="Active (available to run)" checked={isActive} onChange={setIsActive} />
      </fieldset>
      <div className="flex justify-end">
        <Button onClick={save}>
          <Save size={14} /> Save
        </Button>
      </div>

      <div className="mt-4 rounded-md border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-950 dark:bg-rose-950/20">
        <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-300">
          Delete inspection type
        </h3>
        <p className="mt-0.5 text-xs text-rose-700/80 dark:text-rose-300/80">
          Removes this type from the library. Existing records are unaffected.
        </p>
        <div className="mt-2 flex justify-end">
          <Button variant="outline" className="text-rose-600 hover:bg-rose-50" onClick={del}>
            <Trash2 size={14} /> Delete type
          </Button>
        </div>
      </div>
    </div>
  )
}

function CheckboxRow({
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
