'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
        toast.success(
          tGenerated('m_0773f5db0728c4', { value0: res.criteria.length, value1: res.bankName }),
        )
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
              title={tGeneratedValue(type.name)}
              subtitle={tGenerated('m_0bbd7790743193')}
            />
            <BuilderRailNavigation active={leftTab} onChange={setLeftTab} />
            <BuilderScroll>
              <GeneratedValue
                value={
                  leftTab === 'build' ? (
                    <ChecklistBuildMenu
                      description={tGenerated('m_046e5255db1485')}
                      onAddGroup={checklist.addGroup}
                      onAddCriterion={() => checklist.openAdd(null)}
                      onImport={() => setImporting(true)}
                    />
                  ) : leftTab === 'settings' ? (
                    <SettingsPanel
                      type={type}
                      onDeleted={() => router.push('/inspections/types')}
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
        description={tGenerated('m_14e054a891bfd2')}
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
        <GeneratedValue value={c.text} />
      </span>
      <span className="hidden shrink-0 text-[11px] text-slate-400 sm:inline">
        <GeneratedValue value={RESPONSE_LABELS[c.responseType]} />
      </span>
      <GeneratedValue
        value={
          c.responseType === 'choice' ? (
            <Badge variant="outline" className="text-[10px]">
              <GeneratedValue value={c.choiceOptions.length} />{' '}
              <GeneratedText id="m_13be14e62f47a1" />
            </Badge>
          ) : null
        }
      />
      <GeneratedValue
        value={
          c.requiresPhoto ? (
            <Badge variant="outline" className="text-[10px]">
              <GeneratedText id="m_07cb1cfb72cff4" />
            </Badge>
          ) : null
        }
      />
      <GeneratedValue
        value={
          c.requiresComment ? (
            <Badge variant="outline" className="text-[10px]">
              <GeneratedText id="m_05b9f700b46533" />
            </Badge>
          ) : null
        }
      />
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
  const tGenerated = useGeneratedTranslations()
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
      toast.success(tGenerated('m_0a0569b726b225'))
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
          <GeneratedText id="m_0a1355e9241639" />
        </Label>
        <Select value={defaultCadence} onChange={(e) => setDefaultCadence(e.target.value)}>
          <GeneratedValue
            value={CADENCES.map((c) => (
              <option key={c.value} value={c.value}>
                <GeneratedValue value={c.label} />
              </option>
            ))}
          />
        </Select>
      </div>
      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-medium text-slate-500">
          <GeneratedText id="m_0766273722e564" />
        </legend>
        <BuilderCheckboxRow
          label={tGenerated('m_009aa82c778013')}
          checked={requiresForeman}
          onChange={setRequiresForeman}
        />
        <BuilderCheckboxRow
          label={tGenerated('m_07085f507bc4a0')}
          checked={requiresCustomerSignature}
          onChange={setRequiresCustomerSignature}
        />
        <BuilderCheckboxRow
          label={tGenerated('m_1bc1e69de7f1bc')}
          checked={enableCorrectiveActions}
          onChange={setEnableCorrectiveActions}
        />
        <BuilderCheckboxRow
          label={tGenerated('m_0f1dacb4f6caeb')}
          checked={allowCompliantNotes}
          onChange={setAllowCompliantNotes}
        />
      </fieldset>
      <div className="flex justify-end">
        <Button onClick={save}>
          <Save size={14} /> <GeneratedText id="m_19e6bff894c3c7" />
        </Button>
      </div>

      <BuilderDangerZone
        title={tGenerated('m_0f55d85091996a')}
        description={tGenerated('m_1ba34d70c06f79')}
        buttonLabel={tGenerated('m_12fda1066d2e96')}
        onDelete={deleteType}
      />
    </div>
  )
}
