'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
    setError(tGeneratedValue(null))
    if (!entryDate.trim()) {
      setError(tGenerated('m_145c3f0206f0ed'))
      return
    }
    if (!driverPersonId) {
      setError(tGenerated('m_0ea3b9ea8acb32'))
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
        setError(tGeneratedValue(res.error ?? tGenerated('m_1cf94f9be0a07e')))
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGenerated('m_1a9195530e3b90')}
      description={tGenerated('m_0228cd09987995')}
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
              value={
                pending ? (
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                ) : (
                  <Truck size={14} className="mr-1.5" />
                )
              }
            />
            <GeneratedText id="m_0df68f8978fe0a" />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tl-date">
              <GeneratedText id="m_0285c38761c540" /> <span className="text-red-600">*</span>
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
              <GeneratedText id="m_00385063252603" /> <span className="text-red-600">*</span>
            </Label>
            <RemoteSearchSelect
              id="tl-driver"
              lookup="vehicle-drivers"
              value={driverPersonId}
              onChange={setDriverPersonId}
              placeholder={tGenerated('m_16234056fc2934')}
              searchPlaceholder={tGenerated('m_1c51de60730f68')}
              sheetTitle="Select driver"
              clearable={false}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="tl-site">
              <GeneratedText id="m_09ec32e549824e" />
            </Label>
            <RemoteSearchSelect
              id="tl-site"
              lookup="vehicle-customers"
              value={siteOrgUnitId}
              onChange={setSiteOrgUnitId}
              placeholder={tGenerated('m_0be0f471b00114')}
              searchPlaceholder={tGenerated('m_134f17a2074f34')}
              sheetTitle="Select customer"
              clearable
              emptyLabel={tGenerated('m_0dd5f8a31ce3e1')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tl-start">
              <GeneratedText id="m_0cec84fec3b16f" />
            </Label>
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
            <Label htmlFor="tl-end">
              <GeneratedText id="m_14beb2fa6adb50" />
            </Label>
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
            <Label htmlFor="tl-hours">
              <GeneratedText id="m_0c5fdf4fb3e86b" />
            </Label>
            <Input
              id="tl-hours"
              type="number"
              min="0"
              max="24"
              step="0.25"
              placeholder={tGenerated('m_0d366c65426260')}
              value={hoursOnSite}
              onChange={(e) => setHoursOnSite(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tl-manpower">
              <GeneratedText id="m_0b59683e270c38" />
            </Label>
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
          <Label htmlFor="tl-notes">
            <GeneratedText id="m_0b8dadcb78cd08" />
          </Label>
          <Textarea
            id="tl-notes"
            rows={3}
            maxLength={5000}
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            placeholder={tGenerated('m_13026f52a0faf3')}
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
