'use client'

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
import { Button, Input, Label, SearchSelect, Select, Textarea, UrlDrawer } from '@beaconhs/ui'

// ---- Event timeline --------------------------------------------------------

export type EventInput = {
  id?: string
  incidentId: string
  occurredAt: string // ISO datetime-local value
  description: string
}

export type EventAction = (input: EventInput) => Promise<{ ok: boolean; error?: string }>

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
  const router = useRouter()
  const [occurredAt, setOccurredAt] = useState(defaults?.occurredAt ?? defaultNow())
  const [description, setDescription] = useState(defaults?.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    if (!description.trim()) {
      setError('Description is required.')
      return
    }
    if (!occurredAt.trim()) {
      setError('Timestamp is required.')
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
        setError(res.error ?? 'Failed to save event.')
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={mode === 'create' ? 'Add timeline event' : 'Edit timeline event'}
      description="Chronological log of what happened, in the order it happened."
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
            {mode === 'create' ? 'Add event' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ev-occurred">
            When <span className="text-red-600">*</span>
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
            What happened <span className="text-red-600">*</span>
          </Label>
          <Textarea
            id="ev-desc"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={5}
            placeholder="e.g. 14:32 — Operator radioed in that the conveyor had stopped."
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

export type FactorInput = {
  id?: string
  incidentId: string
  category: FactorCategory
  description: string
}

export type FactorAction = (input: FactorInput) => Promise<{ ok: boolean; error?: string }>

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
  const router = useRouter()
  const [category, setCategory] = useState<FactorCategory>(defaults?.category ?? 'equipment')
  const [description, setDescription] = useState(defaults?.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    if (!description.trim()) {
      setError('Description is required.')
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
        setError(res.error ?? 'Failed to save factor.')
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={mode === 'create' ? 'Add contributing factor' : 'Edit contributing factor'}
      description="Immediate causes / contributing factors, grouped by category."
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
            {mode === 'create' ? 'Add factor' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fac-cat">
            Category <span className="text-red-600">*</span>
          </Label>
          <Select
            id="fac-cat"
            value={category}
            onChange={(e) => setCategory(e.currentTarget.value as FactorCategory)}
          >
            {FACTOR_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fac-desc">
            Description <span className="text-red-600">*</span>
          </Label>
          <Textarea
            id="fac-desc"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={4}
            placeholder="e.g. Worn brake pads not flagged in the last pre-trip inspection."
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

// ---- Root cause why --------------------------------------------------------

export type WhyInput = {
  id?: string
  incidentId: string
  ordinal: number
  whyText: string
}

export type WhyAction = (input: WhyInput) => Promise<{ ok: boolean; error?: string }>

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
  const router = useRouter()
  const [ordinal, setOrdinal] = useState<number>(defaults?.ordinal ?? nextOrdinal)
  const [whyText, setWhyText] = useState(defaults?.whyText ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    if (!whyText.trim()) {
      setError('Why text is required.')
      return
    }
    if (ordinal < 1 || ordinal > 5) {
      setError('Ordinal must be between 1 and 5.')
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
        setError(res.error ?? 'Failed to save why step.')
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={mode === 'create' ? 'Add "why" step' : 'Edit "why" step'}
      description={`5-whys helper: keep asking "why" until the root cause emerges. Limit 5 steps.`}
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
            {mode === 'create' ? 'Add step' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="why-ord">
            Step # <span className="text-red-600">*</span>
          </Label>
          <Select
            id="why-ord"
            value={String(ordinal)}
            onChange={(e) => setOrdinal(Number(e.currentTarget.value))}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                Why #{n}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="why-text">
            Why? <span className="text-red-600">*</span>
          </Label>
          <Textarea
            id="why-text"
            value={whyText}
            onChange={(e) => setWhyText(e.currentTarget.value)}
            rows={3}
            placeholder="Answer the next 'why' in the chain."
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

// ---- Preventative step -----------------------------------------------------

export const PREV_STEP_STATUSES = ['planned', 'in_progress', 'completed'] as const
export type PrevStepStatus = (typeof PREV_STEP_STATUSES)[number]

export type PrevStepInput = {
  id?: string
  incidentId: string
  description: string
  ownerPersonId: string | null
  targetDate: string | null
  status: PrevStepStatus
}

export type PrevStepAction = (input: PrevStepInput) => Promise<{ ok: boolean; error?: string }>

type Person = { id: string; firstName: string; lastName: string; employeeNo?: string | null }

export function PrevStepDrawer({
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
    description: string
    ownerPersonId: string | null
    targetDate: string | null
    status: PrevStepStatus
  }
  action: PrevStepAction
  mode: 'create' | 'edit'
  people: Person[]
}) {
  const router = useRouter()
  const [description, setDescription] = useState(defaults?.description ?? '')
  const [ownerPersonId, setOwnerPersonId] = useState(defaults?.ownerPersonId ?? '')
  const [targetDate, setTargetDate] = useState(defaults?.targetDate ?? '')
  const [status, setStatus] = useState<PrevStepStatus>(defaults?.status ?? 'planned')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    if (!description.trim()) {
      setError('Description is required.')
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
        setError(res.error ?? 'Failed to save preventative step.')
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={mode === 'create' ? 'Add preventative step' : 'Edit preventative step'}
      description="Capture what will be done so this doesn't happen again. Promote to a full CAPA later if needed."
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
            {mode === 'create' ? 'Add step' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ps-desc">
            Description <span className="text-red-600">*</span>
          </Label>
          <Textarea
            id="ps-desc"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={4}
            placeholder="e.g. Add quarterly conveyor-motor inspection to the PM schedule."
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ps-owner">Owner</Label>
            <SearchSelect
              value={ownerPersonId}
              onChange={(val) => setOwnerPersonId(val)}
              options={people.map((p) => ({
                value: p.id,
                label: `${p.lastName}, ${p.firstName}`,
                hint: p.employeeNo ?? undefined,
              }))}
              placeholder="Select a person…"
              searchPlaceholder="Search people…"
              sheetTitle="Select a person"
              ariaLabel="Owner"
              clearable
              emptyLabel="— Unassigned —"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ps-due">Target date</Label>
            <Input
              id="ps-due"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ps-status">
              Status <span className="text-red-600">*</span>
            </Label>
            <Select
              id="ps-status"
              value={status}
              onChange={(e) => setStatus(e.currentTarget.value as PrevStepStatus)}
            >
              {PREV_STEP_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
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

// ---- helpers ---------------------------------------------------------------

function defaultNow(): string {
  // Returns a value suitable for <input type="datetime-local">: YYYY-MM-DDTHH:MM
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}
