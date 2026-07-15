'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Investigation sub-entity drawers for the incident detail page. All four
// open via `?drawer=…&editId=…` so they survive page refreshes and are
// link-shareable. Server actions are passed in from the RSC page.
//
//   • new-event           / edit-event
//   • new-factor          / edit-factor
//   • new-why             / edit-why
//   • new-prev-step       / edit-prev-step

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'

// ---- Event timeline --------------------------------------------------------

type EventInput = {
  id?: string
  incidentId: string
  occurredAt: string // ISO datetime-local value
  description: string
}

type EventAction = (input: EventInput) => Promise<{ ok: boolean; error?: string }>

export function EventDrawer({
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
  defaults?: { id: string; occurredAt: string; description: string }
  action: EventAction
  mode: 'create' | 'edit'
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [occurredAt, setOccurredAt] = useState(defaults?.occurredAt ?? defaultNow())
  const [description, setDescription] = useState(defaults?.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    if (!description.trim()) {
      setError(tGenerated('m_05953832b2f327'))
      return
    }
    if (!occurredAt.trim()) {
      setError(tGenerated('m_114dabd38fd7b8'))
      return
    }
    startTransition(async () => {
      const res = await action({
        id: defaults?.id,
        incidentId,
        occurredAt,
        description: description.trim(),
      })
      if (res.ok) {
        router.push(closeHref)
        router.refresh()
      } else {
        setError(tGeneratedValue(res.error ?? tGenerated('m_1871e41f127326')))
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGeneratedValue(
        mode === 'create' ? tGenerated('m_03f3f48d8120d5') : tGenerated('m_03d74c6def030a'),
      )}
      description={tGenerated('m_1a787a4e3059c7')}
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
                  <GeneratedText id="m_09cd8e0f2553a4" />
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
          <Label htmlFor="ev-occurred">
            <GeneratedText id="m_13cc128f69897c" /> <span className="text-red-600">*</span>
          </Label>
          <Input
            id="ev-occurred"
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.currentTarget.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ev-desc">
            <GeneratedText id="m_0682629500df7e" /> <span className="text-red-600">*</span>
          </Label>
          <Textarea
            id="ev-desc"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={5}
            placeholder={tGenerated('m_1106a438b98045')}
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

// ---- Contributing factor ---------------------------------------------------

export const FACTOR_CATEGORIES = [
  'equipment',
  'procedure',
  'training',
  'environment',
  'human',
  'other',
] as const
export type FactorCategory = (typeof FACTOR_CATEGORIES)[number]

type FactorInput = {
  id?: string
  incidentId: string
  category: FactorCategory
  description: string
}

type FactorAction = (input: FactorInput) => Promise<{ ok: boolean; error?: string }>

export function FactorDrawer({
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
  defaults?: { id: string; category: FactorCategory; description: string }
  action: FactorAction
  mode: 'create' | 'edit'
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [category, setCategory] = useState<FactorCategory>(defaults?.category ?? 'equipment')
  const [description, setDescription] = useState(defaults?.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    if (!description.trim()) {
      setError(tGenerated('m_05953832b2f327'))
      return
    }
    startTransition(async () => {
      const res = await action({
        id: defaults?.id,
        incidentId,
        category,
        description: description.trim(),
      })
      if (res.ok) {
        router.push(closeHref)
        router.refresh()
      } else {
        setError(tGeneratedValue(res.error ?? tGenerated('m_1581f28d2461d8')))
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGeneratedValue(
        mode === 'create' ? tGenerated('m_088bd62f7760fd') : tGenerated('m_1ac5fed5058b19'),
      )}
      description={tGenerated('m_08166597f4cae4')}
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
                  <GeneratedText id="m_04e475dcb7d6d7" />
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
          <Label htmlFor="fac-cat">
            <GeneratedText id="m_108b41637f364f" /> <span className="text-red-600">*</span>
          </Label>
          <Select
            id="fac-cat"
            value={category}
            onChange={(e) => setCategory(e.currentTarget.value as FactorCategory)}
          >
            <GeneratedValue
              value={FACTOR_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  <GeneratedValue value={c.charAt(0).toUpperCase() + c.slice(1)} />
                </option>
              ))}
            />
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fac-desc">
            <GeneratedText id="m_14d923495cf14c" /> <span className="text-red-600">*</span>
          </Label>
          <Textarea
            id="fac-desc"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={4}
            placeholder={tGenerated('m_1d48fe717ffb31')}
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

// ---- Root cause why --------------------------------------------------------

type WhyInput = {
  id?: string
  incidentId: string
  ordinal: number
  whyText: string
}

type WhyAction = (input: WhyInput) => Promise<{ ok: boolean; error?: string }>

export function WhyDrawer({
  open,
  closeHref,
  incidentId,
  defaults,
  action,
  mode,
  nextOrdinal,
}: {
  open: boolean
  closeHref: string
  incidentId: string
  defaults?: { id: string; ordinal: number; whyText: string }
  action: WhyAction
  mode: 'create' | 'edit'
  nextOrdinal: number
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [ordinal, setOrdinal] = useState<number>(defaults?.ordinal ?? nextOrdinal)
  const [whyText, setWhyText] = useState(defaults?.whyText ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    if (!whyText.trim()) {
      setError(tGenerated('m_127ea8e2a73a79'))
      return
    }
    if (ordinal < 1 || ordinal > 5) {
      setError(tGenerated('m_0376e889804701'))
      return
    }
    startTransition(async () => {
      const res = await action({
        id: defaults?.id,
        incidentId,
        ordinal,
        whyText: whyText.trim(),
      })
      if (res.ok) {
        router.push(closeHref)
        router.refresh()
      } else {
        setError(tGeneratedValue(res.error ?? tGenerated('m_0b66bc0fcc2633')))
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGeneratedValue(
        mode === 'create' ? tGenerated('m_069fb2eb0f96c6') : tGenerated('m_1f1cd05a67737c'),
      )}
      description={tGenerated('m_1fd1d2b4191606')}
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
                  <GeneratedText id="m_0ce705b8fa979c" />
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
          <Label htmlFor="why-ord">
            <GeneratedText id="m_05eca417480224" /> <span className="text-red-600">*</span>
          </Label>
          <Select
            id="why-ord"
            value={String(ordinal)}
            onChange={(e) => setOrdinal(Number(e.currentTarget.value))}
          >
            <GeneratedValue
              value={[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  <GeneratedText id="m_11ba5ccd975250" />
                  <GeneratedValue value={n} />
                </option>
              ))}
            />
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="why-text">
            <GeneratedText id="m_1f88065a87f4df" /> <span className="text-red-600">*</span>
          </Label>
          <Textarea
            id="why-text"
            value={whyText}
            onChange={(e) => setWhyText(e.currentTarget.value)}
            rows={3}
            placeholder={tGenerated('m_15167cbd8d8a5d')}
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

// ---- Preventative step -----------------------------------------------------

export const PREV_STEP_STATUSES = ['planned', 'in_progress', 'completed'] as const
export type PrevStepStatus = (typeof PREV_STEP_STATUSES)[number]

type PrevStepInput = {
  id?: string
  incidentId: string
  description: string
  ownerPersonId: string | null
  targetDate: string | null
  status: PrevStepStatus
}

type PrevStepAction = (input: PrevStepInput) => Promise<{ ok: boolean; error?: string }>

export function PrevStepDrawer({
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
    description: string
    ownerPersonId: string | null
    targetDate: string | null
    status: PrevStepStatus
  }
  action: PrevStepAction
  mode: 'create' | 'edit'
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [description, setDescription] = useState(defaults?.description ?? '')
  const [ownerPersonId, setOwnerPersonId] = useState(defaults?.ownerPersonId ?? '')
  const [targetDate, setTargetDate] = useState(defaults?.targetDate ?? '')
  const [status, setStatus] = useState<PrevStepStatus>(defaults?.status ?? 'planned')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    if (!description.trim()) {
      setError(tGenerated('m_05953832b2f327'))
      return
    }
    startTransition(async () => {
      const res = await action({
        id: defaults?.id,
        incidentId,
        description: description.trim(),
        ownerPersonId: ownerPersonId || null,
        targetDate: targetDate || null,
        status,
      })
      if (res.ok) {
        router.push(closeHref)
        router.refresh()
      } else {
        setError(tGeneratedValue(res.error ?? tGenerated('m_0436c0c2558fa3')))
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGeneratedValue(
        mode === 'create' ? tGenerated('m_15bb1510df3395') : tGenerated('m_1ff9133918f285'),
      )}
      description={tGenerated('m_16e61e5cbb4598')}
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
                  <GeneratedText id="m_0ce705b8fa979c" />
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
          <Label htmlFor="ps-desc">
            <GeneratedText id="m_14d923495cf14c" /> <span className="text-red-600">*</span>
          </Label>
          <Textarea
            id="ps-desc"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={4}
            placeholder={tGenerated('m_033045403e59dd')}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ps-owner">
              <GeneratedText id="m_09e0cae12d3f44" />
            </Label>
            <RemoteSearchSelect
              lookup="incident-people"
              value={ownerPersonId}
              onChange={(val) => setOwnerPersonId(val)}
              placeholder={tGenerated('m_0be39d3a196b5b')}
              searchPlaceholder={tGenerated('m_0b842b664b4f3b')}
              sheetTitle="Select a person"
              ariaLabel="Owner"
              clearable
              emptyLabel={tGenerated('m_1ba9b3d94af564')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ps-due">
              <GeneratedText id="m_17d68c4d547fb5" />
            </Label>
            <Input
              id="ps-due"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ps-status">
              <GeneratedText id="m_0b9da892d6faf0" /> <span className="text-red-600">*</span>
            </Label>
            <Select
              id="ps-status"
              value={status}
              onChange={(e) => setStatus(e.currentTarget.value as PrevStepStatus)}
            >
              <GeneratedValue
                value={PREV_STEP_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    <GeneratedValue value={s.replace(/_/g, ' ')} />
                  </option>
                ))}
              />
            </Select>
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

// ---- helpers ---------------------------------------------------------------

function defaultNow(): string {
  // Returns a value suitable for <input type="datetime-local">: YYYY-MM-DDTHH:MM
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}
