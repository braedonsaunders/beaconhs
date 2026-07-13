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
import { Button, Input, Label, SearchSelect, Select, Textarea, UrlDrawer } from '@beaconhs/ui'

type Person = { id: string; firstName: string; lastName: string; employeeNo?: string | null }

function personOptions(people: Person[]) {
  return people.map((p) => ({
    value: p.id,
    label: `${p.lastName}, ${p.firstName}`,
    hint: p.employeeNo ?? undefined,
  }))
}

// Array <-> comma-separated string helpers for the freeform legacy arrays.
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
type IncidentPersonRole = (typeof INCIDENT_PERSON_ROLES)[number]

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
  people,
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
  people: Person[]
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
          <SearchSelect
            value={personId}
            onChange={(val) => setPersonId(val)}
            options={personOptions(people)}
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
  injuryTypeId: string | null
  injuryTypes: string[]
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
  people,
  injuryTypeOptions,
}: {
  open: boolean
  closeHref: string
  incidentId: string
  defaults?: {
    id: string
    personId: string | null
    personName: string | null
    injuryTypeId: string | null
    injuryTypes: string[]
    bodyParts: string[]
    treatment: string | null
    treatedAtFacility: string | null
    workedHoursPriorTo: number | null
  }
  action: InjuryAction
  mode: 'create' | 'edit'
  people: Person[]
  injuryTypeOptions: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [personId, setPersonId] = useState(defaults?.personId ?? '')
  const [personName, setPersonName] = useState(defaults?.personName ?? '')
  const [injuryTypeId, setInjuryTypeId] = useState(defaults?.injuryTypeId ?? '')
  const [injuryTypes, setInjuryTypes] = useState(toCommaList(defaults?.injuryTypes ?? []))
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
    if (hoursNum != null && (Number.isNaN(hoursNum) || hoursNum < 0)) {
      setError('Hours worked prior must be a non-negative number.')
      return
    }
    startTransition(async () => {
      const res = await action({
        id: defaults?.id,
        incidentId,
        personId: personId || null,
        personName: personId ? null : personName.trim() || null,
        injuryTypeId: injuryTypeId || null,
        injuryTypes: fromCommaList(injuryTypes),
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
          <SearchSelect
            value={personId}
            onChange={(val) => setPersonId(val)}
            options={personOptions(people)}
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="inj-type">Injury type</Label>
            <Select
              id="inj-type"
              value={injuryTypeId}
              onChange={(e) => setInjuryTypeId(e.currentTarget.value)}
            >
              <option value="">—</option>
              {injuryTypeOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inj-hours">Hours worked prior</Label>
            <Input
              id="inj-hours"
              type="number"
              min={0}
              value={hours}
              onChange={(e) => setHours(e.currentTarget.value)}
              placeholder="e.g. 6"
            />
          </div>
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
          <Label htmlFor="inj-types">Injury label(s)</Label>
          <Input
            id="inj-types"
            value={injuryTypes}
            onChange={(e) => setInjuryTypes(e.currentTarget.value)}
            placeholder="Comma-separated, e.g. Laceration, Bruise"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inj-treatment">Treatment</Label>
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
