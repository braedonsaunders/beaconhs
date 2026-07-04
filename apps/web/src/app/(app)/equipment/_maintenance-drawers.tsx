'use client'

// Flyouts for equipment maintenance scheduling — shared by the asset detail
// page (Inspections tab) and the maintenance cockpit:
//   • ScheduleDrawer  — create/edit a per-unit inspection schedule
//   • ReminderDrawer  — create/edit an ad-hoc maintenance reminder

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import { Button, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'
import { PersonSelectField } from '@/components/person-select-field'
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
}

export type PersonOption = { value: string; label: string; hint?: string }
export type TypeOption = {
  value: string
  label: string
  hint?: string
  /** The type's default cadence — inherited when the type is picked. */
  intervalValue?: number | null
  intervalUnit?: EquipmentIntervalUnit | null
}
export type ItemOption = { value: string; label: string; hint?: string }

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function ScheduleDrawer({
  open,
  closeHref,
  itemId,
  editing,
  typeOptions,
}: {
  open: boolean
  closeHref: string
  itemId: string
  editing: ScheduleEditing | null
  typeOptions: TypeOption[]
}) {
  const router = useRouter()
  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={editing ? 'Edit inspection schedule' : 'Add inspection schedule'}
      description="A recurring inspection cadence for this unit — any interval, from daily to every 5 years. Submitting a matching inspection advances the next-due date."
      size="md"
    >
      <ScheduleForm
        key={editing?.id ?? 'new'}
        itemId={itemId}
        editing={editing}
        typeOptions={typeOptions}
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
  editing,
  typeOptions,
  onDone,
}: {
  itemId: string
  editing: ScheduleEditing | null
  typeOptions: TypeOption[]
  onDone: () => void
}) {
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
    setError(null)
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
      else setError(res.error)
    })
  }

  function remove() {
    if (!editing) return
    if (!window.confirm('Remove this schedule? Inspection history is kept.')) return
    start(async () => {
      const res = await deleteEquipmentSchedule({ id: editing.id, equipmentItemId: itemId })
      if (res.ok) onDone()
      else setError(res.error)
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
        <Label htmlFor="sched-type">Inspection type</Label>
        <Select
          id="sched-type"
          value={inspectionTypeId}
          onChange={(e) => {
            const next = e.currentTarget.value
            setInspectionTypeId(next)
            // Inherit the type's default cadence; on-demand/pre-use types
            // (no default) keep whatever interval is already entered.
            const picked = typeOptions.find((t) => t.value === next)
            if (picked?.intervalValue && picked.intervalUnit) {
              setInterval({
                isPreUse: false,
                intervalValue: picked.intervalValue,
                intervalUnit: picked.intervalUnit,
              })
            }
          }}
        >
          <option value="">— Due-date tracking only —</option>
          {typeOptions.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Pick a checklist to perform, or leave empty to track a due date without one.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sched-label">Name</Label>
        <Input
          id="sched-label"
          value={label}
          onChange={(e) => setLabel(e.currentTarget.value)}
          placeholder={
            inspectionTypeId ? 'Optional — defaults to the type name' : 'e.g. Annual certification'
          }
        />
      </div>
      <IntervalPicker
        value={interval}
        onChange={setInterval}
        label="Repeat interval"
        allowOnDemand={false}
        idPrefix="sched-interval"
      />
      <div className="space-y-1.5">
        <Label htmlFor="sched-due">Next due</Label>
        <Input
          id="sched-due"
          type="date"
          value={nextDueOn}
          onChange={(e) => setNextDueOn(e.currentTarget.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sched-notes">Notes</Label>
        <Textarea
          id="sched-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
        />
      </div>
      {editing ? (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.currentTarget.checked)}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
          />
          <span>Active (tracked on the maintenance cockpit)</span>
        </label>
      ) : null}
      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2 pt-2">
        {editing ? (
          <Button type="button" variant="outline" onClick={remove} disabled={pending}>
            <Trash2 size={14} /> Remove
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          {editing ? 'Save changes' : 'Add schedule'}
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
  editing,
  people,
}: {
  open: boolean
  closeHref: string
  /** Fixed asset (detail page). Omit and pass itemOptions on the cockpit. */
  itemId?: string
  itemOptions?: ItemOption[]
  editing: ReminderEditing | null
  people: PersonOption[]
}) {
  const router = useRouter()
  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={editing ? 'Edit reminder' : 'Add reminder'}
      description="An ad-hoc maintenance to-do pinned to a unit — e.g. check the roof membrane in March. Repeating reminders re-spawn when completed."
      size="md"
    >
      <ReminderForm
        key={editing?.id ?? 'new'}
        itemId={itemId}
        itemOptions={itemOptions}
        editing={editing}
        people={people}
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
  editing,
  people,
  onDone,
}: {
  itemId?: string
  itemOptions?: ItemOption[]
  editing: ReminderEditing | null
  people: PersonOption[]
  onDone: () => void
}) {
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
    setError(null)
    if (!equipmentItemId) {
      setError('Pick a unit.')
      return
    }
    if (!title.trim()) {
      setError('Title is required.')
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
      else setError(res.error)
    })
  }

  function remove() {
    if (!editing) return
    if (!window.confirm('Delete this reminder?')) return
    start(async () => {
      const res = await deleteEquipmentReminder({
        id: editing.id,
        equipmentItemId: editing.equipmentItemId,
      })
      if (res.ok) onDone()
      else setError(res.error)
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
      {!itemId && itemOptions ? (
        <div className="space-y-1.5">
          <Label htmlFor="rem-item">Unit *</Label>
          <Select
            id="rem-item"
            value={equipmentItemId}
            onChange={(e) => setEquipmentItemId(e.currentTarget.value)}
            required
          >
            <option value="">— Select a unit —</option>
            {itemOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="rem-title">Title *</Label>
        <Input
          id="rem-title"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder="e.g. Check roof membrane"
          required
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rem-details">Details</Label>
        <Textarea
          id="rem-details"
          rows={3}
          value={details}
          onChange={(e) => setDetails(e.currentTarget.value)}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rem-due">Due on *</Label>
          <Input
            id="rem-due"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.currentTarget.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Assign to</Label>
          <PersonSelectField
            name="assignedToPersonId"
            defaultValue={assignedToPersonId}
            options={people}
            placeholder="Select a person…"
            clearable
            emptyLabel="— Unassigned —"
            onValueChange={setAssignedToPersonId}
          />
        </div>
      </div>
      <IntervalPicker
        value={repeat}
        onChange={setRepeat}
        label="Repeat"
        allowOnDemand
        onDemandLabel="Does not repeat"
        idPrefix="rem-repeat"
      />
      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2 pt-2">
        {editing ? (
          <Button type="button" variant="outline" onClick={remove} disabled={pending}>
            <Trash2 size={14} /> Delete
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          {editing ? 'Save changes' : 'Add reminder'}
        </Button>
      </div>
    </form>
  )
}
