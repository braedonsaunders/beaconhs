'use client'

// Inspection TYPE builder — 1/3 settings rail + 2/3 build surface. The type
// owns its criteria directly, organised into drag-reorderable groups; criteria
// drag within a group, and a criterion's drawer lets you move it between
// groups. "Import from bank" copies a bank's criteria into a new group.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Reorder, useDragControls } from 'framer-motion'
import {
  Boxes,
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
  deleteInspectionType,
  deleteTypeCriterion,
  deleteTypeGroup,
  importBankIntoType,
  renameTypeGroup,
  reorderTypeCriteria,
  reorderTypeGroups,
  toggleInspectionTypePublished,
  updateInspectionType,
  updateTypeCriterion,
} from '../_actions'

type ResponseType = 'pass_fail_na' | 'yes_no' | 'rating'
const RESPONSE_TYPES: ResponseType[] = ['pass_fail_na', 'yes_no', 'rating']
const RESPONSE_LABELS: Record<ResponseType, string> = {
  pass_fail_na: 'Pass / Fail / N-A',
  yes_no: 'Yes / No',
  rating: 'Rating',
}

export type BuilderType = {
  id: string
  name: string
  description: string | null
  defaultCadence: string | null
  requiresForeman: boolean
  requiresCustomerSignature: boolean
  enableCorrectiveActions: boolean
  allowCompliantNotes: boolean
  isPublished: boolean
}
export type BuilderGroup = { id: string; label: string; sequence: number }
export type BuilderCriterion = {
  id: string
  groupId: string | null
  sequence: number
  text: string
  responseType: ResponseType
  requiresPhoto: boolean
  requiresComment: boolean
}
export type BuilderBank = {
  id: string
  name: string
  category: string | null
  criteriaCount: number
}

type EditorState = { mode: 'add' | 'edit'; groupId: string | null; criterion?: BuilderCriterion }

export function InspectionTypeBuilder({
  type,
  groups: initialGroups,
  criteria: initialCriteria,
  banks,
  activitySlot,
}: {
  type: BuilderType
  groups: BuilderGroup[]
  criteria: BuilderCriterion[]
  banks: BuilderBank[]
  activitySlot: React.ReactNode
}) {
  const router = useRouter()
  const [, startTransition] = React.useTransition()
  const [groups, setGroups] = React.useState(initialGroups)
  const [criteria, setCriteria] = React.useState(initialCriteria)
  const [leftTab, setLeftTab] = React.useState<'build' | 'settings' | 'activity'>('build')
  const [published, setPublished] = React.useState(type.isPublished)
  const [editor, setEditor] = React.useState<EditorState | null>(null)
  const [importing, setImporting] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  // Re-seed from server only when props change (error-path refresh); the happy
  // path mutates local state directly so drag/edits don't flicker.
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
  function saveCriterion(data: {
    text: string
    responseType: ResponseType
    requiresPhoto: boolean
    requiresComment: boolean
    groupId: string | null
  }) {
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

  // --- import ---
  function handleImport(bankId: string) {
    run(async () => {
      const res = await importBankIntoType({ typeId: type.id, bankId })
      if (res?.group) {
        const g = res.group
        setGroups((prev) => [...prev, g])
        setCriteria((prev) => [
          ...prev,
          ...res.criteria.map((c) => ({ ...c, groupId: g.id }) as BuilderCriterion),
        ])
        toast.success(`Imported ${res.criteria.length} criteria from "${res.bankName}"`)
      }
      setImporting(false)
    })
  }

  // --- publish ---
  function togglePublish() {
    const next = !published
    setPublished(next)
    run(() => toggleInspectionTypePublished({ id: type.id, next }))
  }

  return (
    <>
      <BuilderShell
        left={
          <>
            <BuilderRailHeader
              icon={<ClipboardList size={15} />}
              title={type.name}
              subtitle="Inspection type"
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
                    reorder, or import a saved bank as a section.
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
                <SettingsPanel type={type} onDeleted={() => router.push('/inspections/types')} />
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
              {isEmpty ? (
                <EmptyState
                  icon={<ListChecks size={24} />}
                  title="No criteria yet"
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
        onClose={() => setImporting(false)}
        onImport={handleImport}
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
        {c.text}
      </span>
      <span className="hidden shrink-0 text-[11px] text-slate-400 sm:inline">
        {RESPONSE_LABELS[c.responseType]}
      </span>
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
  onSave: (data: {
    text: string
    responseType: ResponseType
    requiresPhoto: boolean
    requiresComment: boolean
    groupId: string | null
  }) => void
}) {
  const [text, setText] = React.useState('')
  const [responseType, setResponseType] = React.useState<ResponseType>('pass_fail_na')
  const [requiresPhoto, setRequiresPhoto] = React.useState(false)
  const [requiresComment, setRequiresComment] = React.useState(false)
  const [groupId, setGroupId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!editor) return
    const c = editor.criterion
    setText(c?.text ?? '')
    setResponseType(c?.responseType ?? 'pass_fail_na')
    setRequiresPhoto(c?.requiresPhoto ?? false)
    setRequiresComment(c?.requiresComment ?? false)
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
            disabled={!text.trim()}
            onClick={() =>
              onSave({ text: text.trim(), responseType, requiresPhoto, requiresComment, groupId })
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
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Are walkways clear and unobstructed?"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label>Response type</Label>
          <Select
            value={responseType}
            onChange={(e) => setResponseType(e.target.value as ResponseType)}
          >
            {RESPONSE_TYPES.map((r) => (
              <option key={r} value={r}>
                {RESPONSE_LABELS[r]}
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
        </div>
      </div>
    </Drawer>
  )
}

function ImportBankDrawer({
  open,
  banks,
  onClose,
  onImport,
}: {
  open: boolean
  banks: BuilderBank[]
  onClose: () => void
  onImport: (bankId: string) => void
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Import from a bank"
      description="Copy a saved criteria bank in as a new section. Edits afterwards stay on this type."
      size="sm"
    >
      {banks.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No published banks yet. Create one under Inspections → Banks.
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

const CADENCES = [
  { value: '', label: '— No default —' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'year', label: 'Yearly' },
]

function SettingsPanel({ type, onDeleted }: { type: BuilderType; onDeleted: () => void }) {
  const [, start] = React.useTransition()
  const [name, setName] = React.useState(type.name)
  const [description, setDescription] = React.useState(type.description ?? '')
  const [defaultCadence, setDefaultCadence] = React.useState(type.defaultCadence ?? '')
  const [requiresForeman, setRequiresForeman] = React.useState(type.requiresForeman)
  const [requiresCustomerSignature, setRequiresCustomerSignature] = React.useState(
    type.requiresCustomerSignature,
  )
  const [enableCorrectiveActions, setEnableCorrectiveActions] = React.useState(
    type.enableCorrectiveActions,
  )
  const [allowCompliantNotes, setAllowCompliantNotes] = React.useState(type.allowCompliantNotes)

  function save() {
    start(async () => {
      try {
        await updateInspectionType({
          id: type.id,
          name,
          description,
          defaultCadence,
          requiresForeman,
          requiresCustomerSignature,
          enableCorrectiveActions,
          allowCompliantNotes,
        })
        toast.success('Saved')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to save')
      }
    })
  }
  function del() {
    if (!window.confirm('Delete this inspection type? This cannot be undone.')) return
    start(async () => {
      try {
        await deleteInspectionType({ id: type.id })
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
        <Label>Default cadence</Label>
        <Select value={defaultCadence} onChange={(e) => setDefaultCadence(e.target.value)}>
          {CADENCES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </div>
      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-medium text-slate-500">Workflow</legend>
        <CheckboxRow
          label="Requires foreman"
          checked={requiresForeman}
          onChange={setRequiresForeman}
        />
        <CheckboxRow
          label="Requires customer signature"
          checked={requiresCustomerSignature}
          onChange={setRequiresCustomerSignature}
        />
        <CheckboxRow
          label="Auto-spawn corrective actions on fail (severity ≥ high)"
          checked={enableCorrectiveActions}
          onChange={setEnableCorrectiveActions}
        />
        <CheckboxRow
          label="Allow compliant notes"
          checked={allowCompliantNotes}
          onChange={setAllowCompliantNotes}
        />
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
