'use client'

// Client-side row editors for the Loads / Equipment / Hazards / PPE tabs.
// Each pair (AddXForm + XRow) keeps inline edit state local, then submits a
// FormData to the server action prop. Inline-only state because there's no
// global shape — every row is independent.

import { useState, useTransition } from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2, X } from 'lucide-react'
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
  updateAction,
  deleteAction,
  moveAction,
}: {
  load: LoadView
  liftPlanId: string
  locked: boolean
  updateAction: (formData: FormData) => Promise<void>
  deleteAction: (formData: FormData) => Promise<void>
  moveAction: (formData: FormData) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [pending, start] = useTransition()

  function save(formData: FormData) {
    formData.set('id', load.id)
    formData.set('liftPlanId', liftPlanId)
    start(async () => {
      await updateAction(formData)
      setEditing(false)
    })
  }

  if (editing) {
    return (
      <form
        action={save}
        className="grid grid-cols-1 gap-2 rounded-md border border-teal-200 bg-teal-50/40 p-3 sm:grid-cols-6"
      >
        <Input
          name="description"
          defaultValue={load.description}
          placeholder="Description"
          required
          className="sm:col-span-2"
        />
        <Input
          name="weightKg"
          type="number"
          step="0.01"
          defaultValue={load.weightKg ?? ''}
          placeholder="Weight (kg)"
        />
        <Input
          name="dimensionsMaxMm"
          type="number"
          defaultValue={load.dimensionsMaxMm ?? ''}
          placeholder="Max dim (mm)"
        />
        <Input
          name="attachmentMethod"
          defaultValue={load.attachmentMethod ?? ''}
          placeholder="Attachment method"
        />
        <div className="flex items-center justify-end gap-1">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? '…' : 'Save'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            <X size={12} />
          </Button>
        </div>
      </form>
    )
  }
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
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={12} />
            </Button>
            <DeleteBtn id={load.id} liftPlanId={liftPlanId} deleteAction={deleteAction} />
          </>
        ) : null}
      </div>
    </div>
  )
}

export function AddLoadForm({
  liftPlanId,
  addAction,
}: {
  liftPlanId: string
  addAction: (formData: FormData) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  function submit(formData: FormData) {
    formData.set('liftPlanId', liftPlanId)
    start(async () => {
      await addAction(formData)
      setOpen(false)
    })
  }
  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus size={12} /> Add load
      </Button>
    )
  return (
    <form
      action={submit}
      className="grid grid-cols-1 gap-2 rounded-md border border-teal-200 bg-teal-50/40 p-3 sm:grid-cols-6"
    >
      <Input
        name="description"
        placeholder="Description"
        required
        className="sm:col-span-2"
      />
      <Input name="weightKg" type="number" step="0.01" placeholder="Weight (kg)" />
      <Input name="dimensionsMaxMm" type="number" placeholder="Max dim (mm)" />
      <Input name="attachmentMethod" placeholder="Attachment method" />
      <div className="flex items-center justify-end gap-1">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? '…' : 'Add'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          <X size={12} />
        </Button>
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
  equipmentItems,
  updateAction,
  deleteAction,
  moveAction,
}: {
  row: EquipmentView
  liftPlanId: string
  locked: boolean
  equipmentItems: EquipmentItemForPicker[]
  updateAction: (formData: FormData) => Promise<void>
  deleteAction: (formData: FormData) => Promise<void>
  moveAction: (formData: FormData) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [pending, start] = useTransition()

  function save(formData: FormData) {
    formData.set('id', row.id)
    formData.set('liftPlanId', liftPlanId)
    start(async () => {
      await updateAction(formData)
      setEditing(false)
    })
  }

  if (editing) {
    return (
      <form
        action={save}
        className="grid grid-cols-1 gap-2 rounded-md border border-teal-200 bg-teal-50/40 p-3 sm:grid-cols-7"
      >
        <div className="sm:col-span-2">
          <Select name="equipmentItemId" defaultValue={row.equipmentItemId ?? ''}>
            <option value="">— Free-text description —</option>
            {equipmentItems.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name} ({it.assetTag})
              </option>
            ))}
          </Select>
          <Input
            name="equipmentDescription"
            defaultValue={row.equipmentDescription ?? ''}
            placeholder="Description (rental, subcontractor crane, etc.)"
            className="mt-1.5"
          />
        </div>
        <Input
          name="capacityKg"
          type="number"
          step="0.01"
          defaultValue={row.capacityKg ?? ''}
          placeholder="Capacity (kg)"
        />
        <Input
          name="boomLengthM"
          type="number"
          step="0.01"
          defaultValue={row.boomLengthM ?? ''}
          placeholder="Boom (m)"
        />
        <Input
          name="radiusM"
          type="number"
          step="0.01"
          defaultValue={row.radiusM ?? ''}
          placeholder="Radius (m)"
        />
        <div className="text-xs text-slate-500">Auto: capacity used %</div>
        <div className="flex items-center justify-end gap-1">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? '…' : 'Save'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            <X size={12} />
          </Button>
        </div>
      </form>
    )
  }

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
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={12} />
            </Button>
            <DeleteBtn id={row.id} liftPlanId={liftPlanId} deleteAction={deleteAction} />
          </>
        ) : null}
      </div>
    </div>
  )
}

export function AddEquipmentForm({
  liftPlanId,
  equipmentItems,
  addAction,
}: {
  liftPlanId: string
  equipmentItems: EquipmentItemForPicker[]
  addAction: (formData: FormData) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  function submit(formData: FormData) {
    formData.set('liftPlanId', liftPlanId)
    start(async () => {
      await addAction(formData)
      setOpen(false)
    })
  }
  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus size={12} /> Add equipment
      </Button>
    )
  return (
    <form
      action={submit}
      className="grid grid-cols-1 gap-2 rounded-md border border-teal-200 bg-teal-50/40 p-3 sm:grid-cols-7"
    >
      <div className="sm:col-span-2">
        <Select name="equipmentItemId" defaultValue="">
          <option value="">— Free-text description —</option>
          {equipmentItems.map((it) => (
            <option key={it.id} value={it.id}>
              {it.name} ({it.assetTag})
            </option>
          ))}
        </Select>
        <Input
          name="equipmentDescription"
          placeholder="Description (rental, subcontractor crane, etc.)"
          className="mt-1.5"
        />
      </div>
      <Input name="capacityKg" type="number" step="0.01" placeholder="Capacity (kg)" />
      <Input name="boomLengthM" type="number" step="0.01" placeholder="Boom (m)" />
      <Input name="radiusM" type="number" step="0.01" placeholder="Radius (m)" />
      <div className="text-xs text-slate-500">Auto: capacity used %</div>
      <div className="flex items-center justify-end gap-1">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? '…' : 'Add'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          <X size={12} />
        </Button>
      </div>
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
  updateAction,
  deleteAction,
  moveAction,
}: {
  row: HazardView
  liftPlanId: string
  locked: boolean
  updateAction: (formData: FormData) => Promise<void>
  deleteAction: (formData: FormData) => Promise<void>
  moveAction: (formData: FormData) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [pending, start] = useTransition()
  function save(formData: FormData) {
    formData.set('id', row.id)
    formData.set('liftPlanId', liftPlanId)
    start(async () => {
      await updateAction(formData)
      setEditing(false)
    })
  }
  if (editing) {
    return (
      <form
        action={save}
        className="grid grid-cols-1 gap-2 rounded-md border border-teal-200 bg-teal-50/40 p-3 sm:grid-cols-5"
      >
        <Input
          name="hazardDescription"
          defaultValue={row.hazardDescription}
          required
          placeholder="Hazard"
          className="sm:col-span-2"
        />
        <Input
          name="controls"
          defaultValue={row.controls ?? ''}
          placeholder="Controls in place"
          className="sm:col-span-2"
        />
        <div className="flex items-center justify-end gap-1">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? '…' : 'Save'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            <X size={12} />
          </Button>
        </div>
      </form>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-slate-100 py-2 text-sm sm:grid-cols-5">
      <div className="font-medium sm:col-span-2">{row.hazardDescription}</div>
      <div className="text-slate-600 sm:col-span-2">{row.controls ?? '—'}</div>
      <div className="flex items-center justify-end gap-1">
        {!locked ? (
          <>
            <MoveBtns id={row.id} liftPlanId={liftPlanId} moveAction={moveAction} />
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={12} />
            </Button>
            <DeleteBtn id={row.id} liftPlanId={liftPlanId} deleteAction={deleteAction} />
          </>
        ) : null}
      </div>
    </div>
  )
}

export function AddHazardForm({
  liftPlanId,
  addAction,
}: {
  liftPlanId: string
  addAction: (formData: FormData) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  function submit(formData: FormData) {
    formData.set('liftPlanId', liftPlanId)
    start(async () => {
      await addAction(formData)
      setOpen(false)
    })
  }
  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus size={12} /> Add hazard
      </Button>
    )
  return (
    <form
      action={submit}
      className="grid grid-cols-1 gap-2 rounded-md border border-teal-200 bg-teal-50/40 p-3 sm:grid-cols-5"
    >
      <Input
        name="hazardDescription"
        placeholder="Hazard (e.g. overhead power lines)"
        required
        className="sm:col-span-2"
      />
      <Input name="controls" placeholder="Controls in place" className="sm:col-span-2" />
      <div className="flex items-center justify-end gap-1">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? '…' : 'Add'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          <X size={12} />
        </Button>
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
  updateAction,
  deleteAction,
  moveAction,
}: {
  row: PpeView
  liftPlanId: string
  locked: boolean
  updateAction: (formData: FormData) => Promise<void>
  deleteAction: (formData: FormData) => Promise<void>
  moveAction: (formData: FormData) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [pending, start] = useTransition()
  function save(formData: FormData) {
    formData.set('id', row.id)
    formData.set('liftPlanId', liftPlanId)
    start(async () => {
      await updateAction(formData)
      setEditing(false)
    })
  }
  if (editing) {
    return (
      <form
        action={save}
        className="grid grid-cols-1 gap-2 rounded-md border border-teal-200 bg-teal-50/40 p-3 sm:grid-cols-4"
      >
        <Input
          name="ppeName"
          defaultValue={row.ppeName}
          required
          placeholder="PPE name"
          className="sm:col-span-2"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="required" defaultChecked={row.required} /> Required
        </label>
        <div className="flex items-center justify-end gap-1">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? '…' : 'Save'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            <X size={12} />
          </Button>
        </div>
      </form>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-slate-100 py-2 text-sm sm:grid-cols-4">
      <div className="font-medium sm:col-span-2">{row.ppeName}</div>
      <div className="text-slate-600">{row.required ? 'Required' : 'Optional'}</div>
      <div className="flex items-center justify-end gap-1">
        {!locked ? (
          <>
            <MoveBtns id={row.id} liftPlanId={liftPlanId} moveAction={moveAction} />
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={12} />
            </Button>
            <DeleteBtn id={row.id} liftPlanId={liftPlanId} deleteAction={deleteAction} />
          </>
        ) : null}
      </div>
    </div>
  )
}

export function AddPpeForm({
  liftPlanId,
  addAction,
}: {
  liftPlanId: string
  addAction: (formData: FormData) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  function submit(formData: FormData) {
    formData.set('liftPlanId', liftPlanId)
    start(async () => {
      await addAction(formData)
      setOpen(false)
    })
  }
  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus size={12} /> Add PPE
      </Button>
    )
  return (
    <form
      action={submit}
      className="grid grid-cols-1 gap-2 rounded-md border border-teal-200 bg-teal-50/40 p-3 sm:grid-cols-4"
    >
      <Input
        name="ppeName"
        placeholder="PPE name (e.g. Hard hat)"
        required
        className="sm:col-span-2"
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="required" defaultChecked /> Required
      </label>
      <div className="flex items-center justify-end gap-1">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? '…' : 'Add'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          <X size={12} />
        </Button>
      </div>
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
          <X size={12} />
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
