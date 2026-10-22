'use client'
import { isDailyOrPreUseInspection } from '@/lib/equipment/intervals'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Settings2,
  Tag,
  Wrench,
} from 'lucide-react'
import { Button, Input, Label, Select, Textarea, UrlDrawer, cn } from '@beaconhs/ui'
import { coerceCustomFieldValue, type CustomFieldDefinition } from '@beaconhs/forms-core'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { DraftRecoveryBanner, DraftSyncIndicator } from '@/components/draft-sync-status'
import { useDeviceForm } from '@/lib/offline-drafts/use-device-form'
import { useOnlineAction } from '@/lib/offline-drafts/use-online-action'
import { ServicePlanFields } from '@/components/equipment/service-plan-fields'
import {
  equipmentSetupStepError,
  equipmentSetupSectionsError,
  emptyEquipmentSetup,
  type EquipmentSetupInput,
} from '@/lib/equipment/setup'
import { resolveEnabledFieldGroups } from '@/lib/equipment/field-groups'
import { validateServiceRules } from '@beaconhs/db/equipment-service'
import { createEquipmentFromSetup } from './_setup-actions'

type Category = {
  id: string
  name: string
  description: string | null
  enabledFieldGroups: string[] | null
}
type Checklist = {
  id: string
  name: string
  appliesToTypeId: string | null
  isPreUse: boolean
  intervalValue: number | null
  intervalUnit: 'day' | 'week' | 'month' | 'year' | null
}
type CustomDef = CustomFieldDefinition & { subtypeId: string | null; helpText: string | null }
const STEPS = ['Category', 'Details', 'Inspections', 'Maintenance', 'Review']
const ICONS = [Tag, Settings2, ClipboardCheck, Wrench, CheckCircle2]
export function EquipmentSetupDrawer({
  open,
  closeHref,
  categories,
  checklists,
  customFields,
  today,
}: {
  open: boolean
  closeHref: string
  categories: Category[]
  checklists: Checklist[]
  customFields: CustomDef[]
  today: string
}) {
  const t = useGeneratedValueTranslations()
  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={t('Add equipment')}
      description={t('A few guided steps to create a complete, useful equipment record.')}
      size="xl"
    >
      <EquipmentSetupForm
        categories={categories}
        checklists={checklists}
        customFields={customFields}
        today={today}
      />
    </UrlDrawer>
  )
}
function EquipmentSetupForm({
  categories,
  checklists,
  customFields,
  today,
}: {
  categories: Category[]
  checklists: Checklist[]
  customFields: CustomDef[]
  today: string
}) {
  const [value, setValue] = useState(() => emptyEquipmentSetup(crypto.randomUUID()))
  const [step, setStep] = useState(0)
  const [detailSection, setDetailSection] = useState(0)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const [newType, setNewType] = useState(false)
  const t = useGeneratedValueTranslations()
  const router = useRouter()
  const online = useOnlineAction()
  const device = useDeviceForm<EquipmentSetupInput & { step: number; detailSection: number }>({
    enabled: true,
    form: 'equipment-setup',
    localId: 'new',
    onRestore: (saved) => {
      setValue(saved)
      setStep(Math.max(0, Math.min(4, saved.step ?? 0)))
      setDetailSection(Math.max(0, saved.detailSection ?? 0))
      setNewType(!saved.typeId && !!saved.newTypeName)
    },
  })
  function change(next: EquipmentSetupInput) {
    setValue({ ...next, reviewed: false })
    device.save({ ...next, reviewed: false, step, detailSection })
    setError('')
  }
  const category = categories.find((c) => c.id === value.categoryId)
  const fields = customFields.filter((d) => !d.subtypeId || d.subtypeId === value.typeId)
  const detailGroups = resolveEnabledFieldGroups(category?.enabledFieldGroups)
  const detailCount = 1 + detailGroups.length + (fields.length ? 1 : 0)
  const detailStep = Math.min(detailSection, detailCount - 1)
  const matching = categories.filter((c) =>
    `${c.name} ${c.description ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  )
  const pages = Math.max(1, Math.ceil(matching.length / 9))
  const currentPage = Math.min(page, pages)
  const standardUsage = [
    ...new Set(
      value.maintenance
        .filter((p) => p.isActive)
        .flatMap((p) =>
          p.rules.flatMap((r) =>
            r.kind === 'meter' && ['engine_hours', 'odometer'].includes(r.meter) ? [r.meter] : [],
          ),
        ),
    ),
  ]
  const availableChecklists = checklists.filter(
    (c) => !c.appliesToTypeId || c.appliesToTypeId === value.typeId,
  )
  function move(next: number) {
    setStep(next)
    if (next === 1 && step === 0) setDetailSection(0)
    device.save({
      ...value,
      step: next,
      detailSection: next === 1 && step === 0 ? 0 : detailSection,
    })
    setError('')
    document.querySelector('[data-equipment-setup-heading]')?.scrollIntoView({ block: 'start' })
  }
  function validateCurrent() {
    const error =
      step === 1
        ? detailStep === 0
          ? equipmentSetupStepError(value, 1)
          : null
        : equipmentSetupStepError(value, step)
    if (error) return error
    if (step === 1 && detailStep > 0 && detailStep <= detailGroups.length) {
      const group = detailGroups[detailStep - 1]!
      const error = equipmentSetupSectionsError(value, [group.key])
      if (error) return error
    }
    if (step === 1 && detailStep === detailGroups.length + 1)
      for (const def of fields) {
        const result = coerceCustomFieldValue(def, value.custom[def.key] ?? '')
        if (!result.ok) return result.error
      }
    if (step === 3 && value.maintenanceRequired)
      for (const plan of value.maintenance) {
        if (!plan.name.trim()) return 'Name each maintenance task.'
        try {
          validateServiceRules(plan.rules)
        } catch (error) {
          return error instanceof Error ? error.message : 'Check the maintenance conditions.'
        }
      }
    return null
  }
  const setField = (field: string, v: string) =>
    change({ ...value, fields: { ...value.fields, [field]: v } })
  return (
    <form
      data-walkthrough="equipment-setup"
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        setError('')
        const error = validateCurrent()
        if (error) {
          setError(error)
          return
        }
        if (step === 1 && detailStep < detailCount - 1) {
          setDetailSection(detailStep + 1)
          device.save({ ...value, step, detailSection: detailStep + 1 })
          document
            .querySelector('[data-equipment-setup-heading]')
            ?.scrollIntoView({ block: 'start' })
          return
        }
        if (step < 4) {
          move(step + 1)
          return
        }
        start(async () => {
          await online('start', async () => {
            try {
              const result = await createEquipmentFromSetup(value)
              if (!result.ok) {
                setError(result.error)
                return
              }
              device.clear()
              router.replace(`/equipment/${result.id}` as never)
              router.refresh()
            } catch {
              setError('Could not create equipment. Your setup is kept on this device. Try again.')
            }
          })
        })
      }}
    >
      <DraftRecoveryBanner
        localOnly
        restored={device.restored}
        conflict={false}
        onDismiss={device.dismissRestored}
        onDiscard={() => {
          device.clear()
          setValue(emptyEquipmentSetup(crypto.randomUUID()))
          setStep(0)
          setDetailSection(0)
        }}
        onTakeDeviceCopy={() => undefined}
        onTakeSavedVersion={() => undefined}
      />
      <ol className="grid grid-cols-5 gap-1" aria-label={t('Equipment setup progress')}>
        {STEPS.map((label, index) => {
          const Icon = ICONS[index]!
          return (
            <li
              key={label}
              className={cn(
                'flex flex-col items-center gap-1 border-b-2 pb-3 text-center text-xs',
                index === step
                  ? 'border-teal-600 font-semibold text-teal-700 dark:text-teal-300'
                  : index < step
                    ? 'border-teal-300 text-teal-600'
                    : 'border-slate-200 text-slate-400 dark:border-slate-700',
              )}
              aria-current={index === step ? 'step' : undefined}
            >
              {index < step ? <Check size={18} /> : <Icon size={18} />}
              <GeneratedValue value={label} />
            </li>
          )
        })}
      </ol>
      <div data-equipment-setup-heading>
        <p className="text-xs text-slate-500">
          <GeneratedValue value="Step" /> {step + 1} / 5
        </p>
        <h2 className="mt-1 text-xl font-semibold">
          <GeneratedValue
            value={
              [
                'What kind of equipment is this?',
                'Make this equipment easy to identify',
                'Set up the inspections it needs',
                'Set up periodic maintenance',
                'Check everything before creating',
              ][step]
            }
          />
        </h2>
      </div>
      <fieldset disabled={pending || !!device.state?.blocked} className="space-y-5">
        {step === 0 ? (
          <>
            <p className="text-sm text-slate-500">
              <GeneratedValue value="Choose the closest category. The next steps will show the relevant details for that category." />
            </p>
            <Input
              aria-label={t('Search categories')}
              placeholder={t('Search categories')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {matching.slice((currentPage - 1) * 9, currentPage * 9).map((c) => (
                <button
                  type="button"
                  key={c.id}
                  aria-pressed={value.categoryId === c.id}
                  onClick={() => {
                    setDetailSection(0)
                    change({ ...value, categoryId: c.id })
                  }}
                  className={cn(
                    'relative flex min-h-32 flex-col items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:outline-none',
                    value.categoryId === c.id
                      ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40'
                      : 'border-slate-200 bg-white hover:border-teal-400 dark:border-slate-700 dark:bg-slate-900',
                  )}
                >
                  <Wrench size={24} className="text-teal-700 dark:text-teal-300" />
                  <strong className="text-sm">{t(c.name)}</strong>
                  {c.description ? (
                    <span className="text-xs text-slate-500">{t(c.description)}</span>
                  ) : null}
                  {value.categoryId === c.id ? (
                    <CheckCircle2 size={18} className="absolute top-3 right-3 text-teal-600" />
                  ) : null}
                </button>
              ))}
            </div>
            {!matching.length ? (
              <p className="text-sm text-slate-500">
                <GeneratedValue value="No categories found. A manager can add categories under Equipment → Manage." />{' '}
                <Link href="/equipment/manage" className="text-teal-700 underline">
                  <GeneratedValue value="Manage equipment" />
                </Link>
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <GeneratedValue value="Previous" />
              </Button>
              <span className="text-sm">
                {currentPage} / {pages}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={currentPage === pages}
                onClick={() => setPage(currentPage + 1)}
              >
                <GeneratedValue value="Next" />
              </Button>
            </div>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <p className="text-sm text-slate-500">
              <GeneratedValue value="Details" /> {detailStep + 1} / {detailCount}
            </p>
            {detailStep === 0 ? (
              <>
                {' '}
                <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
                  <GeneratedValue value="Category" />: <strong>{t(category?.name ?? '')}</strong>
                </div>
                <div>
                  <Label>
                    <GeneratedValue value="Equipment type" /> *
                  </Label>
                  {newType ? (
                    <Input
                      required
                      maxLength={240}
                      value={value.newTypeName}
                      onChange={(e) =>
                        change({ ...value, newTypeName: e.target.value, typeId: '' })
                      }
                      placeholder={t('Name the equipment type')}
                    />
                  ) : (
                    <RemoteSearchSelect
                      lookup="equipment-edit-types"
                      value={value.typeId}
                      onChange={(v) => change({ ...value, typeId: v, newTypeName: '' })}
                      placeholder={t('Choose equipment type')}
                    />
                  )}
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    onClick={() => {
                      setNewType(!newType)
                      change({ ...value, typeId: '', newTypeName: '' })
                    }}
                  >
                    <GeneratedValue
                      value={newType ? 'Choose an existing type' : 'Add a type that is not listed'}
                    />
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="setup-name">
                      <GeneratedValue value="Equipment name" /> *
                    </Label>
                    <Input
                      id="setup-name"
                      required
                      maxLength={240}
                      value={value.name}
                      onChange={(e) => change({ ...value, name: e.target.value })}
                      placeholder={t('A name your team will recognise')}
                    />
                  </div>
                  <div>
                    <Label htmlFor="setup-tag">
                      <GeneratedValue value="Asset tag" /> *
                    </Label>
                    <Input
                      id="setup-tag"
                      required
                      maxLength={120}
                      value={value.assetTag}
                      onChange={(e) => change({ ...value, assetTag: e.target.value })}
                      placeholder={t('Your unique equipment number')}
                    />
                  </div>
                  <div>
                    <Label>
                      <GeneratedValue value="Serial number" />
                    </Label>
                    <Input
                      value={value.fields.serialNumber ?? ''}
                      onChange={(e) => setField('serialNumber', e.target.value)}
                      maxLength={240}
                    />
                  </div>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={value.identifyingDetailsUnavailable}
                    onChange={(e) =>
                      change({ ...value, identifyingDetailsUnavailable: e.target.checked })
                    }
                  />
                  <GeneratedValue value="A serial number, VIN, or plate is not available for this equipment." />
                </label>
                {value.identifyingDetailsUnavailable ? (
                  <div>
                    <Label>
                      <GeneratedValue value="Explain what is unavailable" />
                    </Label>
                    <Textarea
                      required
                      minLength={5}
                      value={value.identifyingDetailsReason}
                      onChange={(e) =>
                        change({ ...value, identifyingDetailsReason: e.target.value })
                      }
                    />
                  </div>
                ) : null}
              </>
            ) : null}
            {detailGroups
              .filter((_, i) => i === detailStep - 1)
              .map((group) => (
                <section
                  key={group.key}
                  className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700"
                >
                  <h3 className="font-medium">
                    <GeneratedValue value={group.label} />
                  </h3>
                  <p className="text-xs text-slate-500">
                    <GeneratedValue value={group.description} />
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {group.fields.map((field) => (
                      <div key={field.field}>
                        <Label>
                          <GeneratedValue value={field.label} />
                        </Label>
                        {field.type === 'select' ? (
                          <Select
                            value={value.fields[field.field] ?? field.options?.[0]?.value ?? ''}
                            onChange={(e) => setField(field.field, e.target.value)}
                          >
                            {field.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {t(o.label)}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Input
                            type={field.type}
                            step={
                              field.type === 'number'
                                ? field.numeric === 'int'
                                  ? 1
                                  : 'any'
                                : undefined
                            }
                            value={value.fields[field.field] ?? ''}
                            onChange={(e) => setField(field.field, e.target.value)}
                            placeholder={field.placeholder ? t(field.placeholder) : undefined}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={value.sections?.[group.key]?.unavailable ?? false}
                      onChange={(e) =>
                        change({
                          ...value,
                          sections: {
                            ...value.sections,
                            [group.key]: {
                              unavailable: e.target.checked,
                              reason: value.sections?.[group.key]?.reason ?? '',
                            },
                          },
                        })
                      }
                    />
                    <GeneratedValue value="Details unavailable / not applicable" />
                  </label>
                  {value.sections?.[group.key]?.unavailable ? (
                    <div>
                      <Label>
                        <GeneratedValue value="Tell us why" />
                      </Label>
                      <Textarea
                        minLength={5}
                        maxLength={1000}
                        required
                        value={value.sections[group.key]?.reason ?? ''}
                        onChange={(e) =>
                          change({
                            ...value,
                            sections: {
                              ...value.sections,
                              [group.key]: { unavailable: true, reason: e.target.value },
                            },
                          })
                        }
                      />
                    </div>
                  ) : null}
                </section>
              ))}
            {fields.length && detailStep === detailGroups.length + 1 ? (
              <section className="space-y-4 rounded-lg border p-4">
                <h3 className="font-medium">
                  <GeneratedValue value="Your company's additional details" />
                </h3>
                {fields.map((def) => (
                  <SetupCustomField
                    key={def.key}
                    def={def}
                    value={value.custom[def.key] ?? ''}
                    onChange={(v) =>
                      change({ ...value, custom: { ...value.custom, [def.key]: v } })
                    }
                  />
                ))}
              </section>
            ) : null}
          </>
        ) : null}
        {step === 2 ? (
          <>
            <Choice
              question="Does it need an inspection before use?"
              value={value.preUseRequired}
              onChange={(v) => change({ ...value, preUseRequired: v, preUseTypeId: '' })}
            />
            {value.preUseRequired ? (
              <div>
                <Label>
                  <GeneratedValue value="Pre-use checklist" /> *
                </Label>
                <Select
                  required
                  value={value.preUseTypeId}
                  onChange={(e) => change({ ...value, preUseTypeId: e.target.value })}
                >
                  <option value="">{t('Choose a checklist')}</option>
                  {availableChecklists.filter(isDailyOrPreUseInspection).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <Choice
              question="Does it need inspections on a schedule?"
              value={value.scheduledInspectionsRequired}
              onChange={(v) =>
                change({
                  ...value,
                  scheduledInspectionsRequired: v,
                  inspectionSchedules: v ? value.inspectionSchedules : [],
                })
              }
            />
            {value.scheduledInspectionsRequired ? (
              <>
                <p className="text-sm text-slate-500">
                  <GeneratedValue value="Choose each checklist, how often it is required, and the first due date." />
                </p>
                {value.inspectionSchedules.map((s, index) => (
                  <div key={index} className="space-y-3 rounded-lg border p-4">
                    <Select
                      required
                      aria-label={t('Inspection checklist')}
                      value={s.typeId}
                      onChange={(e) => {
                        const c = checklists.find((c) => c.id === e.target.value)
                        change({
                          ...value,
                          inspectionSchedules: value.inspectionSchedules.map((r, i) =>
                            i === index
                              ? {
                                  ...r,
                                  typeId: e.target.value,
                                  every: c?.intervalValue ?? 1,
                                  unit: c?.intervalUnit ?? 'year',
                                }
                              : r,
                          ),
                        })
                      }}
                    >
                      <option value="">{t('Choose a checklist')}</option>
                      {availableChecklists
                        .filter((c) => !c.isPreUse)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </Select>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label>
                          <GeneratedValue value="Every" />
                        </Label>
                        <Input
                          type="number"
                          required
                          min={1}
                          max={1200}
                          value={s.every || ''}
                          onChange={(e) =>
                            change({
                              ...value,
                              inspectionSchedules: value.inspectionSchedules.map((r, i) =>
                                i === index ? { ...r, every: Number(e.target.value) } : r,
                              ),
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label>
                          <GeneratedValue value="Unit" />
                        </Label>
                        <Select
                          value={s.unit}
                          onChange={(e) =>
                            change({
                              ...value,
                              inspectionSchedules: value.inspectionSchedules.map((r, i) =>
                                i === index ? { ...r, unit: e.target.value as typeof r.unit } : r,
                              ),
                            })
                          }
                        >
                          {['day', 'week', 'month', 'year'].map((u) => (
                            <option key={u} value={u}>
                              {t(u)}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <Label>
                          <GeneratedValue value="First due" />
                        </Label>
                        <Input
                          required
                          type="date"
                          min="1902-01-01"
                          value={s.dueOn}
                          onChange={(e) =>
                            change({
                              ...value,
                              inspectionSchedules: value.inspectionSchedules.map((r, i) =>
                                i === index ? { ...r, dueOn: e.target.value } : r,
                              ),
                            })
                          }
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        change({
                          ...value,
                          inspectionSchedules: value.inspectionSchedules.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    >
                      <GeneratedValue value="Remove inspection" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={value.inspectionSchedules.length >= 20}
                  onClick={() =>
                    change({
                      ...value,
                      inspectionSchedules: [
                        ...value.inspectionSchedules,
                        { typeId: '', every: 1, unit: 'year', dueOn: today },
                      ],
                    })
                  }
                >
                  <GeneratedValue value="Add scheduled inspection" />
                </Button>
              </>
            ) : null}
            {value.preUseRequired === false && value.scheduledInspectionsRequired === false ? (
              <div>
                <Label>
                  <GeneratedValue value="Why are inspections not required?" />
                </Label>
                <Textarea
                  required
                  minLength={5}
                  maxLength={1000}
                  value={value.noInspectionsReason}
                  onChange={(e) => change({ ...value, noInspectionsReason: e.target.value })}
                />
              </div>
            ) : null}
            {!availableChecklists.length ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <GeneratedValue value="No matching inspection checklists are configured. A manager must add an applicable checklist under Equipment → Manage → Inspection types before this equipment can be created with inspections." />
              </p>
            ) : null}
          </>
        ) : null}
        {step === 3 ? (
          <>
            <Choice
              question="Does it need periodic maintenance?"
              value={value.maintenanceRequired}
              onChange={(v) =>
                change({
                  ...value,
                  maintenanceRequired: v,
                  maintenance: v ? value.maintenance : [],
                })
              }
            />
            {value.maintenanceRequired ? (
              <>
                <p className="text-sm text-slate-500">
                  <GeneratedValue value="Add the recurring servicing this equipment needs, such as lubrication, filter changes, calibration, or replacement of wear parts." />
                </p>
                {value.maintenance.map((plan, index) => (
                  <section
                    key={index}
                    className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
                  >
                    <ServicePlanFields
                      value={plan}
                      onChange={(p) =>
                        change({
                          ...value,
                          maintenance: value.maintenance.map((r, i) => (i === index ? p : r)),
                        })
                      }
                      meters={value.maintenance.flatMap((p, i) =>
                        i === index ? [] : (p.meters ?? []),
                      )}
                      today={today}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        change({
                          ...value,
                          maintenance: value.maintenance.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <GeneratedValue value="Remove maintenance task" />
                    </Button>
                  </section>
                ))}
                {standardUsage.map((meter) => (
                  <div key={meter} className="space-y-2 rounded-lg border p-4">
                    <Label htmlFor={`setup-reading-${meter}`}>
                      <GeneratedValue
                        value={
                          meter === 'engine_hours'
                            ? 'Current engine hours'
                            : 'Current odometer (km)'
                        }
                      />
                    </Label>
                    <Input
                      id={`setup-reading-${meter}`}
                      required
                      type="number"
                      min={0}
                      step={meter === 'engine_hours' ? 0.1 : 1}
                      value={
                        value.fields[
                          meter === 'engine_hours' ? 'currentHours' : 'currentOdometer'
                        ] ?? ''
                      }
                      onChange={(e) =>
                        setField(
                          meter === 'engine_hours' ? 'currentHours' : 'currentOdometer',
                          e.target.value,
                        )
                      }
                    />
                    <p className="text-xs text-slate-500">
                      <GeneratedValue value="This reading is needed to tell whether usage-based maintenance is due. Update it later under Usage counters." />
                    </p>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={value.maintenance.length >= 30}
                  onClick={() =>
                    change({
                      ...value,
                      maintenance: [
                        ...value.maintenance,
                        {
                          name: '',
                          rules: [{ kind: 'calendar', every: 3, unit: 'month', dueOn: null }],
                          match: 'any',
                          isActive: true,
                        },
                      ],
                    })
                  }
                >
                  <GeneratedValue value="Add maintenance task" />
                </Button>
              </>
            ) : null}
            {value.maintenanceRequired === false ? (
              <div>
                <Label>
                  <GeneratedValue value="Why is periodic maintenance not required?" />
                </Label>
                <Textarea
                  required
                  minLength={5}
                  maxLength={1000}
                  value={value.noMaintenanceReason}
                  onChange={(e) => change({ ...value, noMaintenanceReason: e.target.value })}
                />
              </div>
            ) : null}
          </>
        ) : null}
        {step === 4 ? (
          <>
            <div className="space-y-3 rounded-xl border border-teal-200 bg-teal-50 p-5 text-sm dark:border-teal-900 dark:bg-teal-950/30">
              <p className="text-lg font-semibold">{value.name}</p>
              <p>
                {value.assetTag} · {t(category?.name ?? '')}
              </p>
              <p>
                <GeneratedValue value="Pre-use inspections" />:{' '}
                <GeneratedValue value={value.preUseRequired ? 'Required' : 'Not required'} />
              </p>
              <p>
                <GeneratedValue value="Scheduled inspections" />:{' '}
                {value.scheduledInspectionsRequired ? value.inspectionSchedules.length : 0}
              </p>
              <p>
                <GeneratedValue value="Periodic maintenance tasks" />:{' '}
                {value.maintenanceRequired ? value.maintenance.length : 0}
              </p>
              {!value.preUseRequired && !value.scheduledInspectionsRequired ? (
                <p>{value.noInspectionsReason}</p>
              ) : null}
              {!value.maintenanceRequired ? <p>{value.noMaintenanceReason}</p> : null}
            </div>
            <p className="text-sm text-slate-500">
              <GeneratedValue value="The equipment, inspection schedules, and maintenance tasks will be saved together. Nothing has been added to the register yet." />
            </p>
            <label className="flex items-start gap-3 rounded-lg border p-4 text-sm">
              <input
                required
                type="checkbox"
                checked={value.reviewed}
                onChange={(e) => {
                  setValue({ ...value, reviewed: e.target.checked })
                  device.save({ ...value, reviewed: e.target.checked, step, detailSection })
                }}
              />
              <GeneratedValue value="I have checked the equipment details, inspection requirements, and maintenance setup." />
            </label>
          </>
        ) : null}
      </fieldset>
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
        >
          {t(error)}
        </p>
      ) : null}
      {device.state?.blocked ? (
        <p role="alert" className="text-sm text-amber-700">
          <GeneratedValue value="This setup is open in another tab. Continue there or close that tab before retrying." />
        </p>
      ) : null}
      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t bg-white pt-4 dark:bg-slate-900">
        <Button
          type="button"
          variant="outline"
          disabled={step === 0 || pending}
          onClick={() => {
            if (step === 1 && detailStep > 0) {
              setDetailSection(detailStep - 1)
              device.save({ ...value, step, detailSection: detailStep - 1 })
              setError('')
            } else move(step - 1)
          }}
        >
          <ArrowLeft size={16} />
          <GeneratedValue value="Back" />
        </Button>
        <DraftSyncIndicator
          localOnly
          state={device.state}
          onRetry={() => device.save({ ...value, step, detailSection })}
        />
        <Button type="submit" disabled={pending || !!device.state?.blocked}>
          <GeneratedValue
            value={pending ? 'Creating…' : step === 4 ? 'Create equipment' : 'Continue'}
          />
          {step === 4 ? <Check size={16} /> : <ArrowRight size={16} />}
        </Button>
      </div>
    </form>
  )
}
function Choice({
  question,
  value,
  onChange,
}: {
  question: string
  value: boolean | null
  onChange: (v: boolean) => void
}) {
  const t = useGeneratedValueTranslations()
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium">{t(question)}</legend>
      <div className="grid grid-cols-2 gap-3">
        {[true, false].map((v) => (
          <button
            type="button"
            key={String(v)}
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={cn(
              'rounded-lg border-2 px-4 py-4 text-left text-sm font-medium',
              value === v
                ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40'
                : 'border-slate-200 dark:border-slate-700',
            )}
          >
            <GeneratedValue value={v ? 'Yes, set it up' : 'No, not required'} />
          </button>
        ))}
      </div>
    </fieldset>
  )
}
function SetupCustomField({
  def,
  value,
  onChange,
}: {
  def: CustomDef
  value: string
  onChange: (v: string) => void
}) {
  const id = `setup-custom-${def.key}`
  const t = useGeneratedValueTranslations()
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>
        {t(def.label)}
        {def.required ? ' *' : ''}
      </Label>
      {def.fieldType === 'boolean' ? (
        <Select id={id} value={value || 'false'} onChange={(e) => onChange(e.target.value)}>
          <option value="false">{t('No')}</option>
          <option value="true">{t('Yes')}</option>
        </Select>
      ) : def.fieldType === 'textarea' ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={def.required}
        />
      ) : def.fieldType === 'select' ? (
        <Select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={def.required}
        >
          <option value="">{t('Choose…')}</option>
          {def.config?.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
        </Select>
      ) : def.fieldType === 'multi_select' ? (
        <div id={id} className="space-y-2">
          {def.config?.options?.map((o) => {
            let selected: string[] = []
            try {
              selected = JSON.parse(value || '[]') as string[]
            } catch {}
            return (
              <label key={o.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={(e) =>
                    onChange(
                      JSON.stringify(
                        e.target.checked
                          ? [...selected, o.value]
                          : selected.filter((v) => v !== o.value),
                      ),
                    )
                  }
                />
                {t(o.label)}
              </label>
            )
          })}
        </div>
      ) : (
        <Input
          id={id}
          type={
            def.fieldType === 'datetime'
              ? 'datetime-local'
              : ['number', 'date', 'url', 'email'].includes(def.fieldType)
                ? def.fieldType
                : def.fieldType === 'phone'
                  ? 'tel'
                  : 'text'
          }
          step={def.config?.step ?? 'any'}
          min={def.config?.min ?? undefined}
          max={def.config?.max ?? undefined}
          required={def.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}{' '}
      {def.helpText ? <p className="text-xs text-slate-500">{t(def.helpText)}</p> : null}
    </div>
  )
}
