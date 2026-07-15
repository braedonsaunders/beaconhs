'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Spawn-CAPA / spawn-incident drawers for the response detail page.
//
// Renders two URL-state drawers (?drawer=spawn-ca / ?drawer=spawn-incident)
// with prefilled fields derived server-side from the failed-checks summary.
// On submit the drawer calls the server action; success → close drawer,
// refresh the page (so the new CAPA shows in audit), and redirect to the
// freshly-created entity's detail page.

import { useState, useTransition } from 'react'
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
    'injury' | 'illness' | 'near_miss' | 'property_damage' | 'environmental' | 'security' | 'other'
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

// Current LOCAL wall-clock time formatted for <input type="datetime-local">
// ("YYYY-MM-DDTHH:mm"). `toISOString()` alone is UTC and shows a time hours off
// the user's clock.
function localDatetimeValue(d: Date = new Date()): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

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
      <GeneratedValue
        value={
          openDrawer === 'spawn-ca' ? (
            <SpawnCAPADrawer
              closeHref={closeHref}
              responseId={responseId}
              prefill={prefill}
              action={spawnCa}
            />
          ) : null
        }
      />
      <GeneratedValue
        value={
          openDrawer === 'spawn-incident' ? (
            <SpawnIncidentDrawer
              closeHref={closeHref}
              responseId={responseId}
              prefill={prefill}
              action={spawnIncident}
            />
          ) : null
        }
      />
    </>
  )
}

function SpawnCAPADrawer({
  closeHref,
  responseId,
  prefill,
  action,
}: {
  closeHref: string
  responseId: string
  prefill: SpawnPrefill
  action: SpawnCAAction
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [title, setTitle] = useState(prefill.caTitle)
  const [description, setDescription] = useState(prefill.caDescription)
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>(prefill.caSeverity)
  const [dueOn, setDueOn] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    const t = title.trim()
    if (!t) {
      setError(tGenerated('m_1877089311a4ac'))
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
        toast.success(tGenerated('m_1f96b34169f66c', { value0: res.reference }))
        router.push(`/corrective-actions/${res.caId}`)
        router.refresh()
      } else {
        setError(tGeneratedValue(res.error))
        toast.error(tGeneratedValue(res.error))
      }
    })
  }

  return (
    <UrlDrawer
      open
      closeHref={closeHref}
      title={tGenerated('m_079cef507d2c7e')}
      description={tGenerated('m_15e2f6c94ef43f')}
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
          <Button type="button" onClick={submit} disabled={pending || !title.trim()}>
            <GeneratedValue
              value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            />
            <GeneratedText id="m_07b71156553d0b" />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ca-title">
            <GeneratedText id="m_0decefd558c355" />
          </Label>
          <Input
            id="ca-title"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ca-description">
            <GeneratedText id="m_14d923495cf14c" />
          </Label>
          <Textarea
            id="ca-description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={6}
          />
          <p className="text-[11px] text-slate-500">
            <GeneratedText id="m_13b5818a1a46d6" />
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ca-severity">
              <GeneratedText id="m_168b365cc671bf" />
            </Label>
            <Select
              id="ca-severity"
              value={severity}
              onChange={(e) => setSeverity(e.currentTarget.value as (typeof SEVERITIES)[number])}
            >
              <GeneratedValue
                value={SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    <GeneratedValue value={s} />
                  </option>
                ))}
              />
            </Select>
            <p className="text-[11px] text-slate-500">
              <GeneratedText id="m_15766056173fb4" />
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ca-due">
              <GeneratedText id="m_04bfc1eaee3a4b" />
            </Label>
            <Input
              id="ca-due"
              type="date"
              value={dueOn}
              onChange={(e) => setDueOn(e.currentTarget.value)}
            />
          </div>
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

function SpawnIncidentDrawer({
  closeHref,
  responseId,
  prefill,
  action,
}: {
  closeHref: string
  responseId: string
  prefill: SpawnPrefill
  action: SpawnIncidentAction
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [title, setTitle] = useState(prefill.incidentTitle)
  const [description, setDescription] = useState(prefill.incidentDescription)
  const [type, setType] = useState<(typeof INCIDENT_TYPES)[number]>('other')
  const [severity, setSeverity] = useState<(typeof INCIDENT_SEVERITIES)[number]>('no_injury')
  const [occurredAt, setOccurredAt] = useState<string>(() => localDatetimeValue())
  const [location, setLocation] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    const t = title.trim()
    if (!t) {
      setError(tGenerated('m_1877089311a4ac'))
      return
    }
    // The datetime-local value is zone-less; parse it in the BROWSER's timezone
    // and send an unambiguous ISO instant so the server never re-interprets it
    // in its own timezone.
    const occurredAtDate = occurredAt ? new Date(occurredAt) : new Date()
    if (Number.isNaN(occurredAtDate.getTime())) {
      setError(tGenerated('m_05412aa7ae5a33'))
      return
    }
    startTransition(async () => {
      const res = await action({
        responseId,
        title: t,
        description: description.trim() || null,
        type,
        severity,
        occurredAt: occurredAtDate.toISOString(),
        location: location.trim() || null,
      })
      if (res.ok) {
        toast.success(tGenerated('m_1f96b34169f66c', { value0: res.reference }))
        router.push(`/incidents/${res.incidentId}`)
        router.refresh()
      } else {
        setError(tGeneratedValue(res.error))
        toast.error(tGeneratedValue(res.error))
      }
    })
  }

  return (
    <UrlDrawer
      open
      closeHref={closeHref}
      title={tGenerated('m_0b7f374a64e552')}
      description={tGenerated('m_02df41e030ed9c')}
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
          <Button type="button" onClick={submit} disabled={pending || !title.trim()}>
            <GeneratedValue
              value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            />
            <GeneratedText id="m_0b7f374a64e552" />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="inc-title">
            <GeneratedText id="m_0decefd558c355" />
          </Label>
          <Input
            id="inc-title"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inc-description">
            <GeneratedText id="m_14d923495cf14c" />
          </Label>
          <Textarea
            id="inc-description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={6}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="inc-type">
              <GeneratedText id="m_074ba2f160c506" />
            </Label>
            <Select
              id="inc-type"
              value={type}
              onChange={(e) => setType(e.currentTarget.value as (typeof INCIDENT_TYPES)[number])}
            >
              <GeneratedValue
                value={INCIDENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    <GeneratedValue value={t.replace(/_/g, ' ')} />
                  </option>
                ))}
              />
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inc-severity">
              <GeneratedText id="m_168b365cc671bf" />
            </Label>
            <Select
              id="inc-severity"
              value={severity}
              onChange={(e) =>
                setSeverity(e.currentTarget.value as (typeof INCIDENT_SEVERITIES)[number])
              }
            >
              <GeneratedValue
                value={INCIDENT_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    <GeneratedValue value={s.replace(/_/g, ' ')} />
                  </option>
                ))}
              />
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inc-occurred">
              <GeneratedText id="m_03f174df92cf82" />
            </Label>
            <Input
              id="inc-occurred"
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.currentTarget.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inc-location">
              <GeneratedText id="m_0352b4ecd48a3a" />
            </Label>
            <Input
              id="inc-location"
              value={location}
              onChange={(e) => setLocation(e.currentTarget.value)}
              placeholder={tGenerated('m_1d69847bdc6cd6')}
            />
          </div>
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
