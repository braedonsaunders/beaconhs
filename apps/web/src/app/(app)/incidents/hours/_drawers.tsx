'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  function close() {
    router.push(closeHref)
    router.refresh()
  }
  return (
    <UrlDrawer
      open={mode !== null}
      closeHref={closeHref}
      title={tGeneratedValue(
        mode === 'edit' ? tGenerated('m_04f9e5877f0972') : tGenerated('m_192213bc3f53a8'),
      )}
      description={tGenerated('m_1b3fb7bab1d657')}
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
    setError(tGeneratedValue(null))
    if (!periodStart || !periodEnd) {
      setError(tGenerated('m_0a8de7758e5c93'))
      return
    }
    const hours = Number(totalHours)
    if (!Number.isFinite(hours) || hours <= 0) {
      setError(tGenerated('m_0db9ede1257b48'))
      return
    }
    const employees = parseInt(employeeCount, 10)
    if (!Number.isFinite(employees) || employees <= 0) {
      setError(tGenerated('m_0b8ee3b6cfacf9'))
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
      else setError(tGeneratedValue(res.error))
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
        <Label htmlFor="hr-label">
          <GeneratedText id="m_1d088977412efb" />
        </Label>
        <Input
          id="hr-label"
          value={periodLabel}
          onChange={(e) => setPeriodLabel(e.currentTarget.value)}
          placeholder={tGenerated('m_004a432677b2de')}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="hr-start">
            <GeneratedText id="m_0cd37437f64da3" />
          </Label>
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
          <Label htmlFor="hr-end">
            <GeneratedText id="m_1c8930140caf2b" />
          </Label>
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
        <Label htmlFor="hr-site">
          <GeneratedText id="m_020146dd3d3d5a" />
        </Label>
        <Select
          id="hr-site"
          value={siteOrgUnitId}
          onChange={(e) => setSiteOrgUnitId(e.currentTarget.value)}
        >
          <option value="">{'All sites (tenant-wide)'}</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="hr-hours">
            <GeneratedText id="m_08f7d0e94785f6" />
          </Label>
          <Input
            id="hr-hours"
            type="number"
            min="0"
            step="0.01"
            required
            value={totalHours}
            onChange={(e) => setTotalHours(e.currentTarget.value)}
            placeholder={tGenerated('m_11dcf67960da30')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hr-employees">
            <GeneratedText id="m_0e5ce05c87e99c" />
          </Label>
          <Input
            id="hr-employees"
            type="number"
            min="1"
            step="1"
            required
            value={employeeCount}
            onChange={(e) => setEmployeeCount(e.currentTarget.value)}
            placeholder={tGenerated('m_10bc283fe135fa')}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="hr-notes">
          <GeneratedText id="m_0b8dadcb78cd08" />
        </Label>
        <Textarea
          id="hr-notes"
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
          rows={2}
          placeholder={tGenerated('m_1abe9cf96c55f3')}
        />
      </div>

      <GeneratedValue
        value={
          error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
              <GeneratedValue value={error} />
            </p>
          ) : null
        }
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          <GeneratedText id="m_112e2e8ecda428" />
        </Button>
        <Button type="submit" disabled={pending}>
          <GeneratedValue
            value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          />
          <GeneratedValue
            value={
              editing ? (
                <GeneratedText id="m_1ab9025ed1067c" />
              ) : (
                <GeneratedText id="m_1f98e43ebaf016" />
              )
            }
          />
        </Button>
      </div>
    </form>
  )
}
