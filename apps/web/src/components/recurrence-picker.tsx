'use client'

// Shared recurrence / schedule builder for compliance obligations.
//
// Generalised from the inspection assignment drawer's cadence→cron presets. The
// `RecurrenceValue` shape mirrors the unified `ComplianceRecurrence` (M3) so the
// obligation form's payload survives the engine swap unchanged.
//
// Controlled. The `show` prop selects which knobs render — each obligation kind
// exposes a different subset (e.g. inspections/journals show quantity +
// threshold; documents/training show a one-time due date; training shows a
// reminder lead). Hidden entirely for one-off kinds (corrective actions).

import { Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from '@beaconhs/ui'

export type Frequency = 'day' | 'week' | 'month' | 'quarter' | 'year'

export type RecurrenceKind = 'one_time' | 'frequency' | 'cron'

export type RecurrenceValue = {
  kind: RecurrenceKind
  frequency?: Frequency
  cron?: string
  quantity?: number
  compliantPercentage?: number
  dueOn?: string
  remindBeforeDays?: number
  dueOffsetMinutes?: number
}

export const FREQUENCIES: Array<{ value: Frequency; label: string; cron: string }> = [
  { value: 'day', label: 'Daily', cron: '0 8 * * *' },
  { value: 'week', label: 'Weekly', cron: '0 8 * * 1' },
  { value: 'month', label: 'Monthly', cron: '0 8 1 * *' },
  { value: 'quarter', label: 'Quarterly', cron: '0 8 1 */3 *' },
  { value: 'year', label: 'Yearly', cron: '0 8 1 1 *' },
]

export function frequencyToCron(f: Frequency): string {
  return FREQUENCIES.find((x) => x.value === f)?.cron ?? '0 8 * * 1'
}

export type RecurrenceFields = {
  /** Allow a one-time (single due date) cadence. */
  oneTime?: boolean
  /** Allow a recurring (frequency/cron) cadence. */
  recurring?: boolean
  /** Show quantity-per-period (inspection / journal). */
  quantity?: boolean
  /** Show the compliant-threshold % (inspection / journal). */
  threshold?: boolean
  /** Show the reminder lead-days (training). */
  remind?: boolean
  /** Show the due-offset minutes (inspection / form). */
  dueOffset?: boolean
}

export function RecurrencePicker({
  value,
  onChange,
  fields,
  title = 'Schedule',
}: {
  value: RecurrenceValue
  onChange: (next: RecurrenceValue) => void
  fields: RecurrenceFields
  title?: string
}) {
  const set = (patch: Partial<RecurrenceValue>) => onChange({ ...value, ...patch })

  const kinds: { value: RecurrenceKind; label: string }[] = []
  if (fields.oneTime) kinds.push({ value: 'one_time', label: 'One-time (single due date)' })
  if (fields.recurring) kinds.push({ value: 'frequency', label: 'Recurring (cadence)' })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {kinds.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor="rec-kind">Cadence type</Label>
            <Select
              id="rec-kind"
              value={value.kind}
              onChange={(e) => set({ kind: e.target.value as RecurrenceKind })}
            >
              {kinds.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {value.kind === 'one_time' ? (
          <div className="space-y-1.5">
            <Label htmlFor="rec-due">Due date</Label>
            <Input
              id="rec-due"
              type="date"
              value={value.dueOn ?? ''}
              onChange={(e) => set({ dueOn: e.target.value || undefined })}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rec-freq">Cadence</Label>
              <Select
                id="rec-freq"
                value={value.frequency ?? 'week'}
                onChange={(e) => set({ frequency: e.target.value as Frequency })}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label} ({f.cron})
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-cron">Cron override (optional)</Label>
              <Input
                id="rec-cron"
                value={value.cron ?? ''}
                onChange={(e) => set({ cron: e.target.value || undefined })}
                placeholder="leave blank to use cadence default"
              />
            </div>
            {fields.quantity ? (
              <div className="space-y-1.5">
                <Label htmlFor="rec-qty">Quantity per period</Label>
                <Input
                  id="rec-qty"
                  type="number"
                  min={1}
                  value={value.quantity ?? 1}
                  onChange={(e) => set({ quantity: Math.max(1, Number(e.target.value) || 1) })}
                />
              </div>
            ) : null}
            {fields.threshold ? (
              <div className="space-y-1.5">
                <Label htmlFor="rec-pct">Compliant threshold (%)</Label>
                <Input
                  id="rec-pct"
                  type="number"
                  min={0}
                  max={100}
                  value={value.compliantPercentage ?? 100}
                  onChange={(e) =>
                    set({
                      compliantPercentage: Math.max(0, Math.min(100, Number(e.target.value) || 100)),
                    })
                  }
                />
              </div>
            ) : null}
            {fields.dueOffset ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="rec-off">Due offset (minutes after fire)</Label>
                <Input
                  id="rec-off"
                  type="number"
                  value={value.dueOffsetMinutes ?? ''}
                  onChange={(e) =>
                    set({
                      dueOffsetMinutes: e.target.value === '' ? undefined : Number(e.target.value),
                    })
                  }
                  placeholder="optional — e.g. 1440 = next day"
                />
              </div>
            ) : null}
          </div>
        )}

        {fields.remind ? (
          <div className="space-y-1.5">
            <Label htmlFor="rec-remind">Remind before (days)</Label>
            <Input
              id="rec-remind"
              type="number"
              min={0}
              value={value.remindBeforeDays ?? 7}
              onChange={(e) =>
                set({ remindBeforeDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })
              }
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
