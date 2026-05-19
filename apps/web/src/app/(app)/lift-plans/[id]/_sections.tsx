'use client'

// Row renderers + drawer-body widgets for the Loads / Equipment / Hazards /
// PPE tabs.  Inline edit was removed in favour of `?drawer=edit-*&*Id=…` so
// the parent page is now in charge of rendering the drawer + Submit footer.
// Each Body widget here is the form that goes *inside* the drawer; the
// parent's footer Submit button targets it via `form={formId}`.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react'
import { Button, Input, Label, Select } from '@beaconhs/ui'
import type { EquipmentItemForPicker } from '../_types'

// ----- Loads -------------------------------------------------------------
export type LoadView = {
  id: string
  description: string
  weightKg: string | null
  dimensionsMaxMm: number | null
  attachmentMethod: string | null
}

export function LoadRow({
  load,
  liftPlanId,
  locked,
  deleteAction,
  moveAction,
}: {
  load: LoadView
  liftPlanId: string
  locked: boolean
  deleteAction: (formData: FormData) => Promise<void>
  moveAction: (formData: FormData) => Promise<void>
}) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-slate-100 py-2 text-sm sm:grid-cols-6">
      <div className="font-medium sm:col-span-2">{load.description}</div>
      <div className="text-slate-600">{load.weightKg ? `${load.weightKg} kg` : '—'}</div>
      <div className="text-slate-600">
        {load.dimensionsMaxMm ? `${load.dimensionsMaxMm} mm` : '—'}
      </div>
      <div className="text-slate-600">{load.attachmentMethod ?? '—'}</div>
      <div className="flex items-center justify-end gap-1">
        {!locked ? (
          <>
            <MoveBtns id={load.id} liftPlanId={liftPlanId} moveAction={moveAction} />
            <Link
              href={`/lift-plans/${liftPlanId}?tab=loads&drawer=edit-load&loadId=${load.id}`}
            >
              <Button variant="ghost" size="sm">
                <Pencil size={12} />
              </Button>
            </Link>
            <DeleteBtn id={load.id} liftPlanId={liftPlanId} deleteAction={deleteAction} />
          </>
        ) : null}
      </div>
    </div>
  )
}

export function LoadBody({
  formId,
  liftPlanId,
  load,
  action,
  closeHref,
}: {
  formId: string
  liftPlanId: string
  load?: LoadView
  action: (formData: FormData) => Promise<void>
  closeHref: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  function handle(formData: FormData) {
    formData.set('liftPlanId', liftPlanId)
    if (load) formData.set('id', load.id)
    start(async () => {
      await action(formData)
      router.push(closeHref as any)
      router.refresh()
    })
  }
  return (
    <form id={formId} action={handle} className="space-y-3">
      <div className="space-y-1.5">
        <Label>Description *</Label>
        <Input
          name="description"
          defaultValue={load?.description ?? ''}
          required
          placeholder="Description"
          disabled={pending}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Weight (kg)</Label>
          <Input
            name="weightKg"
            type="number"
            step="0.01"
            defaultValue={load?.weightKg ?? ''}
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Max dimension (mm)</Label>
          <Input
            name="dimensionsMaxMm"
            type="number"
            defaultValue={load?.dimensionsMaxMm ?? ''}
            disabled={pending}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Attachment method</Label>
        <Input
          name="attachmentMethod"
          defaultValue={load?.attachmentMethod ?? ''}
          placeholder="e.g. shackles, slings, basket hitch"
          disabled={pending}
        />
      </div>
    </form>
  )
}

// ----- Equipment ---------------------------------------------------------
export type EquipmentView = {
  id: string
  equipmentItemId: string | null
  equipmentDescription: string | null
  capacityKg: string | null
  boomLengthM: string | null
  radiusM: string | null
  capacityUsedPct: string | null
  itemName?: string | null
}

export function EquipmentRow({
  row,
  liftPlanId,
  locked,
  deleteAction,
  moveAction,
}: {
  row: EquipmentView
  liftPlanId: string
  locked: boolean
  deleteAction: (formData: FormData) => Promise<void>
  moveAction: (formData: FormData) => Promise<void>
}) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-slate-100 py-2 text-sm sm:grid-cols-7">
      <div className="font-medium sm:col-span-2">
        {row.itemName ?? row.equipmentDescription ?? '—'}
      </div>
      <div className="text-slate-600">{row.capacityKg ? `${row.capacityKg} kg` : '—'}</div>
      <div className="text-slate-600">{row.boomLengthM ? `${row.boomLengthM} m` : '—'}</div>
      <div className="text-slate-600">{row.radiusM ? `${row.radiusM} m` : '—'}</div>
      <div className="text-slate-600">{row.capacityUsedPct ? `${row.capacityUsedPct}%` : '—'}</div>
      <div className="flex items-center justify-end gap-1">
        {!locked ? (
          <>
            <MoveBtns id={row.id} liftPlanId={liftPlanId} moveAction={moveAction} />
            <Link
              href={`/lift-plans/${liftPlanId}?tab=equipment&drawer=edit-equipment&equipmentId=${row.id}`}
            >
              <Button variant="ghost" size="sm">
                <Pencil size={12} />
              </Button>
            </Link>
            <DeleteBtn id={row.id} liftPlanId={liftPlanId} deleteAction={deleteAction} />
          </>
        ) : null}
      </div>
    </div>
  )
}

export function EquipmentBody({
  formId,
  liftPlanId,
  row,
  equipmentItems,
  action,
  closeHref,
}: {
  formId: string
  liftPlanId: string
  row?: EquipmentView
  equipmentItems: EquipmentItemForPicker[]
  action: (formData: FormData) => Promise<void>
  closeHref: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  function handle(formData: FormData) {
    formData.set('liftPlanId', liftPlanId)
    if (row) formData.set('id', row.id)
    start(async () => {
      await action(formData)
      router.push(closeHref as any)
      router.refresh()
    })
  }
  return (
    <form id={formId} action={handle} className="space-y-3">
      <div className="space-y-1.5">
        <Label>Tracked item</Label>
        <Select
          name="equipmentItemId"
          defaultValue={row?.equipmentItemId ?? ''}
          disabled={pending}
        >
          <option value="">— Free-text description —</option>
          {equipmentItems.map((it) => (
            <option key={it.id} value={it.id}>
              {it.name} ({it.assetTag})
            </option>
          ))}
        </Select>
        <p className="text-xs text-slate-500">
          Pick a tracked asset or leave blank and use the description below for rentals
          / subcontractor equipment.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>Description</Label>
        <Input
          name="equipmentDescription"
          defaultValue={row?.equipmentDescription ?? ''}
          placeholder="Description (rental, subcontractor crane, etc.)"
          disabled={pending}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Capacity (kg)</Label>
          <Input
            name="capacityKg"
            type="number"
            step="0.01"
            defaultValue={row?.capacityKg ?? ''}
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Boom (m)</Label>
          <Input
            name="boomLengthM"
            type="number"
            step="0.01"
            defaultValue={row?.boomLengthM ?? ''}
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Radius (m)</Label>
          <Input
            name="radiusM"
            type="number"
            step="0.01"
            defaultValue={row?.radiusM ?? ''}
            disabled={pending}
          />
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Capacity-used % is auto-computed from total load weight.
      </p>
    </form>
  )
}

// ----- Hazards -----------------------------------------------------------
export type HazardView = {
  id: string
  hazardDescription: string
  controls: string | null
}

export function HazardRow({
  row,
  liftPlanId,
  locked,
  deleteAction,
  moveAction,
}: {
  row: HazardView
  liftPlanId: string
  locked: boolean
  deleteAction: (formData: FormData) => Promise<void>
  moveAction: (formData: FormData) => Promise<void>
}) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-slate-100 py-2 text-sm sm:grid-cols-5">
      <div className="font-medium sm:col-span-2">{row.hazardDescription}</div>
      <div className="text-slate-600 sm:col-span-2">{row.controls ?? '—'}</div>
      <div className="flex items-center justify-end gap-1">
        {!locked ? (
          <>
            <MoveBtns id={row.id} liftPlanId={liftPlanId} moveAction={moveAction} />
            <Link
              href={`/lift-plans/${liftPlanId}?tab=hazards&drawer=edit-hazard&hazardId=${row.id}`}
            >
              <Button variant="ghost" size="sm">
                <Pencil size={12} />
              </Button>
            </Link>
            <DeleteBtn id={row.id} liftPlanId={liftPlanId} deleteAction={deleteAction} />
          </>
        ) : null}
      </div>
    </div>
  )
}

export function HazardBody({
  formId,
  liftPlanId,
  row,
  action,
  closeHref,
}: {
  formId: string
  liftPlanId: string
  row?: HazardView
  action: (formData: FormData) => Promise<void>
  closeHref: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  function handle(formData: FormData) {
    formData.set('liftPlanId', liftPlanId)
    if (row) formData.set('id', row.id)
    start(async () => {
      await action(formData)
      router.push(closeHref as any)
      router.refresh()
    })
  }
  return (
    <form id={formId} action={handle} className="space-y-3">
      <div className="space-y-1.5">
        <Label>Hazard *</Label>
        <Input
          name="hazardDescription"
          defaultValue={row?.hazardDescription ?? ''}
          required
          placeholder="e.g. overhead power lines"
          disabled={pending}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Controls</Label>
        <Input
          name="controls"
          defaultValue={row?.controls ?? ''}
          placeholder="Controls in place"
          disabled={pending}
        />
      </div>
    </form>
  )
}

// ----- PPE ---------------------------------------------------------------
export type PpeView = { id: string; ppeName: string; required: boolean }

export function PpeRow({
  row,
  liftPlanId,
  locked,
  deleteAction,
  moveAction,
}: {
  row: PpeView
  liftPlanId: string
  locked: boolean
  deleteAction: (formData: FormData) => Promise<void>
  moveAction: (formData: FormData) => Promise<void>
}) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-slate-100 py-2 text-sm sm:grid-cols-4">
      <div className="font-medium sm:col-span-2">{row.ppeName}</div>
      <div className="text-slate-600">{row.required ? 'Required' : 'Optional'}</div>
      <div className="flex items-center justify-end gap-1">
        {!locked ? (
          <>
            <MoveBtns id={row.id} liftPlanId={liftPlanId} moveAction={moveAction} />
            <DeleteBtn id={row.id} liftPlanId={liftPlanId} deleteAction={deleteAction} />
          </>
        ) : null}
      </div>
    </div>
  )
}

export function PpeBody({
  formId,
  liftPlanId,
  action,
  closeHref,
}: {
  formId: string
  liftPlanId: string
  action: (formData: FormData) => Promise<void>
  closeHref: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  function handle(formData: FormData) {
    formData.set('liftPlanId', liftPlanId)
    start(async () => {
      await action(formData)
      router.push(closeHref as any)
      router.refresh()
    })
  }
  return (
    <form id={formId} action={handle} className="space-y-3">
      <div className="space-y-1.5">
        <Label>PPE name *</Label>
        <Input
          name="ppeName"
          required
          placeholder="e.g. Hard hat"
          disabled={pending}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="required" defaultChecked /> Required
      </label>
    </form>
  )
}

// ----- Photo caption editor (inline) ------------------------------------
export function PhotoCaptionForm({
  photoId,
  liftPlanId,
  caption,
  locked,
  updateAction,
  deleteAction,
}: {
  photoId: string
  liftPlanId: string
  caption: string | null
  locked: boolean
  updateAction: (formData: FormData) => Promise<void>
  deleteAction: (formData: FormData) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [pending, start] = useTransition()
  function save(formData: FormData) {
    formData.set('id', photoId)
    formData.set('liftPlanId', liftPlanId)
    start(async () => {
      await updateAction(formData)
      setEditing(false)
    })
  }
  if (locked) {
    return caption ? <div className="text-[11px] text-slate-600">{caption}</div> : null
  }
  if (editing) {
    return (
      <form action={save} className="flex items-center gap-1">
        <Input name="caption" defaultValue={caption ?? ''} className="h-7 text-xs" />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? '…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
          <Trash2 size={12} />
        </Button>
      </form>
    )
  }
  return (
    <div className="flex items-center justify-between gap-1 text-[11px]">
      <span className="truncate text-slate-600">{caption ?? <em>No caption</em>}</span>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <Pencil size={10} />
        </Button>
        <DeleteBtn id={photoId} liftPlanId={liftPlanId} deleteAction={deleteAction} />
      </div>
    </div>
  )
}

// ----- Tiny shared building blocks --------------------------------------
function MoveBtns({
  id,
  liftPlanId,
  moveAction,
}: {
  id: string
  liftPlanId: string
  moveAction: (formData: FormData) => Promise<void>
}) {
  const [pending, start] = useTransition()
  function move(direction: 'up' | 'down') {
    const fd = new FormData()
    fd.set('id', id)
    fd.set('liftPlanId', liftPlanId)
    fd.set('direction', direction)
    start(async () => {
      await moveAction(fd)
    })
  }
  return (
    <>
      <Button variant="ghost" size="sm" type="button" disabled={pending} onClick={() => move('up')}>
        <ChevronUp size={12} />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        disabled={pending}
        onClick={() => move('down')}
      >
        <ChevronDown size={12} />
      </Button>
    </>
  )
}

function DeleteBtn({
  id,
  liftPlanId,
  deleteAction,
}: {
  id: string
  liftPlanId: string
  deleteAction: (formData: FormData) => Promise<void>
}) {
  const [pending, start] = useTransition()
  function go() {
    if (!confirm('Delete this row?')) return
    const fd = new FormData()
    fd.set('id', id)
    fd.set('liftPlanId', liftPlanId)
    start(async () => {
      await deleteAction(fd)
    })
  }
  return (
    <Button variant="ghost" size="sm" type="button" disabled={pending} onClick={go}>
      <Trash2 size={12} className="text-red-500" />
    </Button>
  )
}
