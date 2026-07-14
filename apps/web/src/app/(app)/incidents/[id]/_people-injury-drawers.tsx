'use client'

// People-involved + injury drawers for the incident detail page. Same contract
// as the investigation drawers: open via `?drawer=…&editId=…`, server actions
// passed in from the RSC page, `{ ok, error }` return.
//
//   • add-person   / edit-person
//   • add-injury   / edit-injury

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'
import { RemoteMultiSelect } from '@/components/remote-multi-select'
import { RemoteSearchSelect } from '@/components/remote-search-select'

// Body parts remain descriptive free text; injury types are managed taxonomy
// assignments and never pass through this comma-list helper.
function toCommaList(arr: string[]): string {
  return arr.join(', ')
}
function fromCommaList(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
}

// ---- People involved -------------------------------------------------------

const INCIDENT_PERSON_ROLES = ['involved', 'witness', 'foreman', 'supervisor', 'other'] as const

export type PersonInput = {
  id?: string
  incidentId: string
  personId: string | null
  personNameText: string | null
  role: string | null
}

type PersonAction = (input: PersonInput) => Promise<{ ok: boolean; error?: string }>

export function PersonDrawer({
  open,
  closeHref,
  incidentId,
  defaults,
  action,
  mode,
}: {
  open: boolean
  closeHref: string
  incidentId: string
  defaults?: {
    id: string
    personId: string | null
    personNameText: string | null
    role: string | null
  }
  action: PersonAction
  mode: 'create' | 'edit'
}) {
  const router = useRouter()
  const [personId, setPersonId] = useState(defaults?.personId ?? '')
  const [personNameText, setPersonNameText] = useState(defaults?.personNameText ?? '')
  const [role, setRole] = useState(defaults?.role ?? 'involved')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    if (!personId && !personNameText.trim()) {
      setError('Pick a person from the directory or type a name.')
      return
    }
    startTransition(async () => {
      const res = await action({
        id: defaults?.id,
        incidentId,
        personId: personId || null,
        personNameText: personId ? null : personNameText.trim() || null,
        role: role || null,
      })
      if (res.ok) {
        router.push(closeHref)
        router.refresh()
      } else {
        setError(res.error ?? 'Failed to save person.')
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={mode === 'create' ? 'Add person involved' : 'Edit person involved'}
      description="Link an employee from the directory, or type a name for someone external."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(closeHref)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            {mode === 'create' ? 'Add person' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Employee</Label>
          <RemoteSearchSelect
            lookup="incident-people"
            value={personId}
            onChange={(val) => setPersonId(val)}
            placeholder="Select a person…"
            searchPlaceholder="Search active people…"
            sheetTitle="Select person"
            ariaLabel="Employee"
            clearable
            emptyLabel="— Not in directory —"
          />
        </div>
        {!personId ? (
          <div className="space-y-1.5">
            <Label htmlFor="ip-name">Name (if not in directory)</Label>
            <Input
              id="ip-name"
              value={personNameText}
              onChange={(e) => setPersonNameText(e.currentTarget.value)}
              placeholder="e.g. Subcontractor — Jane Roe"
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="ip-role">Role</Label>
          <Select id="ip-role" value={role} onChange={(e) => setRole(e.currentTarget.value)}>
            {INCIDENT_PERSON_ROLES.map((r) => (
              <option key={r} value={r} className="capitalize">
                {r}
              </option>
            ))}
          </Select>
        </div>
        {error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
      </div>
    </UrlDrawer>
  )
}

// ---- Injury ----------------------------------------------------------------

export type InjuryInput = {
  id?: string
  incidentId: string
  personId: string | null
  personName: string | null
  injuryTypeIds: string[]
  injuryResult: string | null
  bodyParts: string[]
  treatment: string | null
  treatedAtFacility: string | null
  workedHoursPriorTo: number | null
}

type InjuryAction = (input: InjuryInput) => Promise<{ ok: boolean; error?: string }>

export function InjuryDrawer({
  open,
  closeHref,
  incidentId,
  defaults,
  action,
  mode,
}: {
  open: boolean
  closeHref: string
  incidentId: string
  defaults?: {
    id: string
    personId: string | null
    personName: string | null
    assignedTypes: { id: string; name: string }[]
    injuryResult: string | null
    bodyParts: string[]
    treatment: string | null
    treatedAtFacility: string | null
    workedHoursPriorTo: number | null
  }
  action: InjuryAction
  mode: 'create' | 'edit'
}) {
  const router = useRouter()
  const [personId, setPersonId] = useState(defaults?.personId ?? '')
  const [personName, setPersonName] = useState(defaults?.personName ?? '')
  const [selectedTypes, setSelectedTypes] = useState(
    (defaults?.assignedTypes ?? []).map((type) => ({ value: type.id, label: type.name })),
  )
  const [injuryResult, setInjuryResult] = useState(defaults?.injuryResult ?? '')
  const [bodyParts, setBodyParts] = useState(toCommaList(defaults?.bodyParts ?? []))
  const [treatment, setTreatment] = useState(defaults?.treatment ?? '')
  const [treatedAtFacility, setTreatedAtFacility] = useState(defaults?.treatedAtFacility ?? '')
  const [hours, setHours] = useState(
    defaults?.workedHoursPriorTo != null ? String(defaults.workedHoursPriorTo) : '',
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    if (!personId && !personName.trim()) {
      setError('Pick the injured person from the directory or type a name.')
      return
    }
    const hoursNum = hours.trim() === '' ? null : Number(hours)
    if (hoursNum != null && (!Number.isSafeInteger(hoursNum) || hoursNum < 0 || hoursNum > 24)) {
      setError('Hours worked prior must be a whole number from 0 to 24.')
      return
    }
    startTransition(async () => {
      const res = await action({
        id: defaults?.id,
        incidentId,
        personId: personId || null,
        personName: personId ? null : personName.trim() || null,
        injuryTypeIds: selectedTypes.map((type) => type.value),
        injuryResult: injuryResult.trim() || null,
        bodyParts: fromCommaList(bodyParts),
        treatment: treatment.trim() || null,
        treatedAtFacility: treatedAtFacility.trim() || null,
        workedHoursPriorTo: hoursNum,
      })
      if (res.ok) {
        router.push(closeHref)
        router.refresh()
      } else {
        setError(res.error ?? 'Failed to save injury.')
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={mode === 'create' ? 'Add injury' : 'Edit injury'}
      description="Record an injured person and their injuries for this incident."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(closeHref)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            {mode === 'create' ? 'Add injury' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Injured person</Label>
          <RemoteSearchSelect
            lookup="incident-people"
            value={personId}
            onChange={(val) => setPersonId(val)}
            placeholder="Select a person…"
            searchPlaceholder="Search active people…"
            sheetTitle="Select injured person"
            ariaLabel="Injured person"
            clearable
            emptyLabel="— Not in directory —"
          />
        </div>
        {!personId ? (
          <div className="space-y-1.5">
            <Label htmlFor="inj-name">Name (if not in directory)</Label>
            <Input
              id="inj-name"
              value={personName}
              onChange={(e) => setPersonName(e.currentTarget.value)}
              placeholder="e.g. Subcontractor — John Doe"
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label>Injury types</Label>
          <RemoteMultiSelect
            lookup="incident-injury-types"
            value={selectedTypes}
            onChange={setSelectedTypes}
            placeholder="Add an injury type…"
            searchPlaceholder="Search injury types or OSHA codes…"
            sheetTitle="Add injury type"
            ariaLabel="Add injury type"
            emptyLabel="No injury types selected."
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Select every applicable type from the managed injury taxonomy.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inj-hours">Hours worked prior</Label>
          <Input
            id="inj-hours"
            type="number"
            min={0}
            max={24}
            step={1}
            value={hours}
            onChange={(e) => setHours(e.currentTarget.value)}
            placeholder="e.g. 6"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inj-body">Body part(s)</Label>
          <Input
            id="inj-body"
            value={bodyParts}
            onChange={(e) => setBodyParts(e.currentTarget.value)}
            placeholder="Comma-separated, e.g. Left hand, Forearm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inj-result">Injury result / outcome</Label>
          <Textarea
            id="inj-result"
            value={injuryResult}
            onChange={(e) => setInjuryResult(e.currentTarget.value)}
            rows={3}
            placeholder="Describe the outcome, such as x-rays clear, stitches required, or modified duty assigned."
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Record the descriptive outcome here. Do not repeat the injury types.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inj-treatment">Treatment details</Label>
          <Textarea
            id="inj-treatment"
            value={treatment}
            onChange={(e) => setTreatment(e.currentTarget.value)}
            rows={3}
            placeholder="What treatment was given?"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inj-facility">Treated at facility</Label>
          <Input
            id="inj-facility"
            value={treatedAtFacility}
            onChange={(e) => setTreatedAtFacility(e.currentTarget.value)}
            placeholder="Clinic / hospital name"
          />
        </div>
        {error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
      </div>
    </UrlDrawer>
  )
}
