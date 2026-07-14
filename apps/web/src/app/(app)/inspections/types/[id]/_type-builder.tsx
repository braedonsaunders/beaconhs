'use client'

// Inspection TYPE builder — 1/3 settings rail + 2/3 build surface. The type
// owns its criteria directly, organised into drag-reorderable groups; criteria
// drag within a group, and a criterion's drawer lets you move it between
// groups. "Import from bank" copies a bank's criteria into a new group.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, Save } from 'lucide-react'
import { Badge, Button, Input, Label, Select, Textarea } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import {
  BuilderRailHeader,
  BuilderRailNavigation,
  BuilderScroll,
  BuilderShell,
} from '@/components/builder/builder-shell'
import {
  BuilderDangerZone,
  BuilderCheckboxRow,
  ChecklistBuildMenu,
  ChecklistSections,
  ChecklistSurfaceHeader,
  ImportCriteriaBankDrawer,
  useBuilderActionRunner,
  useConfirmedBuilderDelete,
  useTypeChecklistController,
} from '@/components/builder/checklist-builder'
import {
  INSPECTION_RESPONSE_LABELS as RESPONSE_LABELS,
  InspectionCriterionEditorDrawer,
  type InspectionResponseType as ResponseType,
} from '@/components/builder/criterion-editors'
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

type BuilderType = {
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
type BuilderGroup = { id: string; label: string; sequence: number }
type BuilderCriterion = {
  id: string
  groupId: string | null
  sequence: number
  text: string
  responseType: ResponseType
  choiceOptions: string[]
  requiresPhoto: boolean
  requiresComment: boolean
}
type BuilderBank = {
  id: string
  name: string
  category: string | null
  criteriaCount: number
}

type CriterionData = Omit<BuilderCriterion, 'id' | 'sequence'>
const checklistPersistence = {
  addGroup: addTypeGroup,
  renameGroup: renameTypeGroup,
  deleteGroup: deleteTypeGroup,
  reorderGroups: reorderTypeGroups,
  addCriterion: addTypeCriterion,
  updateCriterion: updateTypeCriterion,
  deleteCriterion: deleteTypeCriterion,
  reorderCriteria: reorderTypeCriteria,
}

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
  const checklist = useTypeChecklistController<CriterionData>(
    type.id,
    initialGroups,
    initialCriteria,
    checklistPersistence,
  )
  const [leftTab, setLeftTab] = React.useState<'build' | 'settings' | 'activity'>('build')
  const [published, setPublished] = React.useState(type.isPublished)
  const [importing, setImporting] = React.useState(false)

  // --- import ---
  function handleImport(bankId: string) {
    checklist.run(async () => {
      const res = await importBankIntoType({ typeId: type.id, bankId })
      if (res?.group) {
        const g = res.group
        checklist.setGroups((prev) => [...prev, g])
        checklist.setCriteria((prev) => [
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
    checklist.run(async () => {
      await toggleInspectionTypePublished({ id: type.id, next })
      setPublished(next)
    })
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
            <BuilderRailNavigation active={leftTab} onChange={setLeftTab} />
            <BuilderScroll>
              {leftTab === 'build' ? (
                <ChecklistBuildMenu
                  description="Build the checklist this inspection runs. Group questions into sections, drag to reorder, or import a saved bank as a section."
                  onAddGroup={checklist.addGroup}
                  onAddCriterion={() => checklist.openAdd(null)}
                  onImport={() => setImporting(true)}
                />
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
            <ChecklistSurfaceHeader
              sectionCount={checklist.groups.length}
              criterionCount={checklist.criteria.length}
              published={published}
              onTogglePublished={togglePublish}
            />
            <BuilderScroll className="space-y-3 lg:p-6">
              <ChecklistSections
                groups={checklist.scopedGroups}
                criteriaFor={checklist.criteriaFor}
                ungrouped={checklist.ungrouped}
                selectedId={checklist.selectedId}
                emptyTitle="No criteria yet"
                emptyDescription="Add a section and questions, or import a saved bank to get started."
                onGroupReorder={checklist.reorderGroups}
                onRenameGroup={checklist.renameGroup}
                onAddCriterion={checklist.openAdd}
                onDeleteGroup={checklist.deleteGroup}
                onCriteriaReorder={checklist.reorderCriteria}
                onSelectCriterion={checklist.openEdit}
                onMoveCriterion={checklist.moveCriterion}
                onDeleteCriterion={checklist.deleteCriterion}
                onAddGroup={checklist.addGroup}
                renderCriterion={(criterion) => <CriterionContent c={criterion} />}
              />
            </BuilderScroll>
          </>
        }
      />

      <InspectionCriterionEditorDrawer
        editor={checklist.editor}
        groups={checklist.scopedGroups}
        onClose={() => checklist.setEditor(null)}
        onSave={checklist.saveCriterion}
      />
      <ImportCriteriaBankDrawer
        open={importing}
        banks={banks}
        description="Copy a saved criteria bank in as a new section. Edits afterwards stay on this type."
        emptyMessage="No published banks yet. Create one under Inspections → Banks."
        onClose={() => setImporting(false)}
        onImport={handleImport}
      />
    </>
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
      {c.responseType === 'choice' ? (
        <Badge variant="outline" className="text-[10px]">
          {c.choiceOptions.length} options
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
  const run = useBuilderActionRunner('Failed to save')
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
  const deleteType = useConfirmedBuilderDelete({
    confirmMessage: 'Delete this inspection type? This cannot be undone.',
    action: () => deleteInspectionType({ id: type.id }),
    onDeleted,
  })

  function save() {
    run(async () => {
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
        <BuilderCheckboxRow
          label="Requires foreman"
          checked={requiresForeman}
          onChange={setRequiresForeman}
        />
        <BuilderCheckboxRow
          label="Requires customer signature"
          checked={requiresCustomerSignature}
          onChange={setRequiresCustomerSignature}
        />
        <BuilderCheckboxRow
          label="Auto-spawn corrective actions on fail (severity ≥ high)"
          checked={enableCorrectiveActions}
          onChange={setEnableCorrectiveActions}
        />
        <BuilderCheckboxRow
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

      <BuilderDangerZone
        title="Delete inspection type"
        description="Removes this type from the library. Existing records are unaffected."
        buttonLabel="Delete type"
        onDelete={deleteType}
      />
    </div>
  )
}
