'use client'

// Create / edit an hours-worked period in a right-side flyout. Opened via the
// URL (?drawer=new | ?drawer=<id>) so it survives refresh and is
// link-shareable. The save server action is passed in from the RSC list page.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'

export type HoursEditing = {
  id: string
  periodLabel: string | null
  periodStart: string
  periodEnd: string
  siteOrgUnitId: string | null
  totalHours: string
  employeeCount: number
  notes: string | null
}

type SiteOption = { id: string; name: string }

type SaveAction = (input: {
  id?: string
  periodLabel: string | null
  periodStart: string
  periodEnd: string
  siteOrgUnitId: string | null
  totalHours: number
  employeeCount: number
  notes: string | null
}) => Promise<{ ok: true } | { ok: false; error: string }>

export function HoursDrawer({
  mode,
  editing,
  sites,
  defaults,
  closeHref,
  saveAction,
}: {
  mode: 'new' | 'edit' | null
  editing: HoursEditing | null
  sites: SiteOption[]
  defaults: { label: string; start: string; end: string; today: string }
  closeHref: string
  saveAction: SaveAction
}) {
  const router = useRouter()
  function close() {
    router.push(closeHref)
    router.refresh()
  }
  return (
    <UrlDrawer
      open={mode !== null}
      closeHref={closeHref}
      title={mode === 'edit' ? 'Edit hours period' : 'Add hours period'}
      description="Worked hours and headcount for a window — typically one per site per month. Frequency-rate reports divide into the sum of these."
      size="md"
    >
      <HoursForm
        key={editing?.id ?? 'new'}
        editing={editing}
        sites={sites}
        defaults={defaults}
        saveAction={saveAction}
        onDone={close}
      />
    </UrlDrawer>
  )
}

function HoursForm({
  editing,
  sites,
  defaults,
  saveAction,
  onDone,
}: {
  editing: HoursEditing | null
  sites: SiteOption[]
  defaults: { label: string; start: string; end: string; today: string }
  saveAction: SaveAction
  onDone: () => void
}) {
  const [periodLabel, setPeriodLabel] = useState(editing?.periodLabel ?? defaults.label)
  const [periodStart, setPeriodStart] = useState(editing?.periodStart ?? defaults.start)
  const [periodEnd, setPeriodEnd] = useState(editing?.periodEnd ?? defaults.end)
  const [siteOrgUnitId, setSiteOrgUnitId] = useState(editing?.siteOrgUnitId ?? '')
  const [totalHours, setTotalHours] = useState(editing ? String(Number(editing.totalHours)) : '')
  const [employeeCount, setEmployeeCount] = useState(editing ? String(editing.employeeCount) : '')
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    if (!periodStart || !periodEnd) {
      setError('Start and end dates are required.')
      return
    }
    const hours = Number(totalHours)
    if (!Number.isFinite(hours) || hours <= 0) {
      setError('Total hours must be greater than zero.')
      return
    }
    const employees = parseInt(employeeCount, 10)
    if (!Number.isFinite(employees) || employees <= 0) {
      setError('Employee count must be greater than zero.')
      return
    }
    startTransition(async () => {
      const res = await saveAction({
        id: editing?.id,
        periodLabel: periodLabel.trim() || null,
        periodStart,
        periodEnd,
        siteOrgUnitId: siteOrgUnitId || null,
        totalHours: hours,
        employeeCount: employees,
        notes: notes.trim() || null,
      })
      if (res.ok) onDone()
      else setError(res.error)
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="hr-label">Label</Label>
        <Input
          id="hr-label"
          value={periodLabel}
          onChange={(e) => setPeriodLabel(e.currentTarget.value)}
          placeholder="Month, quarter, project name…"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="hr-start">Start *</Label>
          <Input
            id="hr-start"
            type="date"
            required
            value={periodStart}
            max={defaults.today}
            onChange={(e) => setPeriodStart(e.currentTarget.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hr-end">End *</Label>
          <Input
            id="hr-end"
            type="date"
            required
            value={periodEnd}
            max={defaults.today}
            onChange={(e) => setPeriodEnd(e.currentTarget.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="hr-site">Site</Label>
        <Select
          id="hr-site"
          value={siteOrgUnitId}
          onChange={(e) => setSiteOrgUnitId(e.currentTarget.value)}
        >
          <option value="">All sites (tenant-wide)</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="hr-hours">Total hours *</Label>
          <Input
            id="hr-hours"
            type="number"
            min="0"
            step="0.01"
            required
            value={totalHours}
            onChange={(e) => setTotalHours(e.currentTarget.value)}
            placeholder="e.g. 12450"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hr-employees">Employees *</Label>
          <Input
            id="hr-employees"
            type="number"
            min="1"
            step="1"
            required
            value={employeeCount}
            onChange={(e) => setEmployeeCount(e.currentTarget.value)}
            placeholder="Avg count"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="hr-notes">Notes</Label>
        <Textarea
          id="hr-notes"
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
          rows={2}
          placeholder="Optional context"
        />
      </div>

      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          {editing ? 'Save changes' : 'Add period'}
        </Button>
      </div>
    </form>
  )
}
