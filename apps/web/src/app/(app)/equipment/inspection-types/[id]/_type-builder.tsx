'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Equipment inspection TYPE builder — 1/3 settings rail + 2/3 build surface,
// mirroring the inspections + PPE type builders. The type owns its criteria
// directly, organised into drag-reorderable sections; criteria drag within a
// section, and a criterion's drawer moves it between sections. Equipment
// criteria carry a kind (pass/fail · text · numeric · photo), a severity, and
// required/critical flags.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, Save } from 'lucide-react'
import { Badge, Button, Drawer, Input, Label, Select, Textarea } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { useReseededState } from '@/lib/use-reseeded-state'
import { IntervalPicker, type IntervalValue } from '@/components/equipment/interval-picker'
import type { EquipmentIntervalUnit } from '@/lib/equipment/intervals'
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
  useBuilderActionRunner,
  useConfirmedBuilderDelete,
  useTypeChecklistController,
} from '@/components/builder/checklist-builder'
import {
  INSPECTION_SEVERITIES as SEVERITIES,
  inspectionSeverityBadgeVariant as severityVariant,
  type InspectionSeverity as Severity,
} from '@/components/builder/inspection-severity'
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

  return (
    <>
      <BuilderShell
        left={
          <>
            <BuilderRailHeader
              icon={<ClipboardList size={15} />}
              title={tGeneratedValue(type.name)}
              subtitle={tGenerated('m_03b2f52cde82fc')}
            />
            <BuilderRailNavigation active={leftTab} onChange={setLeftTab} />
            <BuilderScroll>
              <GeneratedValue
                value={
                  leftTab === 'build' ? (
                    <ChecklistBuildMenu
                      description={tGeneratedValue(
                        <>
                          Build the checklist this inspection runs. Group questions into sections,
                          drag to reorder, and set each question&apos;s response type, severity, and
                          flags.
                        </>,
                      )}
                      onAddGroup={checklist.addGroup}
                      onAddCriterion={() => checklist.openAdd(null)}
                    />
                  ) : leftTab === 'settings' ? (
                    <SettingsPanel
                      type={type}
                      appliesToOptions={appliesToOptions}
                      onDeleted={() => router.push('/equipment/inspection-types')}
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
            />
            <BuilderScroll className="space-y-3 lg:p-6">
              <ChecklistSections
                groups={checklist.scopedGroups}
                criteriaFor={checklist.criteriaFor}
                ungrouped={checklist.ungrouped}
                selectedId={checklist.selectedId}
                emptyTitle="No criteria yet"
                emptyDescription="Add a section and questions to build this inspection checklist."
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

      <CriterionEditorDrawer
        editor={checklist.editor}
        groups={checklist.scopedGroups}
        onClose={() => checklist.setEditor(null)}
        onSave={checklist.saveCriterion}
      />
    </>
  )
}

function CriterionContent({ c }: { c: BuilderCriterion }) {
  return (
    <>
      <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
        <GeneratedValue value={c.question} />
      </span>
      <span className="hidden shrink-0 text-[11px] text-slate-400 sm:inline">
        <GeneratedValue value={KIND_LABELS[c.kind]} />
      </span>
      <Badge variant={severityVariant(c.severity)} className="text-[10px]">
        <GeneratedValue value={c.severity} />
      </Badge>
      <GeneratedValue
        value={
          c.isCritical ? (
            <Badge variant="destructive" className="text-[10px]">
              <GeneratedText id="m_027e9229c5c0d4" />
            </Badge>
          ) : null
        }
      />
      <GeneratedValue
        value={
          !c.isRequired ? (
            <Badge variant="outline" className="text-[10px]">
              <GeneratedText id="m_1577dda730dc14" />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
      title={tGeneratedValue(
        editor?.mode === 'add' ? tGenerated('m_029dffafbff34b') : tGenerated('m_06b6a61fd2d8b0'),
      )}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            <GeneratedText id="m_112e2e8ecda428" />
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
            <GeneratedValue
              value={
                editor?.mode === 'add' ? (
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
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_1a895b5691321b" />
          </Label>
          <Textarea
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={tGenerated('m_1efa198f25d91b')}
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_15eb6eb85b34f2" />
            </Label>
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <GeneratedValue
                value={KINDS.map((k) => (
                  <option key={k} value={k}>
                    <GeneratedValue value={KIND_LABELS[k]} />
                  </option>
                ))}
              />
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_168b365cc671bf" />
            </Label>
            <Select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
              <GeneratedValue
                value={SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    <GeneratedValue value={s[0]!.toUpperCase() + s.slice(1)} />
                  </option>
                ))}
              />
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_0d04877b1a742b" />
          </Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={tGenerated('m_0905e10141cf65')}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_0d513924d97753" />
          </Label>
          <Select value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value || null)}>
            <option value="">
              <GeneratedText id="m_124ee6c18e0195" />
            </option>
            <GeneratedValue
              value={groups.map((g) => (
                <option key={g.id} value={g.id}>
                  <GeneratedValue value={g.label} />
                </option>
              ))}
            />
          </Select>
        </div>
        <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <BuilderCheckboxRow
            label={tGenerated('m_14d46dc4a638d2')}
            checked={isRequired}
            onChange={setIsRequired}
          />
          <BuilderCheckboxRow
            label={tGenerated('m_0a9994281e867d')}
            checked={requiresPhoto}
            onChange={setRequiresPhoto}
          />
          <BuilderCheckboxRow
            label={tGenerated('m_1cff8028d13785')}
            checked={requiresComment}
            onChange={setRequiresComment}
          />
          <BuilderCheckboxRow
            label={tGenerated('m_128a2cbf7aa028')}
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
  const tGenerated = useGeneratedTranslations()
  const run = useBuilderActionRunner('Failed to save')
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
  const deleteType = useConfirmedBuilderDelete({
    confirmMessage: 'Delete this inspection type? Existing records are kept.',
    action: () => deleteEquipmentInspectionType({ id: type.id }),
    onDeleted,
  })

  function save() {
    run(async () => {
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
          <GeneratedText id="m_0cd8311e50d877" />
        </Label>
        <Select value={appliesToTypeId} onChange={(e) => setAppliesToTypeId(e.target.value)}>
          <option value="">
            <GeneratedText id="m_1130ef09787df0" />
          </option>
          <GeneratedValue
            value={appliesToOptions.map((o) => (
              <option key={o.id} value={o.id}>
                <GeneratedValue value={o.name} />
              </option>
            ))}
          />
        </Select>
      </div>
      <IntervalPicker
        value={interval}
        onChange={setInterval}
        label={tGenerated('m_0d61ed6a4b09fb')}
        allowPreUse
        idPrefix="eit-settings-interval"
      />
      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_14d923495cf14c" />
        </Label>
        <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-medium text-slate-500">
          <GeneratedText id="m_0da99b13b19b75" />
        </legend>
        <BuilderCheckboxRow
          label={tGenerated('m_1def60bb7c277d')}
          checked={allowPassAll}
          onChange={setAllowPassAll}
        />
        <BuilderCheckboxRow
          label={tGenerated('m_00bc92b4183bbc')}
          checked={failsSpawnWorkOrders}
          onChange={setFailsSpawnWorkOrders}
        />
        <BuilderCheckboxRow
          label={tGenerated('m_0a11d953082971')}
          checked={isActive}
          onChange={setIsActive}
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
