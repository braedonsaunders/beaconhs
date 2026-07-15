'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import * as React from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import { Boxes, GripVertical, LayoutList, ListChecks, Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Drawer, EmptyState } from '@beaconhs/ui'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast'
import { confirmDialog } from '@/lib/confirm'
import { useReseededState } from '@/lib/use-reseeded-state'
import { SortableList, SortableRow, useDebouncedCallback } from './sortable-list'
import { BuilderSurfaceHeader } from './builder-shell'
import {
  moveItemById,
  replaceItemsById,
  replaceScopedItems,
  resequenceItems,
  sequenceCriteria,
} from './checklist-order'

type ChecklistGroup = {
  id: string
  label: string
  sequence: number
}

type ChecklistCriterion = {
  id: string
  groupId: string | null
  sequence: number
}

type ChecklistScope<G, C> = {
  group: (group: G) => boolean
  criterion: (criterion: C) => boolean
}

const ALL_ITEMS = {
  group: () => true,
  criterion: () => true,
}

/**
 * Shared optimistic state transitions for checklist builders. Persistence stays
 * in each domain adapter, while ordering, grouping, and scoped PPE views use one
 * tested client-side model.
 */
function useChecklistState<G extends ChecklistGroup, C extends ChecklistCriterion>(
  initialGroups: G[],
  initialCriteria: C[],
  scope: ChecklistScope<G, C> = ALL_ITEMS,
) {
  const [groups, setGroups] = useReseededState(initialGroups, initialGroups)
  const [criteria, setCriteria] = useReseededState(initialCriteria, initialCriteria)

  const criteriaFor = React.useCallback(
    (groupId: string | null) =>
      criteria
        .filter((criterion) => scope.criterion(criterion) && criterion.groupId === groupId)
        .sort((a, b) => a.sequence - b.sequence),
    [criteria, scope],
  )

  const scopedGroups = groups.filter(scope.group).sort((a, b) => a.sequence - b.sequence)
  const scopedCriteria = criteria.filter(scope.criterion)
  const ungrouped = criteriaFor(null)

  function replaceScopedGroups(next: G[]): G[] {
    const resequenced = resequenceItems(next)
    setGroups((all) => replaceScopedItems(all, resequenced, scope.group))
    return resequenced
  }

  function renameGroup(id: string, label: string) {
    setGroups((all) => all.map((group) => (group.id === id ? { ...group, label } : group)))
  }

  function removeGroup(id: string) {
    setCriteria((all) =>
      all.map((criterion) =>
        criterion.groupId === id ? { ...criterion, groupId: null } : criterion,
      ),
    )
    setGroups((all) => all.filter((group) => group.id !== id))
  }

  function reorderCriteria(groupId: string | null, next: C[]): C[] {
    const resequenced = sequenceCriteria(next, groupId)
    setCriteria((all) => replaceItemsById(all, resequenced))
    return resequenced
  }

  function moveCriterion(criterion: C, delta: -1 | 1): C[] | null {
    const groupId = criterion.groupId
    const list = criteriaFor(groupId)
    const next = moveItemById(list, criterion.id, delta)
    if (!next) return null
    return reorderCriteria(groupId, next)
  }

  function removeCriterion(id: string) {
    setCriteria((all) => all.filter((criterion) => criterion.id !== id))
  }

  return {
    groups,
    criteria,
    setGroups,
    setCriteria,
    scopedGroups,
    scopedCriteria,
    criteriaFor,
    ungrouped,
    isEmpty: scopedGroups.length === 0 && scopedCriteria.length === 0,
    replaceScopedGroups,
    renameGroup,
    removeGroup,
    reorderCriteria,
    moveCriterion,
    removeCriterion,
  }
}

/** Runs a server mutation in a transition and restores server truth on error. */
export function useBuilderActionRunner(defaultError = 'Something went wrong') {
  const tGeneratedValue = useGeneratedValueTranslations()
  const router = useRouter()
  const [, startTransition] = React.useTransition()

  return React.useCallback(
    (action: () => Promise<unknown>, errorMessage = defaultError) => {
      startTransition(async () => {
        try {
          await action()
        } catch (error) {
          toast.error(tGeneratedValue(error instanceof Error ? error.message : errorMessage))
          router.refresh()
        }
      })
    },
    [defaultError, router, tGeneratedValue],
  )
}

type ChecklistEditorState<C> = {
  mode: 'add' | 'edit'
  groupId: string | null
  criterion?: C
}

type ChecklistControllerActions<G extends ChecklistGroup, C extends ChecklistCriterion, D> = {
  createGroup: (sequence: number) => Promise<G | null>
  renameGroup: (id: string, label: string) => Promise<unknown>
  deleteGroup: (id: string) => Promise<unknown>
  reorderGroups: (ids: string[]) => Promise<unknown>
  createCriterion: (data: D, sequence: number) => Promise<C | null>
  updateCriterion: (id: string, data: D) => Promise<unknown>
  deleteCriterion: (id: string) => Promise<unknown>
  reorderCriteria: (groupId: string | null, ids: string[]) => Promise<unknown>
}

/**
 * Adapts the matching server-action contract used by inspection type builders
 * into the domain-neutral checklist controller. Domain validation remains in
 * each server action; this only binds the type id and constructs optimistic
 * records from the returned ids.
 */
type TypeChecklistPersistence<D> = {
  addGroup: (input: { typeId: string }) => Promise<{ id?: string }>
  renameGroup: (input: { typeId: string; id: string; label: string }) => Promise<unknown>
  deleteGroup: (input: { typeId: string; id: string }) => Promise<unknown>
  reorderGroups: (input: { typeId: string; ids: string[] }) => Promise<unknown>
  addCriterion: (input: { typeId: string } & D) => Promise<{ id?: string }>
  updateCriterion: (input: { typeId: string; id: string } & D) => Promise<unknown>
  deleteCriterion: (input: { typeId: string; id: string }) => Promise<unknown>
  reorderCriteria: (input: {
    typeId: string
    groupId: string | null
    ids: string[]
  }) => Promise<unknown>
}

function createTypeChecklistActions<D extends { groupId: string | null }>(
  typeId: string,
  persistence: TypeChecklistPersistence<D>,
): ChecklistControllerActions<ChecklistGroup, ChecklistCriterion & D, D> {
  return {
    createGroup: async (sequence) => {
      const result = await persistence.addGroup({ typeId })
      return result.id ? { id: result.id, label: 'New section', sequence } : null
    },
    renameGroup: (id, label) => persistence.renameGroup({ typeId, id, label }),
    deleteGroup: (id) => persistence.deleteGroup({ typeId, id }),
    reorderGroups: (ids) => persistence.reorderGroups({ typeId, ids }),
    createCriterion: async (data, sequence) => {
      const result = await persistence.addCriterion({ typeId, ...data })
      return result.id ? { id: result.id, sequence, ...data } : null
    },
    updateCriterion: (id, data) => persistence.updateCriterion({ typeId, id, ...data }),
    deleteCriterion: (id) => persistence.deleteCriterion({ typeId, id }),
    reorderCriteria: (groupId, ids) => persistence.reorderCriteria({ typeId, groupId, ids }),
  }
}

export function useTypeChecklistController<D extends { groupId: string | null }>(
  typeId: string,
  initialGroups: ChecklistGroup[],
  initialCriteria: (ChecklistCriterion & D)[],
  persistence: TypeChecklistPersistence<D>,
) {
  return useChecklistController<ChecklistGroup, ChecklistCriterion & D, D>({
    initialGroups,
    initialCriteria,
    getGroupId: (data) => data.groupId,
    mergeCriterion: (criterion, data, sequence) => ({ ...criterion, ...data, sequence }),
    actions: createTypeChecklistActions(typeId, persistence),
  })
}

/**
 * Domain-neutral controller for sectioned checklist builders. The adapter owns
 * validation, permissions, persistence, and domain fields; this controller owns
 * their shared optimistic ordering/editing behavior.
 */
export function useChecklistController<G extends ChecklistGroup, C extends ChecklistCriterion, D>({
  initialGroups,
  initialCriteria,
  scope,
  getGroupId,
  mergeCriterion,
  actions,
}: {
  initialGroups: G[]
  initialCriteria: C[]
  scope?: ChecklistScope<G, C>
  getGroupId: (data: D) => string | null
  mergeCriterion: (criterion: C, data: D, sequence: number) => C
  actions: ChecklistControllerActions<G, C, D>
}) {
  const state = useChecklistState(initialGroups, initialCriteria, scope)
  const [editor, setEditor] = React.useState<ChecklistEditorState<C> | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const run = useBuilderActionRunner()

  const persistGroupOrder = useDebouncedCallback((ids: string[]) =>
    run(() => actions.reorderGroups(ids)),
  )
  const persistCriteriaOrder = useDebouncedCallback((groupId: string | null, ids: string[]) =>
    run(() => actions.reorderCriteria(groupId, ids)),
  )

  function addGroup() {
    const sequence = state.scopedGroups.length
    run(async () => {
      const group = await actions.createGroup(sequence)
      if (group) state.setGroups((all) => [...all, group])
    })
  }

  function reorderGroups(next: G[]) {
    const resequenced = state.replaceScopedGroups(next)
    persistGroupOrder(resequenced.map((group) => group.id))
  }

  function renameGroup(id: string, label: string) {
    state.renameGroup(id, label)
    run(() => actions.renameGroup(id, label))
  }

  function deleteGroup(id: string) {
    state.removeGroup(id)
    run(() => actions.deleteGroup(id))
  }

  function reorderCriteria(groupId: string | null, next: C[]) {
    const resequenced = state.reorderCriteria(groupId, next)
    persistCriteriaOrder(
      groupId,
      resequenced.map((criterion) => criterion.id),
    )
  }

  function moveCriterion(criterion: C, delta: -1 | 1) {
    const next = state.moveCriterion(criterion, delta)
    if (!next) return
    persistCriteriaOrder(
      criterion.groupId,
      next.map((candidate) => candidate.id),
    )
  }

  function deleteCriterion(criterion: C) {
    state.removeCriterion(criterion.id)
    if (selectedId === criterion.id) setSelectedId(null)
    run(() => actions.deleteCriterion(criterion.id))
  }

  function openAdd(groupId: string | null) {
    setEditor({ mode: 'add', groupId })
  }

  function openEdit(criterion: C) {
    setSelectedId(criterion.id)
    setEditor({ mode: 'edit', groupId: criterion.groupId, criterion })
  }

  function saveCriterion(data: D) {
    if (!editor) return
    const groupId = getGroupId(data)
    if (editor.mode === 'add') {
      const sequence = state.criteriaFor(groupId).length
      run(async () => {
        const criterion = await actions.createCriterion(data, sequence)
        if (criterion) state.setCriteria((all) => [...all, criterion])
      })
    } else if (editor.criterion) {
      const id = editor.criterion.id
      const moving = groupId !== editor.criterion.groupId
      const sequence = moving ? state.criteriaFor(groupId).length : editor.criterion.sequence
      state.setCriteria((all) =>
        all.map((criterion) =>
          criterion.id === id ? mergeCriterion(criterion, data, sequence) : criterion,
        ),
      )
      run(() => actions.updateCriterion(id, data))
    }
    setEditor(null)
  }

  return {
    ...state,
    run,
    editor,
    selectedId,
    setEditor,
    addGroup,
    reorderGroups,
    renameGroup,
    deleteGroup,
    reorderCriteria,
    moveCriterion,
    deleteCriterion,
    openAdd,
    openEdit,
    saveCriterion,
  }
}

export function ChecklistSections<G extends ChecklistGroup, C extends ChecklistCriterion>({
  groups,
  criteriaFor,
  ungrouped,
  selectedId,
  emptyTitle,
  emptyDescription,
  onGroupReorder,
  onRenameGroup,
  onAddCriterion,
  onDeleteGroup,
  onCriteriaReorder,
  onSelectCriterion,
  onMoveCriterion,
  onDeleteCriterion,
  onAddGroup,
  renderCriterion,
}: {
  groups: G[]
  criteriaFor: (groupId: string | null) => C[]
  ungrouped: C[]
  selectedId: string | null
  emptyTitle: string
  emptyDescription: string
  onGroupReorder: (next: G[]) => void
  onRenameGroup: (id: string, label: string) => void
  onAddCriterion: (groupId: string | null) => void
  onDeleteGroup: (id: string) => void
  onCriteriaReorder: (groupId: string | null, next: C[]) => void
  onSelectCriterion: (criterion: C) => void
  onMoveCriterion: (criterion: C, delta: -1 | 1) => void
  onDeleteCriterion: (criterion: C) => void
  onAddGroup: () => void
  renderCriterion: (criterion: C) => React.ReactNode
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const isEmpty = groups.length === 0 && ungrouped.length === 0

  return (
    <>
      <GeneratedValue
        value={
          isEmpty ? (
            <EmptyState
              icon={<ListChecks size={24} />}
              title={tGeneratedValue(emptyTitle)}
              description={tGeneratedValue(emptyDescription)}
            />
          ) : null
        }
      />

      <Reorder.Group
        axis="y"
        values={groups}
        onReorder={onGroupReorder}
        as="div"
        className="space-y-3"
      >
        <GeneratedValue
          value={groups.map((group) => (
            <ChecklistGroupCard
              key={group.id}
              group={group}
              criteria={criteriaFor(group.id)}
              selectedId={selectedId}
              onRename={onRenameGroup}
              onAddCriterion={onAddCriterion}
              onDeleteGroup={onDeleteGroup}
              onReorder={onCriteriaReorder}
              onSelect={onSelectCriterion}
              onMove={onMoveCriterion}
              onDeleteCriterion={onDeleteCriterion}
              renderCriterion={renderCriterion}
            />
          ))}
        />
      </Reorder.Group>

      <GeneratedValue
        value={
          ungrouped.length > 0 ? (
            <ChecklistUngroupedSection
              criteria={ungrouped}
              selectedId={selectedId}
              onAddCriterion={() => onAddCriterion(null)}
              onReorder={(next) => onCriteriaReorder(null, next)}
              onSelect={onSelectCriterion}
              onMove={onMoveCriterion}
              onDeleteCriterion={onDeleteCriterion}
              renderCriterion={renderCriterion}
            />
          ) : null
        }
      />

      <Button variant="outline" className="w-full" onClick={onAddGroup}>
        <Plus size={14} /> <GeneratedText id="m_0cfd5e4e441158" />
      </Button>
    </>
  )
}

function ChecklistGroupCard<G extends ChecklistGroup, C extends ChecklistCriterion>({
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
  renderCriterion,
}: {
  group: G
  criteria: C[]
  selectedId: string | null
  onRename: (id: string, label: string) => void
  onAddCriterion: (groupId: string) => void
  onDeleteGroup: (id: string) => void
  onReorder: (groupId: string, next: C[]) => void
  onSelect: (criterion: C) => void
  onMove: (criterion: C, delta: -1 | 1) => void
  onDeleteCriterion: (criterion: C) => void
  renderCriterion: (criterion: C) => React.ReactNode
}) {
  const tGenerated = useGeneratedTranslations()
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
          aria-label={tGenerated('m_199f4fdb73903e', { value0: group.label })}
          onPointerDown={(event) => controls.start(event)}
          className="cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600"
        >
          <GripVertical size={15} />
        </button>
        <input
          defaultValue={group.label}
          aria-label={tGenerated('m_007d422ef3c04c')}
          onBlur={(event) => {
            const label = event.target.value.trim() || 'Section'
            if (label !== group.label) onRename(group.id, label)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-slate-900 hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:outline-none dark:text-slate-100 dark:hover:border-slate-700 dark:focus:bg-slate-950"
        />
        <Badge variant="secondary">
          <GeneratedValue value={criteria.length} />
        </Badge>
        <Button size="sm" variant="ghost" onClick={() => onAddCriterion(group.id)}>
          <Plus size={13} /> <GeneratedText id="m_1a895b5691321b" />
        </Button>
        <button
          type="button"
          aria-label={tGenerated('m_0c24f3e3d43f86', { value0: group.label })}
          onClick={() => onDeleteGroup(group.id)}
          className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/40"
        >
          <Trash2 size={14} />
        </button>
      </header>
      <div className="p-2">
        <GeneratedValue
          value={
            criteria.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-slate-400 dark:text-slate-500">
                <GeneratedText id="m_16ade5ab3df0cc" />
              </p>
            ) : (
              <ChecklistCriterionList
                criteria={criteria}
                selectedId={selectedId}
                onReorder={(next) => onReorder(group.id, next)}
                onSelect={onSelect}
                onMove={onMove}
                onDelete={onDeleteCriterion}
                renderCriterion={renderCriterion}
              />
            )
          }
        />
      </div>
    </Reorder.Item>
  )
}

function ChecklistUngroupedSection<C extends ChecklistCriterion>({
  criteria,
  selectedId,
  onAddCriterion,
  onReorder,
  onSelect,
  onMove,
  onDeleteCriterion,
  renderCriterion,
}: {
  criteria: C[]
  selectedId: string | null
  onAddCriterion: () => void
  onReorder: (next: C[]) => void
  onSelect: (criterion: C) => void
  onMove: (criterion: C, delta: -1 | 1) => void
  onDeleteCriterion: (criterion: C) => void
  renderCriterion: (criterion: C) => React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-dashed border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
      <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 dark:border-slate-800">
        <span className="flex-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_124ee6c18e0195" />
        </span>
        <Badge variant="secondary">
          <GeneratedValue value={criteria.length} />
        </Badge>
        <Button size="sm" variant="ghost" onClick={onAddCriterion}>
          <Plus size={13} /> <GeneratedText id="m_1a895b5691321b" />
        </Button>
      </header>
      <div className="p-2">
        <ChecklistCriterionList
          criteria={criteria}
          selectedId={selectedId}
          onReorder={onReorder}
          onSelect={onSelect}
          onMove={onMove}
          onDelete={onDeleteCriterion}
          renderCriterion={renderCriterion}
        />
      </div>
    </div>
  )
}

function ChecklistCriterionList<C extends ChecklistCriterion>({
  criteria,
  selectedId,
  onReorder,
  onSelect,
  onMove,
  onDelete,
  renderCriterion,
}: {
  criteria: C[]
  selectedId: string | null
  onReorder: (next: C[]) => void
  onSelect: (criterion: C) => void
  onMove: (criterion: C, delta: -1 | 1) => void
  onDelete: (criterion: C) => void
  renderCriterion: (criterion: C) => React.ReactNode
}) {
  return (
    <SortableList items={criteria} onReorder={onReorder}>
      <GeneratedValue
        value={criteria.map((criterion, index) => (
          <SortableRow
            key={criterion.id}
            value={criterion}
            selected={selectedId === criterion.id}
            onSelect={() => onSelect(criterion)}
            onMoveUp={() => onMove(criterion, -1)}
            onMoveDown={() => onMove(criterion, 1)}
            onDelete={() => onDelete(criterion)}
            canUp={index > 0}
            canDown={index < criteria.length - 1}
          >
            <GeneratedValue value={renderCriterion(criterion)} />
          </SortableRow>
        ))}
      />
    </SortableList>
  )
}

export function ChecklistBuildMenu({
  description,
  before,
  onAddGroup,
  onAddCriterion,
  onImport,
}: {
  description: React.ReactNode
  before?: React.ReactNode
  onAddGroup: () => void
  onAddCriterion: () => void
  onImport?: () => void
}) {
  return (
    <div className="space-y-3">
      <GeneratedValue value={before} />
      <p className="text-xs text-slate-500 dark:text-slate-400">
        <GeneratedValue value={description} />
      </p>
      <Button variant="outline" className="w-full justify-start" onClick={onAddGroup}>
        <Plus size={14} /> <GeneratedText id="m_0cfd5e4e441158" />
      </Button>
      <Button variant="outline" className="w-full justify-start" onClick={onAddCriterion}>
        <ListChecks size={14} /> <GeneratedText id="m_029dffafbff34b" />
      </Button>
      <GeneratedValue
        value={
          onImport ? (
            <Button variant="outline" className="w-full justify-start" onClick={onImport}>
              <Boxes size={14} /> <GeneratedText id="m_1dbc4eef588fd4" />
            </Button>
          ) : null
        }
      />
    </div>
  )
}

export function ChecklistSurfaceHeader({
  title = 'Build surface',
  sectionCount,
  criterionCount,
  published,
  onTogglePublished,
}: {
  title?: React.ReactNode
  sectionCount: number
  criterionCount: number
  published?: boolean
  onTogglePublished?: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <BuilderSurfaceHeader
      icon={<LayoutList size={15} />}
      title={tGeneratedValue(title)}
      actions={
        <>
          <Badge variant="secondary">
            <GeneratedValue value={sectionCount} /> <GeneratedText id="m_02f67a0e8ba5ce" />
            <GeneratedValue
              value={sectionCount === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
            />
          </Badge>
          <Badge variant="secondary">
            <GeneratedValue value={criterionCount} /> <GeneratedText id="m_0267cb8c0ed520" />
            <GeneratedValue
              value={
                criterionCount === 1 ? (
                  <GeneratedText id="m_17414f59d8f567" />
                ) : (
                  <GeneratedText id="m_1c2ba782c97901" />
                )
              }
            />
          </Badge>
          <GeneratedValue
            value={
              published !== undefined && onTogglePublished ? (
                <Button
                  size="sm"
                  variant={published ? 'outline' : 'default'}
                  onClick={onTogglePublished}
                >
                  <GeneratedValue
                    value={
                      published ? (
                        <GeneratedText id="m_0d6976fc2d60c8" />
                      ) : (
                        <GeneratedText id="m_0c072fb8baf115" />
                      )
                    }
                  />
                </Button>
              ) : null
            }
          />
        </>
      }
    />
  )
}

export function BuilderDangerZone({
  title,
  description,
  buttonLabel,
  onDelete,
  disabled,
}: {
  title: string
  description: string
  buttonLabel: string
  onDelete: () => void
  disabled?: boolean
}) {
  return (
    <div className="mt-4 rounded-md border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-950 dark:bg-rose-950/20">
      <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-300">
        <GeneratedValue value={title} />
      </h3>
      <p className="mt-0.5 text-xs text-rose-700/80 dark:text-rose-300/80">
        <GeneratedValue value={description} />
      </p>
      <div className="mt-2 flex justify-end">
        <Button
          variant="outline"
          className="text-rose-600 hover:bg-rose-50"
          onClick={onDelete}
          disabled={disabled}
        >
          <Trash2 size={14} /> <GeneratedValue value={buttonLabel} />
        </Button>
      </div>
    </div>
  )
}

/** Keeps destructive builder settings actions consistent across domains. */
export function useConfirmedBuilderDelete({
  confirmMessage,
  action,
  onDeleted,
}: {
  confirmMessage: string
  action: () => Promise<unknown>
  onDeleted: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [, startTransition] = React.useTransition()

  return React.useCallback(async () => {
    if (!(await confirmDialog({ message: confirmMessage, tone: 'danger' }))) return
    startTransition(async () => {
      try {
        await action()
        onDeleted()
      } catch (error) {
        toast.error(
          tGeneratedValue(error instanceof Error ? error.message : tGenerated('m_1ac2672da698ce')),
        )
      }
    })
  }, [action, confirmMessage, onDeleted, tGenerated, tGeneratedValue])
}

export function BuilderCheckboxRow({
  label,
  checked,
  onChange,
  children,
}: {
  label?: string
  checked: boolean
  onChange: (value: boolean) => void
  children?: React.ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
      />
      <span>
        <GeneratedValue value={children ?? label} />
      </span>
    </label>
  )
}

type ImportableCriteriaBank = {
  id: string
  name: string
  category: string | null
  criteriaCount: number
}

export function ImportCriteriaBankDrawer({
  open,
  banks,
  description,
  emptyMessage,
  onClose,
  onImport,
}: {
  open: boolean
  banks: ImportableCriteriaBank[]
  description: string
  emptyMessage: string
  onClose: () => void
  onImport: (bankId: string) => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={tGenerated('m_00dd8f5d88a8a3')}
      description={tGeneratedValue(description)}
      size="sm"
    >
      <GeneratedValue
        value={
          banks.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              <GeneratedValue value={emptyMessage} />
            </p>
          ) : (
            <ul className="space-y-2">
              <GeneratedValue
                value={banks.map((bank) => (
                  <li
                    key={bank.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-800"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        <GeneratedValue value={bank.name} />
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        <GeneratedValue
                          value={bank.category ? `${bank.category.replace(/_/g, ' ')} · ` : ''}
                        />
                        <GeneratedValue value={bank.criteriaCount} />{' '}
                        <GeneratedText id="m_0267cb8c0ed520" />
                        <GeneratedValue
                          value={
                            bank.criteriaCount === 1 ? (
                              <GeneratedText id="m_17414f59d8f567" />
                            ) : (
                              <GeneratedText id="m_1c2ba782c97901" />
                            )
                          }
                        />
                      </div>
                    </div>
                    <Button size="sm" onClick={() => onImport(bank.id)}>
                      <GeneratedText id="m_0df79ee8347c6b" />
                    </Button>
                  </li>
                ))}
              />
            </ul>
          )
        }
      />
    </Drawer>
  )
}
