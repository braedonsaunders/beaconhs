'use client'

// List-page flyouts for equipment inspection types:
//   • new-type → create flyout (UrlDrawer, opens via ?drawer=new, link-shareable)
//   • DeleteTypeButton → per-row delete guarded by an "are you sure" confirm
//
// Criteria are edited from the type's detail page — the row name links there, so
// no per-row "criteria" button.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import { Button, Drawer, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'
import { createEquipmentInspectionType, deleteEquipmentInspectionType } from './_actions'

const INTERVAL_OPTIONS = [
  { value: 'pre_use', label: 'Pre-use' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
  { value: 'five_year', label: 'Every 5 years' },
  { value: 'on_demand', label: 'On demand' },
]

export function NewTypeDrawer({
  open,
  closeHref,
  types,
}: {
  open: boolean
  closeHref: string
  types: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [appliesToTypeId, setAppliesToTypeId] = useState('')
  const [intervalValue, setIntervalValue] = useState('on_demand')
  const [description, setDescription] = useState('')
  const [allowPassAll, setAllowPassAll] = useState(true)
  const [failsSpawnWorkOrders, setFailsSpawnWorkOrders] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required.')
      return
    }
    start(async () => {
      const res = await createEquipmentInspectionType({
        name: trimmed,
        description: description.trim() || null,
        interval: intervalValue,
        appliesToTypeId: appliesToTypeId || null,
        allowPassAll,
        failsSpawnWorkOrders,
      })
      if (res.ok) {
        router.push(`/equipment/inspection-types/${res.id}`)
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
      description="A pass/fail checklist for equipment. Add criteria from its detail page once created."
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
            Create type
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="eit-name">Name *</Label>
          <Input
            id="eit-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="e.g. Pickup truck — Annual safety"
            required
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="eit-applies">Applies to equipment type</Label>
          <Select
            id="eit-applies"
            value={appliesToTypeId}
            onChange={(e) => setAppliesToTypeId(e.currentTarget.value)}
          >
            <option value="">— Any equipment —</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="eit-interval">Interval</Label>
          <Select
            id="eit-interval"
            value={intervalValue}
            onChange={(e) => setIntervalValue(e.currentTarget.value)}
          >
            {INTERVAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="eit-description">Description</Label>
          <Textarea
            id="eit-description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            rows={2}
          />
        </div>
        <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowPassAll}
              onChange={(e) => setAllowPassAll(e.currentTarget.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
            />
            <span>Allow &ldquo;pass all&rdquo; shortcut</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={failsSpawnWorkOrders}
              onChange={(e) => setFailsSpawnWorkOrders(e.currentTarget.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
            />
            <span>Failed criterion auto-creates a work order</span>
          </label>
        </div>

        {error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
            {error}
          </p>
        ) : null}
      </div>
    </UrlDrawer>
  )
}

export function DeleteTypeButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  function confirm() {
    start(async () => {
      await deleteEquipmentInspectionType({ id })
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label={`Delete ${name}`}
      >
        <Trash2 size={12} />
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Delete inspection type"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
              onClick={confirm}
              disabled={pending}
            >
              {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
              Delete
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Delete <span className="font-medium text-slate-900 dark:text-slate-100">{name}</span>?
          Existing inspection records are kept — only the template is removed. This can&rsquo;t be
          undone.
        </p>
      </Drawer>
    </>
  )
}
