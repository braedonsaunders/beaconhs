'use client'

// Sub-entity drawer for the inspection types list page:
//   • new-type → create a new inspection type shell
//
// Opens via `?drawer=new-type` so it survives refresh + is link-shareable.
// The server action is passed in from the RSC list page.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Label,
  Select,
  Textarea,
  UrlDrawer,
} from '@beaconhs/ui'

const CADENCES = [
  { value: '', label: '— No default —' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'year', label: 'Yearly' },
]

type CreateTypeAction = (input: {
  name: string
  description: string | null
  requiresForeman: boolean
  requiresCustomerSignature: boolean
  enableCorrectiveActions: boolean
  allowCompliantNotes: boolean
  isPublished: boolean
  defaultCadence: string | null
}) => Promise<{ ok: true; id: string } | { ok: false; error: string }>

export function InspectionTypesDrawers({
  openDrawer,
  closeHref,
  createTypeAction,
}: {
  openDrawer: 'new-type' | null
  closeHref: string
  createTypeAction: CreateTypeAction
}) {
  return (
    <NewTypeDrawer
      open={openDrawer === 'new-type'}
      closeHref={closeHref}
      action={createTypeAction}
    />
  )
}

function NewTypeDrawer({
  open,
  closeHref,
  action,
}: {
  open: boolean
  closeHref: string
  action: CreateTypeAction
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [defaultCadence, setDefaultCadence] = useState('')
  const [requiresForeman, setRequiresForeman] = useState(false)
  const [requiresCustomerSignature, setRequiresCustomerSignature] = useState(false)
  const [enableCorrectiveActions, setEnableCorrectiveActions] = useState(true)
  const [allowCompliantNotes, setAllowCompliantNotes] = useState(true)
  const [isPublished, setIsPublished] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required.')
      return
    }
    startTransition(async () => {
      const res = await action({
        name: trimmed,
        description: description.trim() || null,
        defaultCadence: defaultCadence.trim() || null,
        requiresForeman,
        requiresCustomerSignature,
        enableCorrectiveActions,
        allowCompliantNotes,
        isPublished,
      })
      if (res.ok) {
        router.push(`/inspections/types/${res.id}?tab=banks`)
        router.refresh()
      } else {
        setError(res.error || 'Failed to create inspection type')
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="New inspection type"
      description="Create the shell here, then link criteria banks on the detail page that opens after save."
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
            Create type
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Alert variant="info">
          <AlertTitle>Two-step</AlertTitle>
          <AlertDescription>
            Create the shell here, then link the criteria banks (your question pool) on the detail
            page that opens after save.
          </AlertDescription>
        </Alert>

        <div className="space-y-1.5">
          <Label htmlFor="it-name">Name *</Label>
          <Input
            id="it-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="e.g. Site Daily Walk-Through"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="it-description">Description</Label>
          <Textarea
            id="it-description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={3}
            placeholder="When to use this type, who it's for"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="it-cadence">Default cadence (hint for assignments)</Label>
            <Select
              id="it-cadence"
              value={defaultCadence}
              onChange={(e) => setDefaultCadence(e.currentTarget.value)}
            >
              {CADENCES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2 pt-7 text-sm">
            <Toggle
              checked={requiresForeman}
              onChange={setRequiresForeman}
              label="Requires foreman"
            />
            <Toggle
              checked={requiresCustomerSignature}
              onChange={setRequiresCustomerSignature}
              label="Requires customer signature"
            />
            <Toggle
              checked={enableCorrectiveActions}
              onChange={setEnableCorrectiveActions}
              label="Auto-spawn corrective actions on fail (severity >= high)"
            />
            <Toggle
              checked={allowCompliantNotes}
              onChange={setAllowCompliantNotes}
              label="Allow compliant notes (per-criterion comments)"
            />
            <Toggle
              checked={isPublished}
              onChange={setIsPublished}
              label="Publish immediately"
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

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
      />
      <span>{label}</span>
    </label>
  )
}
