'use client'

// "New vehicle log entry" drawer for the equipment item detail page. Opens
// via `?drawer=new-truck-log-entry`. Mirrors the legacy
// /equipment/vehicle-log/new route but slides in instead of navigating
// away — the truck is locked to this detail page.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Truck } from 'lucide-react'
import { Button, Input, Label, Textarea, UrlDrawer } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'

type CreateTruckLogInput = {
  equipmentItemId: string
  entryDate: string
  driverPersonId: string
  startOdometer: number | null
  endOdometer: number | null
  siteOrgUnitId: string | null
  hoursOnSite: string | null
  manpowerCount: number | null
  notes: string | null
}

type CreateTruckLogAction = (input: CreateTruckLogInput) => Promise<{ ok: boolean; error?: string }>

function safeInt(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

export function NewTruckLogEntryDrawer({
  open,
  closeHref,
  itemId,
  defaultDate,
  action,
}: {
  open: boolean
  closeHref: string
  itemId: string
  defaultDate: string
  action: CreateTruckLogAction
}) {
  const router = useRouter()
  const [entryDate, setEntryDate] = useState(defaultDate)
  const [driverPersonId, setDriverPersonId] = useState('')
  const [siteOrgUnitId, setSiteOrgUnitId] = useState('')
  const [startOdometer, setStartOdometer] = useState('')
  const [endOdometer, setEndOdometer] = useState('')
  const [hoursOnSite, setHoursOnSite] = useState('')
  const [manpowerCount, setManpowerCount] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    if (!entryDate.trim()) {
      setError('Date is required.')
      return
    }
    if (!driverPersonId) {
      setError('Driver is required.')
      return
    }
    startTransition(async () => {
      const res = await action({
        equipmentItemId: itemId,
        entryDate: entryDate.trim(),
        driverPersonId,
        startOdometer: safeInt(startOdometer),
        endOdometer: safeInt(endOdometer),
        siteOrgUnitId: siteOrgUnitId || null,
        hoursOnSite: hoursOnSite.trim() || null,
        manpowerCount: safeInt(manpowerCount),
        notes: notes.trim() || null,
      })
      if (res.ok) {
        router.push(closeHref)
        router.refresh()
      } else {
        setError(res.error ?? 'Failed to save entry')
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="New vehicle log entry"
      description="One row per truck per day. Odometer in/out drives kilometres for billing."
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
            {pending ? (
              <Loader2 size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Truck size={14} className="mr-1.5" />
            )}
            Save entry
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tl-date">
              Date <span className="text-red-600">*</span>
            </Label>
            <Input
              id="tl-date"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tl-driver">
              Driver <span className="text-red-600">*</span>
            </Label>
            <RemoteSearchSelect
              id="tl-driver"
              lookup="vehicle-drivers"
              value={driverPersonId}
              onChange={setDriverPersonId}
              placeholder="Select a driver…"
              searchPlaceholder="Search active drivers…"
              sheetTitle="Select driver"
              clearable={false}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="tl-site">Customer / site</Label>
            <RemoteSearchSelect
              id="tl-site"
              lookup="vehicle-customers"
              value={siteOrgUnitId}
              onChange={setSiteOrgUnitId}
              placeholder="Select a customer…"
              searchPlaceholder="Search customers…"
              sheetTitle="Select customer"
              clearable
              emptyLabel="— None —"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tl-start">Start odometer (km)</Label>
            <Input
              id="tl-start"
              type="number"
              min="0"
              max="2147483647"
              step="1"
              value={startOdometer}
              onChange={(e) => setStartOdometer(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tl-end">End odometer (km)</Label>
            <Input
              id="tl-end"
              type="number"
              min="0"
              max="2147483647"
              step="1"
              value={endOdometer}
              onChange={(e) => setEndOdometer(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tl-hours">Hours on site</Label>
            <Input
              id="tl-hours"
              type="number"
              min="0"
              max="24"
              step="0.25"
              placeholder="e.g. 8.5"
              value={hoursOnSite}
              onChange={(e) => setHoursOnSite(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tl-manpower">Crew count</Label>
            <Input
              id="tl-manpower"
              type="number"
              min="0"
              max="100000"
              step="1"
              value={manpowerCount}
              onChange={(e) => setManpowerCount(e.currentTarget.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tl-notes">Notes</Label>
          <Textarea
            id="tl-notes"
            rows={3}
            maxLength={5000}
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            placeholder="Anything noteworthy for billing or maintenance."
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
