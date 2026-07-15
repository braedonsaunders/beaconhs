'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [personId, setPersonId] = useState(defaults?.personId ?? '')
  const [personNameText, setPersonNameText] = useState(defaults?.personNameText ?? '')
  const [role, setRole] = useState(defaults?.role ?? 'involved')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    if (!personId && !personNameText.trim()) {
      setError(tGenerated('m_07da2c55e2e1db'))
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
        setError(tGeneratedValue(res.error ?? tGenerated('m_0509d1385fe86f')))
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGeneratedValue(
        mode === 'create' ? tGenerated('m_01fa8eb5678aba') : tGenerated('m_1c7b6fd2a05e78'),
      )}
      description={tGenerated('m_11ad5b99a20057')}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(closeHref)}
            disabled={pending}
          >
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            <GeneratedValue
              value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            />
            <GeneratedValue
              value={
                mode === 'create' ? (
                  <GeneratedText id="m_12634c941f2fb6" />
                ) : (
                  <GeneratedText id="m_1ab9025ed1067c" />
                )
              }
            />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_0d191facfeeb70" />
          </Label>
          <RemoteSearchSelect
            lookup="incident-people"
            value={personId}
            onChange={(val) => setPersonId(val)}
            placeholder={tGenerated('m_0be39d3a196b5b')}
            searchPlaceholder={tGenerated('m_06c2338b990aea')}
            sheetTitle="Select person"
            ariaLabel="Employee"
            clearable
            emptyLabel={tGenerated('m_01ffe7a1b2092f')}
          />
        </div>
        <GeneratedValue
          value={
            !personId ? (
              <div className="space-y-1.5">
                <Label htmlFor="ip-name">
                  <GeneratedText id="m_066670d2e6b4aa" />
                </Label>
                <Input
                  id="ip-name"
                  value={personNameText}
                  onChange={(e) => setPersonNameText(e.currentTarget.value)}
                  placeholder={tGenerated('m_1eb3b0715a46f2')}
                />
              </div>
            ) : null
          }
        />
        <div className="space-y-1.5">
          <Label htmlFor="ip-role">
            <GeneratedText id="m_1099c1fe8b6614" />
          </Label>
          <Select id="ip-role" value={role} onChange={(e) => setRole(e.currentTarget.value)}>
            {INCIDENT_PERSON_ROLES.map((r) => (
              <option key={r} value={r} className="capitalize">
                {r}
              </option>
            ))}
          </Select>
        </div>
        <GeneratedValue
          value={
            error ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <GeneratedValue value={error} />
              </p>
            ) : null
          }
        />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
    setError(tGeneratedValue(null))
    if (!personId && !personName.trim()) {
      setError(tGenerated('m_1a15b7b55edd22'))
      return
    }
    const hoursNum = hours.trim() === '' ? null : Number(hours)
    if (hoursNum != null && (!Number.isSafeInteger(hoursNum) || hoursNum < 0 || hoursNum > 24)) {
      setError(tGenerated('m_003debd46d7285'))
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
        setError(tGeneratedValue(res.error ?? tGenerated('m_12ec8a770ecb46')))
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGeneratedValue(
        mode === 'create' ? tGenerated('m_141cf443767ce4') : tGenerated('m_011c199f991de6'),
      )}
      description={tGenerated('m_1240c7acfa8859')}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(closeHref)}
            disabled={pending}
          >
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            <GeneratedValue
              value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            />
            <GeneratedValue
              value={
                mode === 'create' ? (
                  <GeneratedText id="m_141cf443767ce4" />
                ) : (
                  <GeneratedText id="m_1ab9025ed1067c" />
                )
              }
            />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_1d999b9d64d80b" />
          </Label>
          <RemoteSearchSelect
            lookup="incident-people"
            value={personId}
            onChange={(val) => setPersonId(val)}
            placeholder={tGenerated('m_0be39d3a196b5b')}
            searchPlaceholder={tGenerated('m_06c2338b990aea')}
            sheetTitle="Select injured person"
            ariaLabel="Injured person"
            clearable
            emptyLabel={tGenerated('m_01ffe7a1b2092f')}
          />
        </div>
        <GeneratedValue
          value={
            !personId ? (
              <div className="space-y-1.5">
                <Label htmlFor="inj-name">
                  <GeneratedText id="m_066670d2e6b4aa" />
                </Label>
                <Input
                  id="inj-name"
                  value={personName}
                  onChange={(e) => setPersonName(e.currentTarget.value)}
                  placeholder={tGenerated('m_027ee743b67064')}
                />
              </div>
            ) : null
          }
        />
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_0a5b093d5cee01" />
          </Label>
          <RemoteMultiSelect
            lookup="incident-injury-types"
            value={selectedTypes}
            onChange={setSelectedTypes}
            placeholder={tGenerated('m_080311834cbd3f')}
            searchPlaceholder={tGenerated('m_1870ae271f2c89')}
            sheetTitle="Add injury type"
            ariaLabel="Add injury type"
            emptyLabel={tGenerated('m_1de81608882780')}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_14a3dac17763c4" />
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inj-hours">
            <GeneratedText id="m_0ef1fd7107fc01" />
          </Label>
          <Input
            id="inj-hours"
            type="number"
            min={0}
            max={24}
            step={1}
            value={hours}
            onChange={(e) => setHours(e.currentTarget.value)}
            placeholder={tGenerated('m_1aa4cbb8fa2ae4')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inj-body">
            <GeneratedText id="m_05f50e2b9ddfaa" />
          </Label>
          <Input
            id="inj-body"
            value={bodyParts}
            onChange={(e) => setBodyParts(e.currentTarget.value)}
            placeholder={tGenerated('m_1ad7846599f231')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inj-result">
            <GeneratedText id="m_1f879beb60320d" />
          </Label>
          <Textarea
            id="inj-result"
            value={injuryResult}
            onChange={(e) => setInjuryResult(e.currentTarget.value)}
            rows={3}
            placeholder={tGenerated('m_1e3e77c830ce32')}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_10f13da076b66e" />
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inj-treatment">
            <GeneratedText id="m_0042b16933d8aa" />
          </Label>
          <Textarea
            id="inj-treatment"
            value={treatment}
            onChange={(e) => setTreatment(e.currentTarget.value)}
            rows={3}
            placeholder={tGenerated('m_01707f4b24353f')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inj-facility">
            <GeneratedText id="m_06a636778efbd4" />
          </Label>
          <Input
            id="inj-facility"
            value={treatedAtFacility}
            onChange={(e) => setTreatedAtFacility(e.currentTarget.value)}
            placeholder={tGenerated('m_045d5f0180f996')}
          />
        </div>
        <GeneratedValue
          value={
            error ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <GeneratedValue value={error} />
              </p>
            ) : null
          }
        />
      </div>
    </UrlDrawer>
  )
}
