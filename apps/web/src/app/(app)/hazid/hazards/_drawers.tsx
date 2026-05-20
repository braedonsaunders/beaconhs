'use client'

// Drawers for the hazard-library list page:
//   • new-hazard   → create a new hazard library entry
//   • edit-hazard  → edit an existing hazard (id taken from ?id=…)
//
// Both open via `?drawer=…` so they survive page refreshes and are
// link-shareable. Server actions are passed in from the RSC page.

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'

type CreateAction = (input: {
  name: string
  hazardTypeId: string | null
  description: string | null
  standardControls: string | null
  risks: string | null
}) => Promise<{ ok: true } | { ok: false; error: string }>

type UpdateAction = (input: {
  id: string
  name: string
  hazardTypeId: string | null
  description: string | null
  standardControls: string | null
  risks: string | null
}) => Promise<{ ok: true } | { ok: false; error: string }>

export type HazardTypeOption = { id: string; name: string }

export type EditHazardDefaults = {
  id: string
  name: string
  hazardTypeId: string | null
  description: string | null
  standardControls: string | null
  risks: string | null
}

export function HazardLibraryDrawers({
  openDrawer,
  closeHref,
  types,
  createAction,
  updateAction,
  editDefaults,
}: {
  openDrawer: 'new-hazard' | 'edit-hazard' | null
  closeHref: string
  types: HazardTypeOption[]
  createAction: CreateAction
  updateAction: UpdateAction
  editDefaults: EditHazardDefaults | null
}) {
  return (
    <>
      <NewHazardDrawer
        open={openDrawer === 'new-hazard'}
        closeHref={closeHref}
        types={types}
        action={createAction}
      />
      <EditHazardDrawer
        open={openDrawer === 'edit-hazard' && !!editDefaults}
        closeHref={closeHref}
        types={types}
        defaults={editDefaults}
        action={updateAction}
      />
    </>
  )
}

// ---- New hazard ------------------------------------------------------------

function NewHazardDrawer({
  open,
  closeHref,
  types,
  action,
}: {
  open: boolean
  closeHref: string
  types: HazardTypeOption[]
  action: CreateAction
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [hazardTypeId, setHazardTypeId] = useState('')
  const [description, setDescription] = useState('')
  const [standardControls, setStandardControls] = useState('')
  const [risks, setRisks] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Reset fields when the drawer closes so the next open is a fresh form
  useEffect(() => {
    if (!open) {
      setName('')
      setHazardTypeId('')
      setDescription('')
      setStandardControls('')
      setRisks('')
      setError(null)
    }
  }, [open])

  function submit() {
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required')
      return
    }
    startTransition(async () => {
      const res = await action({
        name: trimmed,
        hazardTypeId: hazardTypeId || null,
        description: description.trim() || null,
        standardControls: standardControls.trim() || null,
        risks: risks.trim() || null,
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
      title="New hazard"
      description="Add a hazard to the library so crews can pull it into a job-specific assessment."
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
            Create hazard
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="hazard-name">Name *</Label>
          <Input
            id="hazard-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            required
            placeholder="e.g. Pinch point"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hazard-type">Type</Label>
          <Select
            id="hazard-type"
            value={hazardTypeId}
            onChange={(e) => setHazardTypeId(e.currentTarget.value)}
          >
            <option value="">—</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hazard-description">Description</Label>
          <Textarea
            id="hazard-description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={2}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hazard-controls">Standard controls (canonical wording)</Label>
          <Textarea
            id="hazard-controls"
            value={standardControls}
            onChange={(e) => setStandardControls(e.currentTarget.value)}
            rows={4}
            placeholder="What is the default mitigation?"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hazard-risks">Risks (what could go wrong)</Label>
          <Textarea
            id="hazard-risks"
            value={risks}
            onChange={(e) => setRisks(e.currentTarget.value)}
            rows={2}
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

// ---- Edit hazard -----------------------------------------------------------

function EditHazardDrawer({
  open,
  closeHref,
  types,
  defaults,
  action,
}: {
  open: boolean
  closeHref: string
  types: HazardTypeOption[]
  defaults: EditHazardDefaults | null
  action: UpdateAction
}) {
  const router = useRouter()
  const [name, setName] = useState(defaults?.name ?? '')
  const [hazardTypeId, setHazardTypeId] = useState(defaults?.hazardTypeId ?? '')
  const [description, setDescription] = useState(defaults?.description ?? '')
  const [standardControls, setStandardControls] = useState(defaults?.standardControls ?? '')
  const [risks, setRisks] = useState(defaults?.risks ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Re-seed fields when the target hazard changes
  useEffect(() => {
    if (defaults) {
      setName(defaults.name)
      setHazardTypeId(defaults.hazardTypeId ?? '')
      setDescription(defaults.description ?? '')
      setStandardControls(defaults.standardControls ?? '')
      setRisks(defaults.risks ?? '')
      setError(null)
    }
  }, [defaults])

  function submit() {
    if (!defaults) return
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required')
      return
    }
    startTransition(async () => {
      const res = await action({
        id: defaults.id,
        name: trimmed,
        hazardTypeId: hazardTypeId || null,
        description: description.trim() || null,
        standardControls: standardControls.trim() || null,
        risks: risks.trim() || null,
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
      title="Edit hazard"
      description="Update the library entry. Changes affect future assessments only."
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
          <Button type="button" onClick={submit} disabled={pending || !defaults}>
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="edit-hazard-name">Name *</Label>
          <Input
            id="edit-hazard-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-hazard-type">Type</Label>
          <Select
            id="edit-hazard-type"
            value={hazardTypeId}
            onChange={(e) => setHazardTypeId(e.currentTarget.value)}
          >
            <option value="">—</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-hazard-description">Description</Label>
          <Textarea
            id="edit-hazard-description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={2}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-hazard-controls">Standard controls</Label>
          <Textarea
            id="edit-hazard-controls"
            value={standardControls}
            onChange={(e) => setStandardControls(e.currentTarget.value)}
            rows={4}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-hazard-risks">Risks</Label>
          <Textarea
            id="edit-hazard-risks"
            value={risks}
            onChange={(e) => setRisks(e.currentTarget.value)}
            rows={2}
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
