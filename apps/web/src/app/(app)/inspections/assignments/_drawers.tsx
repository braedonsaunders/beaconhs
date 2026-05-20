'use client'

// Sub-entity drawer for the inspection assignments list page:
//   • new-assignment → create a new recurring inspection assignment
//
// Opens via `?drawer=new-assignment` so it survives refresh + is link-shareable.
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

type Frequency = 'day' | 'week' | 'month' | 'quarter' | 'year'

const FREQUENCIES: Array<{ value: Frequency; label: string; cron: string }> = [
  { value: 'day', label: 'Daily', cron: '0 8 * * *' },
  { value: 'week', label: 'Weekly', cron: '0 8 * * 1' },
  { value: 'month', label: 'Monthly', cron: '0 8 1 * *' },
  { value: 'quarter', label: 'Quarterly', cron: '0 8 1 */3 *' },
  { value: 'year', label: 'Yearly', cron: '0 8 1 1 *' },
]

type CreateInspectionAssignmentAction = (input: {
  typeId: string
  frequency: Frequency
  cron: string | null
  dueOffsetMinutes: number | null
  quantityPerPeriod: number
  compliantPercentage: number
  targetEverybody: boolean
  targetRoleKeys: string[]
  targetPersonIds: string[]
  targetOrgUnitIds: string[]
  notes: string | null
}) => Promise<{ ok: true; id: string } | { ok: false; error: string }>

export function InspectionAssignmentsDrawers({
  openDrawer,
  closeHref,
  typeOptions,
  roleOptions,
  peopleOptions,
  siteOptions,
  createAssignmentAction,
}: {
  openDrawer: 'new-assignment' | null
  closeHref: string
  typeOptions: Array<{ id: string; name: string; defaultCadence: string | null }>
  roleOptions: Array<{ key: string; name: string }>
  peopleOptions: Array<{ id: string; firstName: string | null; lastName: string | null }>
  siteOptions: Array<{ id: string; name: string }>
  createAssignmentAction: CreateInspectionAssignmentAction
}) {
  return (
    <NewAssignmentDrawer
      open={openDrawer === 'new-assignment'}
      closeHref={closeHref}
      typeOptions={typeOptions}
      roleOptions={roleOptions}
      peopleOptions={peopleOptions}
      siteOptions={siteOptions}
      action={createAssignmentAction}
    />
  )
}

function NewAssignmentDrawer({
  open,
  closeHref,
  typeOptions,
  roleOptions,
  peopleOptions,
  siteOptions,
  action,
}: {
  open: boolean
  closeHref: string
  typeOptions: Array<{ id: string; name: string; defaultCadence: string | null }>
  roleOptions: Array<{ key: string; name: string }>
  peopleOptions: Array<{ id: string; firstName: string | null; lastName: string | null }>
  siteOptions: Array<{ id: string; name: string }>
  action: CreateInspectionAssignmentAction
}) {
  const router = useRouter()
  const defaultType = typeOptions[0] ?? null
  const defaultFrequency: Frequency = coerceFrequency(defaultType?.defaultCadence) ?? 'week'

  const [typeId, setTypeId] = useState<string>(defaultType?.id ?? '')
  const [frequency, setFrequency] = useState<Frequency>(defaultFrequency)
  const [cron, setCron] = useState('')
  const [dueOffsetMinutes, setDueOffsetMinutes] = useState('')
  const [quantityPerPeriod, setQuantityPerPeriod] = useState('1')
  const [compliantPercentage, setCompliantPercentage] = useState('100')
  const [targetEverybody, setTargetEverybody] = useState(false)
  const [targetRoleKeys, setTargetRoleKeys] = useState<string[]>([])
  const [targetPersonIds, setTargetPersonIds] = useState<string[]>([])
  const [targetOrgUnitIds, setTargetOrgUnitIds] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    if (!typeId) {
      setError('Inspection type is required.')
      return
    }
    if (
      !targetEverybody &&
      targetRoleKeys.length === 0 &&
      targetPersonIds.length === 0 &&
      targetOrgUnitIds.length === 0
    ) {
      setError('Pick at least one audience (everyone / role / person / site).')
      return
    }
    startTransition(async () => {
      const res = await action({
        typeId,
        frequency,
        cron: cron.trim() || null,
        dueOffsetMinutes:
          dueOffsetMinutes.trim() === '' ? null : Number(dueOffsetMinutes) || null,
        quantityPerPeriod: Math.max(1, Number(quantityPerPeriod) || 1),
        compliantPercentage: Math.max(
          0,
          Math.min(100, Number(compliantPercentage) || 100),
        ),
        targetEverybody,
        targetRoleKeys,
        targetPersonIds,
        targetOrgUnitIds,
        notes: notes.trim() || null,
      })
      if (res.ok) {
        router.push(`/inspections/assignments/${res.id}`)
        router.refresh()
      } else {
        setError(res.error || 'Failed to create assignment')
      }
    })
  }

  const noTypes = typeOptions.length === 0

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="New inspection assignment"
      description="Recurring duty — pick a type, audience, and cadence."
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
          <Button type="button" onClick={submit} disabled={pending || noTypes}>
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            Create assignment
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {noTypes ? (
          <Alert variant="warning">
            <AlertTitle>No inspection types available</AlertTitle>
            <AlertDescription>
              Create at least one published inspection type before scheduling an assignment.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="ia-type">Inspection type *</Label>
          <Select
            id="ia-type"
            value={typeId}
            onChange={(e) => {
              const next = e.currentTarget.value
              setTypeId(next)
              const t = typeOptions.find((tt) => tt.id === next)
              const freq = coerceFrequency(t?.defaultCadence)
              if (freq) setFrequency(freq)
            }}
            required
          >
            {noTypes ? (
              <option value="" disabled>
                None
              </option>
            ) : null}
            {typeOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ia-frequency">Cadence *</Label>
            <Select
              id="ia-frequency"
              value={frequency}
              onChange={(e) => setFrequency(e.currentTarget.value as Frequency)}
            >
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label} ({f.cron})
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ia-cron">Cron override (optional)</Label>
            <Input
              id="ia-cron"
              value={cron}
              onChange={(e) => setCron(e.currentTarget.value)}
              placeholder="leave blank to use cadence default"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ia-qty">Quantity per period *</Label>
            <Input
              id="ia-qty"
              type="number"
              min={1}
              value={quantityPerPeriod}
              onChange={(e) => setQuantityPerPeriod(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ia-pct">Compliant threshold (%)</Label>
            <Input
              id="ia-pct"
              type="number"
              min={0}
              max={100}
              value={compliantPercentage}
              onChange={(e) => setCompliantPercentage(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ia-due">Due offset (minutes after fire)</Label>
            <Input
              id="ia-due"
              type="number"
              value={dueOffsetMinutes}
              onChange={(e) => setDueOffsetMinutes(e.currentTarget.value)}
              placeholder="optional — e.g. 1440 = next day"
            />
          </div>
        </div>

        <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-700">Audience</legend>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={targetEverybody}
              onChange={(e) => setTargetEverybody(e.currentTarget.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600"
            />
            Apply to everyone (active people)
          </label>

          <div>
            <Label className="text-xs">Roles (hold cmd / ctrl to pick multiple)</Label>
            <select
              multiple
              value={targetRoleKeys}
              onChange={(e) => setTargetRoleKeys(getSelectedValues(e.currentTarget))}
              className="mt-1 min-h-[80px] w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
            >
              {roleOptions.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs">Specific people</Label>
            <select
              multiple
              value={targetPersonIds}
              onChange={(e) => setTargetPersonIds(getSelectedValues(e.currentTarget))}
              className="mt-1 min-h-[80px] w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
            >
              {peopleOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName ?? ''} {p.lastName ?? ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs">Sites (people active on these sites)</Label>
            <select
              multiple
              value={targetOrgUnitIds}
              onChange={(e) => setTargetOrgUnitIds(getSelectedValues(e.currentTarget))}
              className="mt-1 min-h-[80px] w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
            >
              {siteOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="ia-notes">Notes</Label>
          <Textarea
            id="ia-notes"
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            rows={2}
            placeholder="Internal context for this assignment"
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

function getSelectedValues(select: HTMLSelectElement): string[] {
  const out: string[] = []
  for (const opt of Array.from(select.selectedOptions)) {
    out.push(opt.value)
  }
  return out
}

function coerceFrequency(value: string | null | undefined): Frequency | null {
  if (!value) return null
  return (FREQUENCIES.find((f) => f.value === value)?.value) ?? null
}
