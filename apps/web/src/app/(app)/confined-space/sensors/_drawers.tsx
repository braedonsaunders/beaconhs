'use client'

// Drawers for the atmospheric-sensors list page:
//   • new-sensor   → register a new sensor
//   • edit-sensor  → edit an existing sensor (id taken from ?id=…)
//
// Both open via `?drawer=…` so they survive page refreshes and are
// link-shareable. Server actions are passed in from the RSC page.

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Select, UrlDrawer } from '@beaconhs/ui'

export type SensorType = 'multi_gas' | '4_gas' | 'single_gas'
export type SensorStatus = 'active' | 'out_of_service' | 'retired'

const TYPES: { value: SensorType; label: string }[] = [
  { value: 'multi_gas', label: 'Multi-gas' },
  { value: '4_gas', label: '4-gas' },
  { value: 'single_gas', label: 'Single-gas' },
]

const STATUSES: { value: SensorStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'out_of_service', label: 'Out of service' },
  { value: 'retired', label: 'Retired' },
]

type CreateAction = (input: {
  identifier: string
  make: string | null
  model: string | null
  serialNumber: string | null
  type: SensorType
  gases: string[]
  lastCalibrationOn: string | null
  nextCalibrationDue: string | null
  status: SensorStatus
}) => Promise<{ ok: true; id: string } | { ok: false; error: string }>

type UpdateAction = (input: {
  id: string
  identifier: string
  make: string | null
  model: string | null
  serialNumber: string | null
  type: SensorType
  gases: string[]
  status: SensorStatus
}) => Promise<{ ok: true } | { ok: false; error: string }>

export type EditSensorDefaults = {
  id: string
  identifier: string
  make: string | null
  model: string | null
  serialNumber: string | null
  type: SensorType
  gases: string[]
  status: SensorStatus
}

export function SensorDrawers({
  openDrawer,
  closeHref,
  createAction,
  updateAction,
  editDefaults,
}: {
  openDrawer: 'new-sensor' | 'edit-sensor' | null
  closeHref: string
  createAction: CreateAction
  updateAction: UpdateAction
  editDefaults: EditSensorDefaults | null
}) {
  return (
    <>
      <NewSensorDrawer
        open={openDrawer === 'new-sensor'}
        closeHref={closeHref}
        action={createAction}
      />
      <EditSensorDrawer
        open={openDrawer === 'edit-sensor' && !!editDefaults}
        closeHref={closeHref}
        defaults={editDefaults}
        action={updateAction}
      />
    </>
  )
}

function splitGases(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((g) => g.trim())
    .filter(Boolean)
}

// ---- New sensor ------------------------------------------------------------

function NewSensorDrawer({
  open,
  closeHref,
  action,
}: {
  open: boolean
  closeHref: string
  action: CreateAction
}) {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [type, setType] = useState<SensorType>('multi_gas')
  const [status, setStatus] = useState<SensorStatus>('active')
  const [gases, setGases] = useState('')
  const [lastCalibrationOn, setLastCalibrationOn] = useState('')
  const [nextCalibrationDue, setNextCalibrationDue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) {
      setIdentifier('')
      setSerialNumber('')
      setMake('')
      setModel('')
      setType('multi_gas')
      setStatus('active')
      setGases('')
      setLastCalibrationOn('')
      setNextCalibrationDue('')
      setError(null)
    }
  }, [open])

  function submit() {
    setError(null)
    const trimmed = identifier.trim()
    if (!trimmed) {
      setError('Identifier is required')
      return
    }
    startTransition(async () => {
      const res = await action({
        identifier: trimmed,
        make: make.trim() || null,
        model: model.trim() || null,
        serialNumber: serialNumber.trim() || null,
        type,
        gases: splitGases(gases),
        lastCalibrationOn: lastCalibrationOn.trim() || null,
        nextCalibrationDue: nextCalibrationDue.trim() || null,
        status,
      })
      if (res.ok) {
        router.push(closeHref)
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="New atmospheric sensor"
      description="Register a sensor to start tracking its calibration history."
      size="lg"
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
            Register sensor
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Identifier" required>
          <Input
            value={identifier}
            onChange={(e) => setIdentifier(e.currentTarget.value)}
            required
            placeholder="e.g. GASMON-04"
          />
        </Field>
        <Field label="Serial #">
          <Input
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.currentTarget.value)}
            placeholder="manufacturer serial"
          />
        </Field>
        <Field label="Make">
          <Input
            value={make}
            onChange={(e) => setMake(e.currentTarget.value)}
            placeholder="e.g. BW Technologies"
          />
        </Field>
        <Field label="Model">
          <Input
            value={model}
            onChange={(e) => setModel(e.currentTarget.value)}
            placeholder="e.g. GasAlertMicro 5"
          />
        </Field>
        <Field label="Type" required>
          <Select value={type} onChange={(e) => setType(e.currentTarget.value as SensorType)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" required>
          <Select value={status} onChange={(e) => setStatus(e.currentTarget.value as SensorStatus)}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Gases (comma or space separated)" className="sm:col-span-2">
          <Input
            value={gases}
            onChange={(e) => setGases(e.currentTarget.value)}
            placeholder="O2, LEL, H2S, CO"
          />
        </Field>
        <Field label="Last calibration">
          <Input
            type="date"
            value={lastCalibrationOn}
            onChange={(e) => setLastCalibrationOn(e.currentTarget.value)}
          />
        </Field>
        <Field label="Next calibration due">
          <Input
            type="date"
            value={nextCalibrationDue}
            onChange={(e) => setNextCalibrationDue(e.currentTarget.value)}
          />
        </Field>
      </div>
      {error ? (
        <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
    </UrlDrawer>
  )
}

// ---- Edit sensor -----------------------------------------------------------

function EditSensorDrawer({
  open,
  closeHref,
  defaults,
  action,
}: {
  open: boolean
  closeHref: string
  defaults: EditSensorDefaults | null
  action: UpdateAction
}) {
  const router = useRouter()
  const [identifier, setIdentifier] = useState(defaults?.identifier ?? '')
  const [serialNumber, setSerialNumber] = useState(defaults?.serialNumber ?? '')
  const [make, setMake] = useState(defaults?.make ?? '')
  const [model, setModel] = useState(defaults?.model ?? '')
  const [type, setType] = useState<SensorType>(defaults?.type ?? 'multi_gas')
  const [status, setStatus] = useState<SensorStatus>(defaults?.status ?? 'active')
  const [gases, setGases] = useState(defaults?.gases?.join(', ') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (defaults) {
      setIdentifier(defaults.identifier)
      setSerialNumber(defaults.serialNumber ?? '')
      setMake(defaults.make ?? '')
      setModel(defaults.model ?? '')
      setType(defaults.type)
      setStatus(defaults.status)
      setGases(defaults.gases.join(', '))
      setError(null)
    }
  }, [defaults])

  function submit() {
    if (!defaults) return
    setError(null)
    const trimmed = identifier.trim()
    if (!trimmed) {
      setError('Identifier is required')
      return
    }
    startTransition(async () => {
      const res = await action({
        id: defaults.id,
        identifier: trimmed,
        make: make.trim() || null,
        model: model.trim() || null,
        serialNumber: serialNumber.trim() || null,
        type,
        gases: splitGases(gases),
        status,
      })
      if (res.ok) {
        router.push(closeHref)
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={defaults ? `Edit ${defaults.identifier}` : 'Edit sensor'}
      description="Update the sensor's identifying details. Calibration history is managed from the sensor's detail page."
      size="lg"
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
          <Button type="button" onClick={submit} disabled={pending || !defaults}>
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Identifier" required>
          <Input
            value={identifier}
            onChange={(e) => setIdentifier(e.currentTarget.value)}
            required
          />
        </Field>
        <Field label="Serial #">
          <Input value={serialNumber} onChange={(e) => setSerialNumber(e.currentTarget.value)} />
        </Field>
        <Field label="Make">
          <Input value={make} onChange={(e) => setMake(e.currentTarget.value)} />
        </Field>
        <Field label="Model">
          <Input value={model} onChange={(e) => setModel(e.currentTarget.value)} />
        </Field>
        <Field label="Type" required>
          <Select value={type} onChange={(e) => setType(e.currentTarget.value as SensorType)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" required>
          <Select value={status} onChange={(e) => setStatus(e.currentTarget.value as SensorStatus)}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Gases (comma or space separated)" className="sm:col-span-2">
          <Input value={gases} onChange={(e) => setGases(e.currentTarget.value)} />
        </Field>
      </div>
      {error ? (
        <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
    </UrlDrawer>
  )
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
