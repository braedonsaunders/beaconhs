'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// PPE TYPE builder — 1/3 settings rail + 2/3 build surface, mirroring the
// inspections type builder. The type owns its criteria directly, organised into
// drag-reorderable, kind-scoped sections. A "Pre-use / Annual" toggle switches
// which checklist you're building; each kind keeps its own sections + criteria.
// Criteria carry PPE severity (a failed high/critical check auto-spawns a
// corrective action). "Import from bank" copies a PPE criteria bank in as a new
// section in the active kind.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { HardHat, Save } from 'lucide-react'
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
  useChecklistController,
} from '@/components/builder/checklist-builder'
import { SeverityCriterionEditorDrawer } from '@/components/builder/criterion-editors'
import {
  inspectionSeverityBadgeVariant as severityVariant,
  type InspectionSeverity as Severity,
} from '@/components/builder/inspection-severity'
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

type BuilderType = {
  id: string
  name: string
  category: string | null
  isInspectable: boolean
  everyDays: number | null
  requiresCertificate: boolean
  sizingScheme: string[] | null
}
type BuilderGroup = { id: string; label: string; sequence: number; inspectionKind: Kind }
type BuilderCriterion = {
  id: string
  groupId: string | null
  sequence: number
  question: string
  description: string | null
  severity: Severity
  requiresPhoto: boolean
  inspectionKind: Kind
}
type BuilderBank = {
  id: string
  name: string
  category: string | null
  criteriaCount: number
}

type CriterionData = Omit<BuilderCriterion, 'id' | 'sequence' | 'inspectionKind'>

export function PpeTypeBuilder({
  type,
  groups: initialGroups,
  criteria: initialCriteria,
  banks,
  itemCount,
  customFieldCount,
  activitySlot,
}: {
  type: BuilderType
  groups: BuilderGroup[]
  criteria: BuilderCriterion[]
  banks: BuilderBank[]
  itemCount: number
  customFieldCount: number
  activitySlot: React.ReactNode
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [kind, setKind] = React.useState<Kind>('pre_use')
  const scope = React.useMemo(
    () => ({
      group: (group: BuilderGroup) => group.inspectionKind === kind,
      criterion: (criterion: BuilderCriterion) => criterion.inspectionKind === kind,
    }),
    [kind],
  )
  const checklist = useChecklistController<BuilderGroup, BuilderCriterion, CriterionData>({
    initialGroups,
    initialCriteria,
    scope,
    getGroupId: (data) => data.groupId,
    mergeCriterion: (criterion, data, sequence) => ({ ...criterion, ...data, sequence }),
    actions: {
      createGroup: async (sequence) => {
        const result = await addTypeGroup({ typeId: type.id, kind })
        return result?.id
          ? { id: result.id, label: 'New section', sequence, inspectionKind: kind }
          : null
      },
      renameGroup: (id, label) => renameTypeGroup({ typeId: type.id, id, label }),
      deleteGroup: (id) => deleteTypeGroup({ typeId: type.id, id }),
      reorderGroups: (ids) => reorderTypeGroups({ typeId: type.id, kind, ids }),
      createCriterion: async (data, sequence) => {
        const result = await addTypeCriterion({ typeId: type.id, kind, ...data })
        return result?.id ? { id: result.id, sequence, inspectionKind: kind, ...data } : null
      },
      updateCriterion: (id, data) => updateTypeCriterion({ typeId: type.id, kind, id, ...data }),
      deleteCriterion: (id) => deleteTypeCriterion({ typeId: type.id, id }),
      reorderCriteria: (groupId, ids) => reorderTypeCriteria({ typeId: type.id, groupId, ids }),
    },
  })
  const [leftTab, setLeftTab] = React.useState<'build' | 'settings' | 'activity'>('build')
  const [importing, setImporting] = React.useState(false)

  const counts: Record<Kind, number> = {
    pre_use: checklist.criteria.filter((c) => c.inspectionKind === 'pre_use').length,
    annual: checklist.criteria.filter((c) => c.inspectionKind === 'annual').length,
  }

  // --- import ---
  function handleImport(bankId: string) {
    checklist.run(async () => {
      const res = await importBankIntoType({ typeId: type.id, bankId, kind })
      if (res?.group) {
        const g = res.group as BuilderGroup
        checklist.setGroups((prev) => [...prev, g])
        checklist.setCriteria((prev) => [
          ...prev,
          ...res.criteria.map(
            (c) => ({ ...c, groupId: g.id, inspectionKind: kind }) as BuilderCriterion,
          ),
        ])
        toast.success(
          tGenerated('m_0773f5db0728c4', { value0: res.criteria.length, value1: res.bankName }),
        )
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
            <BuilderRailHeader
              icon={<HardHat size={15} />}
              title={tGeneratedValue(type.name)}
              subtitle={tGenerated('m_0bdc13fe741bfd')}
            />
            <BuilderRailNavigation active={leftTab} onChange={setLeftTab} />
            <BuilderScroll>
              <GeneratedValue
                value={
                  leftTab === 'build' ? (
                    <ChecklistBuildMenu
                      before={
                        <div className="space-y-1.5">
                          <Label className="text-xs text-slate-500 dark:text-slate-400">
                            <GeneratedText id="m_08e83f80918eaf" />
                          </Label>
                          <KindToggle kind={kind} onChange={setKind} counts={counts} />
                        </div>
                      }
                      description={tGeneratedValue(
                        <>
                          Build the {kindLabel.toLowerCase()} checklist this PPE type runs. Group
                          questions into sections, drag to reorder, or import a saved bank as a
                          section.
                        </>,
                      )}
                      onAddGroup={checklist.addGroup}
                      onAddCriterion={() => checklist.openAdd(null)}
                      onImport={() => setImporting(true)}
                    />
                  ) : leftTab === 'settings' ? (
                    <SettingsPanel
                      type={type}
                      itemCount={itemCount}
                      customFieldCount={customFieldCount}
                      onDeleted={() => router.push('/ppe/types')}
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
              title={tGenerated('m_14278c1c3a0b30', { value0: kindLabel })}
              sectionCount={checklist.scopedGroups.length}
              criterionCount={checklist.scopedCriteria.length}
            />
            <BuilderScroll className="space-y-3 lg:p-6">
              <ChecklistSections
                groups={checklist.scopedGroups}
                criteriaFor={checklist.criteriaFor}
                ungrouped={checklist.ungrouped}
                selectedId={checklist.selectedId}
                emptyTitle={`No ${kindLabel.toLowerCase()} criteria yet`}
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

      <SeverityCriterionEditorDrawer
        editor={checklist.editor}
        groups={checklist.scopedGroups}
        onClose={() => checklist.setEditor(null)}
        onSave={checklist.saveCriterion}
      />
      <ImportCriteriaBankDrawer
        open={importing}
        banks={banks}
        description={tGenerated('m_1675549fab6dc1', { value0: kindLabel.toLowerCase() })}
        emptyMessage="No published banks yet. Create one under PPE → Criteria banks."
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
      <GeneratedValue
        value={(['pre_use', 'annual'] as Kind[]).map((k) => (
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
            <GeneratedValue
              value={
                k === 'pre_use' ? (
                  <GeneratedText id="m_0169e159d93a5b" />
                ) : (
                  <GeneratedText id="m_1a86ff2774c6a1" />
                )
              }
            />
            <span className="ml-1.5 text-slate-400">
              <GeneratedValue value={counts[k]} />
            </span>
          </button>
        ))}
      />
    </div>
  )
}

function CriterionContent({ c }: { c: BuilderCriterion }) {
  return (
    <>
      <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
        <GeneratedValue value={c.question} />
      </span>
      <Badge variant={severityVariant(c.severity)} className="text-[10px]">
        <GeneratedValue value={c.severity} />
      </Badge>
      <GeneratedValue
        value={
          c.requiresPhoto ? (
            <Badge variant="outline" className="text-[10px]">
              <GeneratedText id="m_07cb1cfb72cff4" />
            </Badge>
          ) : null
        }
      />
    </>
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
  customFieldCount,
  onDeleted,
}: {
  type: BuilderType
  itemCount: number
  customFieldCount: number
  onDeleted: () => void
}) {
  const tGenerated = useGeneratedTranslations()
  const run = useBuilderActionRunner('Failed to save')
  const [name, setName] = React.useState(type.name)
  const [category, setCategory] = React.useState(type.category ?? '')
  const [isInspectable, setIsInspectable] = React.useState(type.isInspectable)
  const [everyDays, setEveryDays] = React.useState(type.everyDays ? String(type.everyDays) : '')
  const [requiresCertificate, setRequiresCertificate] = React.useState(type.requiresCertificate)
  const [sizing, setSizing] = React.useState(
    type.sizingScheme && type.sizingScheme.length > 0 ? type.sizingScheme.join(', ') : '',
  )
  const confirmDelete = useConfirmedBuilderDelete({
    confirmMessage: 'Delete this PPE type? This cannot be undone.',
    action: () => deleteType({ id: type.id }),
    onDeleted,
  })

  function save() {
    run(async () => {
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
      toast.success(tGenerated('m_0a0569b726b225'))
    })
  }
  function del() {
    if (itemCount > 0 || customFieldCount > 0) {
      toast.error(
        tGenerated('m_0ec08428d4f01b', {
          value0: [
            itemCount > 0 ? `${itemCount} item(s)` : null,
            customFieldCount > 0 ? `${customFieldCount} scoped custom field(s)` : null,
          ]
            .filter(Boolean)
            .join(' and '),
        }),
      )
      return
    }
    void confirmDelete()
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
          <GeneratedText id="m_108b41637f364f" />
        </Label>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          <GeneratedValue
            value={CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                <GeneratedValue value={c.label} />
              </option>
            ))}
          />
        </Select>
      </div>
      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-medium text-slate-500">
          <GeneratedText id="m_0ef24e5f31b073" />
        </legend>
        <BuilderCheckboxRow
          label={tGenerated('m_1527e8efa769ae')}
          checked={isInspectable}
          onChange={setIsInspectable}
        />
        <GeneratedValue
          value={
            isInspectable ? (
              <div className="space-y-1.5 pt-1">
                <Label className="text-xs">
                  <GeneratedText id="m_0813b38052044d" />
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={everyDays}
                  onChange={(e) => setEveryDays(e.target.value)}
                  placeholder={tGenerated('m_0490a6f4ad3193')}
                />
              </div>
            ) : null
          }
        />
      </fieldset>
      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-medium text-slate-500">
          <GeneratedText id="m_0a14bf1b44e910" />
        </legend>
        <BuilderCheckboxRow
          label={tGenerated('m_1564ef09640973')}
          checked={requiresCertificate}
          onChange={setRequiresCertificate}
        />
        <p className="px-1 text-xs text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_0c5ae6f506063d" />
        </p>
      </fieldset>
      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_0a5f6be4b30d1d" />
        </Label>
        <Textarea
          rows={2}
          value={sizing}
          onChange={(e) => setSizing(e.target.value)}
          placeholder={tGenerated('m_0ef287c3534753')}
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_1047ca0b38037c" />
        </p>
      </div>
      <div className="flex justify-end">
        <Button onClick={save}>
          <Save size={14} /> <GeneratedText id="m_19e6bff894c3c7" />
        </Button>
      </div>

      <BuilderDangerZone
        title={tGenerated('m_08a9fece5a47cb')}
        description={tGenerated('m_0fbfa83bdc076b')}
        buttonLabel={tGenerated('m_12fda1066d2e96')}
        onDelete={del}
        disabled={itemCount > 0 || customFieldCount > 0}
      />
    </div>
  )
}
