'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Flyouts for equipment maintenance scheduling — shared by the asset detail
// page (Inspections tab) and the maintenance cockpit:
//   • ScheduleDrawer  — create/edit a per-unit inspection schedule
//   • ReminderDrawer  — create/edit an ad-hoc maintenance reminder

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import { Button, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'
import { confirmDialog } from '@/lib/confirm'
import { PersonSelectField } from '@/components/person-select-field'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import type { PickerLookup } from '@/lib/picker-options'
import { IntervalPicker, type IntervalValue } from '@/components/equipment/interval-picker'
import type { EquipmentIntervalUnit } from '@/lib/equipment/intervals'
import {
  deleteEquipmentReminder,
  deleteEquipmentSchedule,
  saveEquipmentReminder,
  saveEquipmentSchedule,
} from './_maintenance-actions'

export type ScheduleEditing = {
  id: string
  inspectionTypeId: string | null
  inspectionTypeOption?: { value: string; label: string; hint?: string }
  label: string | null
  intervalValue: number
  intervalUnit: EquipmentIntervalUnit
  nextDueOn: string
  notes: string | null
  isActive: boolean
}

export type ReminderEditing = {
  id: string
  equipmentItemId: string
  title: string
  details: string | null
  dueOn: string
  repeatIntervalValue: number | null
  repeatIntervalUnit: EquipmentIntervalUnit | null
  assignedToPersonId: string | null
  equipmentItemOption?: { value: string; label: string; hint?: string }
  assignedToOption?: { value: string; label: string; hint?: string }
}

type PersonOption = { value: string; label: string; hint?: string }
type ItemOption = { value: string; label: string; hint?: string }

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function ScheduleDrawer({
  open,
  closeHref,
  itemId,
  itemTypeId,
  editing,
}: {
  open: boolean
  closeHref: string
  itemId: string
  itemTypeId: string | null
  editing: ScheduleEditing | null
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGeneratedValue(
        editing ? tGenerated('m_0d5c72f6bf0488') : tGenerated('m_0c787ee3aa086f'),
      )}
      description={tGenerated('m_0ff69ac92bff6c')}
      size="md"
    >
      <ScheduleForm
        key={editing?.id ?? 'new'}
        itemId={itemId}
        itemTypeId={itemTypeId}
        editing={editing}
        onDone={() => {
          router.push(closeHref as never)
          router.refresh()
        }}
      />
    </UrlDrawer>
  )
}

function ScheduleForm({
  itemId,
  itemTypeId,
  editing,
  onDone,
}: {
  itemId: string
  itemTypeId: string | null
  editing: ScheduleEditing | null
  onDone: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [inspectionTypeId, setInspectionTypeId] = useState(editing?.inspectionTypeId ?? '')
  const [label, setLabel] = useState(editing?.label ?? '')
  const [interval, setInterval] = useState<IntervalValue>({
    isPreUse: false,
    intervalValue: editing?.intervalValue ?? 1,
    intervalUnit: editing?.intervalUnit ?? 'year',
  })
  const [nextDueOn, setNextDueOn] = useState(editing?.nextDueOn ?? todayIso())
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [isActive, setIsActive] = useState(editing?.isActive ?? true)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    start(async () => {
      const res = await saveEquipmentSchedule({
        id: editing?.id,
        equipmentItemId: itemId,
        inspectionTypeId: inspectionTypeId || null,
        label: label.trim() || null,
        intervalValue: interval.intervalValue ?? 1,
        intervalUnit: interval.intervalUnit ?? 'year',
        nextDueOn,
        notes: notes.trim() || null,
        isActive,
      })
      if (res.ok) onDone()
      else setError(tGeneratedValue(res.error))
    })
  }

  async function remove() {
    if (!editing) return
    if (
      !(await confirmDialog({
        message: 'Remove this schedule? Inspection history is kept.',
        tone: 'danger',
      }))
    )
      return
    start(async () => {
      const res = await deleteEquipmentSchedule({ id: editing.id, equipmentItemId: itemId })
      if (res.ok) onDone()
      else setError(tGeneratedValue(res.error))
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="sched-type">
          <GeneratedText id="m_0bbd7790743193" />
        </Label>
        <RemoteSearchSelect
          id="sched-type"
          lookup="equipment-item-inspection-types"
          contextId={itemTypeId ?? undefined}
          value={inspectionTypeId}
          onChange={setInspectionTypeId}
          onOptionChange={(picked) => {
            // Inherit the type's default cadence; on-demand/pre-use types
            // (no default) keep whatever interval is already entered.
            if (
              picked?.meta?.kind === 'equipment-inspection-type' &&
              picked.meta.intervalValue &&
              picked.meta.intervalUnit
            ) {
              setInterval({
                isPreUse: false,
                intervalValue: picked.meta.intervalValue,
                intervalUnit: picked.meta.intervalUnit,
              })
            }
          }}
          initialOption={editing?.inspectionTypeOption}
          placeholder={tGenerated('m_1c4715cb725d09')}
          emptyLabel={tGenerated('m_1c4715cb725d09')}
          searchPlaceholder={tGenerated('m_061693dcc701ec')}
          sheetTitle="Select inspection type"
          clearable
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_15a12eae0582eb" />
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sched-label">
          <GeneratedText id="m_02b18d5c7f6f2d" />
        </Label>
        <Input
          id="sched-label"
          value={label}
          onChange={(e) => setLabel(e.currentTarget.value)}
          placeholder={tGeneratedValue(
            inspectionTypeId ? tGenerated('m_0f9a725deaeb23') : tGenerated('m_0cd4cbc5832a9f'),
          )}
        />
      </div>
      <IntervalPicker
        value={interval}
        onChange={setInterval}
        label={tGenerated('m_15d8ba0eb7ca93')}
        allowOnDemand={false}
        idPrefix="sched-interval"
      />
      <div className="space-y-1.5">
        <Label htmlFor="sched-due">
          <GeneratedText id="m_11af411751990f" />
        </Label>
        <Input
          id="sched-due"
          type="date"
          value={nextDueOn}
          onChange={(e) => setNextDueOn(e.currentTarget.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sched-notes">
          <GeneratedText id="m_0b8dadcb78cd08" />
        </Label>
        <Textarea
          id="sched-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
        />
      </div>
      <GeneratedValue
        value={
          editing ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.currentTarget.checked)}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
              />
              <span>
                <GeneratedText id="m_125edec3d10fbb" />
              </span>
            </label>
          ) : null
        }
      />
      <GeneratedValue
        value={
          error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
              <GeneratedValue value={error} />
            </p>
          ) : null
        }
      />
      <div className="flex items-center justify-between gap-2 pt-2">
        <GeneratedValue
          value={
            editing ? (
              <Button type="button" variant="outline" onClick={remove} disabled={pending}>
                <Trash2 size={14} /> <GeneratedText id="m_1a9d8d971b1edb" />
              </Button>
            ) : (
              <span />
            )
          }
        />
        <Button type="submit" disabled={pending}>
          <GeneratedValue
            value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          />
          <GeneratedValue
            value={
              editing ? (
                <GeneratedText id="m_1ab9025ed1067c" />
              ) : (
                <GeneratedText id="m_0009414f09bdd1" />
              )
            }
          />
        </Button>
      </div>
    </form>
  )
}

export function ReminderDrawer({
  open,
  closeHref,
  itemId,
  itemOptions,
  itemLookup,
  editing,
  people,
  peopleLookup,
}: {
  open: boolean
  closeHref: string
  /** Fixed asset (detail page). Omit and pass itemOptions on the cockpit. */
  itemId?: string
  itemOptions?: ItemOption[]
  itemLookup?: PickerLookup
  editing: ReminderEditing | null
  people?: PersonOption[]
  peopleLookup?: PickerLookup
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGeneratedValue(
        editing ? tGenerated('m_1ca1fb16346716') : tGenerated('m_04b0444a0259a5'),
      )}
      description={tGenerated('m_1b08a305a6861c')}
      size="md"
    >
      <ReminderForm
        key={editing?.id ?? 'new'}
        itemId={itemId}
        itemOptions={itemOptions}
        itemLookup={itemLookup}
        editing={editing}
        people={people}
        peopleLookup={peopleLookup}
        onDone={() => {
          router.push(closeHref as never)
          router.refresh()
        }}
      />
    </UrlDrawer>
  )
}

function ReminderForm({
  itemId,
  itemOptions,
  itemLookup,
  editing,
  people,
  peopleLookup,
  onDone,
}: {
  itemId?: string
  itemOptions?: ItemOption[]
  itemLookup?: PickerLookup
  editing: ReminderEditing | null
  people?: PersonOption[]
  peopleLookup?: PickerLookup
  onDone: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [equipmentItemId, setEquipmentItemId] = useState(editing?.equipmentItemId ?? itemId ?? '')
  const [title, setTitle] = useState(editing?.title ?? '')
  const [details, setDetails] = useState(editing?.details ?? '')
  const [dueOn, setDueOn] = useState(editing?.dueOn ?? todayIso())
  const [repeat, setRepeat] = useState<IntervalValue>({
    isPreUse: false,
    intervalValue: editing?.repeatIntervalValue ?? null,
    intervalUnit: editing?.repeatIntervalUnit ?? null,
  })
  const [assignedToPersonId, setAssignedToPersonId] = useState(editing?.assignedToPersonId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    if (!equipmentItemId) {
      setError(tGenerated('m_1e4b62e08ca83b'))
      return
    }
    if (!title.trim()) {
      setError(tGenerated('m_1877089311a4ac'))
      return
    }
    start(async () => {
      const res = await saveEquipmentReminder({
        id: editing?.id,
        equipmentItemId,
        title: title.trim(),
        details: details.trim() || null,
        dueOn,
        repeatIntervalValue: repeat.intervalValue,
        repeatIntervalUnit: repeat.intervalUnit,
        assignedToPersonId: assignedToPersonId || null,
      })
      if (res.ok) onDone()
      else setError(tGeneratedValue(res.error))
    })
  }

  async function remove() {
    if (!editing) return
    if (!(await confirmDialog({ message: 'Delete this reminder?', tone: 'danger' }))) return
    start(async () => {
      const res = await deleteEquipmentReminder({
        id: editing.id,
        equipmentItemId: editing.equipmentItemId,
      })
      if (res.ok) onDone()
      else setError(tGeneratedValue(res.error))
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-4"
    >
      <GeneratedValue
        value={
          !itemId && (itemLookup || itemOptions) ? (
            <div className="space-y-1.5">
              <Label htmlFor="rem-item">
                <GeneratedText id="m_031a074bd3405a" />
              </Label>
              <GeneratedValue
                value={
                  itemLookup ? (
                    <RemoteSearchSelect
                      id="rem-item"
                      lookup={itemLookup}
                      value={equipmentItemId}
                      onChange={setEquipmentItemId}
                      initialOption={editing?.equipmentItemOption}
                      placeholder={tGenerated('m_126c67f479ce14')}
                      searchPlaceholder={tGenerated('m_09de693b3f8ff9')}
                      sheetTitle="Select unit"
                      clearable={false}
                    />
                  ) : (
                    <Select
                      id="rem-item"
                      value={equipmentItemId}
                      onChange={(e) => setEquipmentItemId(e.currentTarget.value)}
                      required
                    >
                      <option value="">
                        <GeneratedText id="m_09f3931b085f5c" />
                      </option>
                      <GeneratedValue
                        value={(itemOptions ?? []).map((o) => (
                          <option key={o.value} value={o.value}>
                            <GeneratedValue value={o.label} />
                          </option>
                        ))}
                      />
                    </Select>
                  )
                }
              />
            </div>
          ) : null
        }
      />
      <div className="space-y-1.5">
        <Label htmlFor="rem-title">
          <GeneratedText id="m_061226f35d3d3e" />
        </Label>
        <Input
          id="rem-title"
          value={title}
          maxLength={500}
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder={tGenerated('m_03ae71b0e437ea')}
          required
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rem-details">
          <GeneratedText id="m_1560d4e2a09d09" />
        </Label>
        <Textarea
          id="rem-details"
          rows={3}
          maxLength={10000}
          value={details}
          onChange={(e) => setDetails(e.currentTarget.value)}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rem-due">
            <GeneratedText id="m_0b033bcdcf6c37" />
          </Label>
          <Input
            id="rem-due"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.currentTarget.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rem-assignee">
            <GeneratedText id="m_0b44d2ea8f2b0f" />
          </Label>
          <GeneratedValue
            value={
              peopleLookup ? (
                <RemoteSearchSelect
                  id="rem-assignee"
                  lookup={peopleLookup}
                  value={assignedToPersonId}
                  onChange={setAssignedToPersonId}
                  initialOption={editing?.assignedToOption}
                  placeholder={tGenerated('m_0be39d3a196b5b')}
                  searchPlaceholder={tGenerated('m_06c2338b990aea')}
                  sheetTitle="Assign reminder"
                  clearable
                  emptyLabel={tGenerated('m_1ba9b3d94af564')}
                />
              ) : (
                <PersonSelectField
                  name="assignedToPersonId"
                  defaultValue={assignedToPersonId}
                  options={people ?? []}
                  placeholder={tGenerated('m_0be39d3a196b5b')}
                  clearable
                  emptyLabel={tGenerated('m_1ba9b3d94af564')}
                  onValueChange={setAssignedToPersonId}
                />
              )
            }
          />
        </div>
      </div>
      <IntervalPicker
        value={repeat}
        onChange={setRepeat}
        label={tGenerated('m_1ced31a1380b66')}
        allowOnDemand
        onDemandLabel="Does not repeat"
        idPrefix="rem-repeat"
      />
      <GeneratedValue
        value={
          error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
              <GeneratedValue value={error} />
            </p>
          ) : null
        }
      />
      <div className="flex items-center justify-between gap-2 pt-2">
        <GeneratedValue
          value={
            editing ? (
              <Button type="button" variant="outline" onClick={remove} disabled={pending}>
                <Trash2 size={14} /> <GeneratedText id="m_11773f3c3f7558" />
              </Button>
            ) : (
              <span />
            )
          }
        />
        <Button type="submit" disabled={pending}>
          <GeneratedValue
            value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          />
          <GeneratedValue
            value={
              editing ? (
                <GeneratedText id="m_1ab9025ed1067c" />
              ) : (
                <GeneratedText id="m_04b0444a0259a5" />
              )
            }
          />
        </Button>
      </div>
    </form>
  )
}
