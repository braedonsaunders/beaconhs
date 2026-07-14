'use client'

import * as React from 'react'
import { Boxes, ListChecks, Plus, Save } from 'lucide-react'
import { Badge, Button, EmptyState, Input, Label, Select, Textarea } from '@beaconhs/ui'
import { useReseededState } from '@/lib/use-reseeded-state'
import { toast } from '@/lib/toast'
import {
  BuilderRailHeader,
  BuilderRailTab,
  BuilderRailTabs,
  BuilderScroll,
  BuilderShell,
  BuilderSurfaceHeader,
} from './builder-shell'
import { SortableList, SortableRow, useDebouncedCallback } from './sortable-list'
import { useBuilderActionRunner } from './checklist-builder'
import { moveItemById, resequenceItems } from './checklist-order'

type FlatBank = {
  id: string
  name: string
  isPublished: boolean
}

type FlatBankCriterion = {
  id: string
  sequence: number
}

type FlatBankEditorState<C> = { mode: 'add'; criterion?: never } | { mode: 'edit'; criterion: C }

export function FlatCriteriaBankBuilder<C extends FlatBankCriterion, D>({
  bank,
  initialCriteria,
  activitySlot,
  intro,
  emptyDescription,
  settings,
  actions,
  materializeCriterion,
  renderCriterion,
  renderEditor,
}: {
  bank: FlatBank
  initialCriteria: C[]
  activitySlot: React.ReactNode
  intro: string
  emptyDescription: string
  settings: React.ReactNode
  actions: {
    add: (data: D) => Promise<{ id?: string } | void>
    update: (id: string, data: D) => Promise<unknown>
    delete: (id: string) => Promise<unknown>
    reorder: (ids: string[]) => Promise<unknown>
    setPublished: (next: boolean) => Promise<unknown>
  }
  materializeCriterion: (input: { id: string; sequence: number; data: D }) => C
  renderCriterion: (criterion: C) => React.ReactNode
  renderEditor: (props: {
    editor: FlatBankEditorState<C> | null
    onClose: () => void
    onSave: (data: D) => void
  }) => React.ReactNode
}) {
  const [criteria, setCriteria] = useReseededState(initialCriteria, initialCriteria)
  const [leftTab, setLeftTab] = React.useState<'build' | 'settings' | 'activity'>('build')
  const [published, setPublished] = React.useState(bank.isPublished)
  const [editor, setEditor] = React.useState<FlatBankEditorState<C> | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const run = useBuilderActionRunner()

  const persistOrder = useDebouncedCallback((ids: string[]) => run(() => actions.reorder(ids)))
  const sorted = [...criteria].sort((a, b) => a.sequence - b.sequence)

  function handleReorder(next: C[]) {
    const resequenced = resequenceItems(next)
    setCriteria(resequenced)
    persistOrder(resequenced.map((criterion) => criterion.id))
  }

  function moveCriterion(criterion: C, delta: -1 | 1) {
    const next = moveItemById(sorted, criterion.id, delta)
    if (!next) return
    handleReorder(next)
  }

  function handleDelete(criterion: C) {
    setCriteria((all) => all.filter((candidate) => candidate.id !== criterion.id))
    if (selectedId === criterion.id) setSelectedId(null)
    run(() => actions.delete(criterion.id))
  }

  function saveCriterion(data: D) {
    if (!editor) return
    if (editor.mode === 'add') {
      const sequence = criteria.length
      run(async () => {
        const result = await actions.add(data)
        if (result?.id) {
          setCriteria((all) => [...all, materializeCriterion({ id: result.id!, sequence, data })])
        }
      })
    } else {
      const id = editor.criterion.id
      setCriteria((all) =>
        all.map((criterion) =>
          criterion.id === id
            ? materializeCriterion({ id, sequence: criterion.sequence, data })
            : criterion,
        ),
      )
      run(() => actions.update(id, data))
    }
    setEditor(null)
  }

  function togglePublish() {
    const next = !published
    setPublished(next)
    run(() => actions.setPublished(next))
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
                  <p className="text-xs text-slate-500 dark:text-slate-400">{intro}</p>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => setEditor({ mode: 'add' })}
                  >
                    <Plus size={14} /> Add question
                  </Button>
                </div>
              ) : leftTab === 'settings' ? (
                settings
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
                  description={emptyDescription}
                />
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
                  <SortableList items={sorted} onReorder={handleReorder}>
                    {sorted.map((criterion, index) => (
                      <SortableRow
                        key={criterion.id}
                        value={criterion}
                        selected={selectedId === criterion.id}
                        onSelect={() => {
                          setSelectedId(criterion.id)
                          setEditor({ mode: 'edit', criterion })
                        }}
                        onMoveUp={() => moveCriterion(criterion, -1)}
                        onMoveDown={() => moveCriterion(criterion, 1)}
                        onDelete={() => handleDelete(criterion)}
                        canUp={index > 0}
                        canDown={index < sorted.length - 1}
                      >
                        {renderCriterion(criterion)}
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

      {renderEditor({ editor, onClose: () => setEditor(null), onSave: saveCriterion })}
    </>
  )
}

export function CriteriaBankSettings({
  bank,
  categories,
  update,
}: {
  bank: FlatBank & { description: string | null; category: string | null }
  categories: { value: string; label: string }[]
  update: (input: {
    id: string
    name: string
    description: string
    category: string | null
  }) => Promise<unknown>
}) {
  const [, startTransition] = React.useTransition()
  const [name, setName] = React.useState(bank.name)
  const [description, setDescription] = React.useState(bank.description ?? '')
  const [category, setCategory] = React.useState(bank.category ?? '')

  function save() {
    startTransition(async () => {
      try {
        await update({ id: bank.id, name, description, category: category || null })
        toast.success('Saved')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Name *</Label>
        <Input value={name} onChange={(event) => setName(event.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label>Description</Label>
        <Textarea
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Category</Label>
        <Select value={category} onChange={(event) => setCategory(event.target.value)}>
          {categories.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
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
