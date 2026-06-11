'use client'

// Spawn-CAPA / spawn-incident drawers for the response detail page.
//
// Renders two URL-state drawers (?drawer=spawn-ca / ?drawer=spawn-incident)
// with prefilled fields derived server-side from the failed-checks summary.
// On submit the drawer calls the server action; success → close drawer,
// refresh the page (so the new CAPA shows in audit), and redirect to the
// freshly-created entity's detail page.

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import type { SpawnPrefill } from './_spawn-prefill'

type SpawnCAAction = (input: {
  responseId: string
  title: string
  description?: string | null
  severity?: 'low' | 'medium' | 'high' | 'critical'
  dueOn?: string | null
  siteOrgUnitId?: string | null
  failedFieldKey?: string | null
}) => Promise<{ ok: true; caId: string; reference: string } | { ok: false; error: string }>

type SpawnIncidentAction = (input: {
  responseId: string
  title: string
  description?: string | null
  type?:
    | 'injury'
    | 'illness'
    | 'near_miss'
    | 'property_damage'
    | 'environmental'
    | 'security'
    | 'other'
  severity?: 'first_aid_only' | 'medical_aid' | 'lost_time' | 'fatality' | 'no_injury'
  occurredAt?: string | null
  siteOrgUnitId?: string | null
  location?: string | null
}) => Promise<{ ok: true; incidentId: string; reference: string } | { ok: false; error: string }>

export type SpawnDrawerKind = 'spawn-ca' | 'spawn-incident' | null

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
const INCIDENT_TYPES = [
  'injury',
  'illness',
  'near_miss',
  'property_damage',
  'environmental',
  'security',
  'other',
] as const
const INCIDENT_SEVERITIES = [
  'first_aid_only',
  'medical_aid',
  'lost_time',
  'fatality',
  'no_injury',
] as const

export function SpawnDrawers({
  responseId,
  openDrawer,
  closeHref,
  prefill,
  spawnCa,
  spawnIncident,
}: {
  responseId: string
  openDrawer: SpawnDrawerKind
  closeHref: string
  prefill: SpawnPrefill
  spawnCa: SpawnCAAction
  spawnIncident: SpawnIncidentAction
}) {
  return (
    <>
      <SpawnCAPADrawer
        open={openDrawer === 'spawn-ca'}
        closeHref={closeHref}
        responseId={responseId}
        prefill={prefill}
        action={spawnCa}
      />
      <SpawnIncidentDrawer
        open={openDrawer === 'spawn-incident'}
        closeHref={closeHref}
        responseId={responseId}
        prefill={prefill}
        action={spawnIncident}
      />
    </>
  )
}

function SpawnCAPADrawer({
  open,
  closeHref,
  responseId,
  prefill,
  action,
}: {
  open: boolean
  closeHref: string
  responseId: string
  prefill: SpawnPrefill
  action: SpawnCAAction
}) {
  const router = useRouter()
  const [title, setTitle] = useState(prefill.caTitle)
  const [description, setDescription] = useState(prefill.caDescription)
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>(prefill.caSeverity)
  const [dueOn, setDueOn] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Re-seed when the drawer re-opens with new prefill values (e.g. per-field
  // CAPA spawning sets a different title).
  useEffect(() => {
    if (open) {
      setTitle(prefill.caTitle)
      setDescription(prefill.caDescription)
      setSeverity(prefill.caSeverity)
      setError(null)
    }
  }, [open, prefill.caTitle, prefill.caDescription, prefill.caSeverity])

  function submit() {
    setError(null)
    const t = title.trim()
    if (!t) {
      setError('Title is required.')
      return
    }
    startTransition(async () => {
      const res = await action({
        responseId,
        title: t,
        description: description.trim() || null,
        severity,
        dueOn: dueOn || null,
      })
      if (res.ok) {
        toast.success(`Created ${res.reference}`)
        router.push(`/corrective-actions/${res.caId}`)
        router.refresh()
      } else {
        setError(res.error)
        toast.error(res.error)
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="Create corrective action"
      description="Address the non-compliance flagged by this form response."
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
          <Button type="button" onClick={submit} disabled={pending || !title.trim()}>
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            Create CAPA
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ca-title">Title</Label>
          <Input
            id="ca-title"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ca-description">Description</Label>
          <Textarea
            id="ca-description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={6}
          />
          <p className="text-[11px] text-slate-500">
            Pre-filled with the failed checks from this response. Edit as needed.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ca-severity">Severity</Label>
            <Select
              id="ca-severity"
              value={severity}
              onChange={(e) => setSeverity(e.currentTarget.value as (typeof SEVERITIES)[number])}
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <p className="text-[11px] text-slate-500">Default chosen from compliance score band.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ca-due">Due on</Label>
            <Input
              id="ca-due"
              type="date"
              value={dueOn}
              onChange={(e) => setDueOn(e.currentTarget.value)}
            />
          </div>
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

function SpawnIncidentDrawer({
  open,
  closeHref,
  responseId,
  prefill,
  action,
}: {
  open: boolean
  closeHref: string
  responseId: string
  prefill: SpawnPrefill
  action: SpawnIncidentAction
}) {
  const router = useRouter()
  const [title, setTitle] = useState(prefill.incidentTitle)
  const [description, setDescription] = useState(prefill.incidentDescription)
  const [type, setType] = useState<(typeof INCIDENT_TYPES)[number]>('other')
  const [severity, setSeverity] = useState<(typeof INCIDENT_SEVERITIES)[number]>('no_injury')
  const [occurredAt, setOccurredAt] = useState<string>(() => new Date().toISOString().slice(0, 16))
  const [location, setLocation] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (open) {
      setTitle(prefill.incidentTitle)
      setDescription(prefill.incidentDescription)
      setOccurredAt(new Date().toISOString().slice(0, 16))
      setError(null)
    }
  }, [open, prefill.incidentTitle, prefill.incidentDescription])

  function submit() {
    setError(null)
    const t = title.trim()
    if (!t) {
      setError('Title is required.')
      return
    }
    startTransition(async () => {
      const res = await action({
        responseId,
        title: t,
        description: description.trim() || null,
        type,
        severity,
        occurredAt,
        location: location.trim() || null,
      })
      if (res.ok) {
        toast.success(`Created ${res.reference}`)
        router.push(`/incidents/${res.incidentId}`)
        router.refresh()
      } else {
        setError(res.error)
        toast.error(res.error)
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="Create incident"
      description="Escalate this response into an incident report."
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
          <Button type="button" onClick={submit} disabled={pending || !title.trim()}>
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            Create incident
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="inc-title">Title</Label>
          <Input
            id="inc-title"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inc-description">Description</Label>
          <Textarea
            id="inc-description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={6}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="inc-type">Type</Label>
            <Select
              id="inc-type"
              value={type}
              onChange={(e) => setType(e.currentTarget.value as (typeof INCIDENT_TYPES)[number])}
            >
              {INCIDENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inc-severity">Severity</Label>
            <Select
              id="inc-severity"
              value={severity}
              onChange={(e) =>
                setSeverity(e.currentTarget.value as (typeof INCIDENT_SEVERITIES)[number])
              }
            >
              {INCIDENT_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inc-occurred">Occurred at</Label>
            <Input
              id="inc-occurred"
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.currentTarget.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inc-location">Specific location</Label>
            <Input
              id="inc-location"
              value={location}
              onChange={(e) => setLocation(e.currentTarget.value)}
              placeholder="Building / area"
            />
          </div>
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
