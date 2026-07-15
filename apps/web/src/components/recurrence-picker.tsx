'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// Shared recurrence / schedule builder for compliance obligations.
//
// Generalised from the inspection assignment drawer's cadence→cron presets. The
// `RecurrenceValue` shape mirrors the unified `ComplianceRecurrence` (M3) so the
// obligation form's payload survives the engine swap unchanged.
//
// Controlled. The `fields` prop selects which knobs render — each obligation
// kind exposes a different subset (e.g. inspections/journals show quantity +
// threshold; documents/training show a one-time due date; training shows a
// reminder lead). Hidden entirely for one-off kinds (corrective actions).
//
// The pure model (types, FREQUENCIES, frequencyToCron, recurrenceValueFromStored)
// lives in `./recurrence` so server code can use it too.

import { Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from '@beaconhs/ui'
import {
  FREQUENCIES,
  type Frequency,
  type RecurrenceFields,
  type RecurrenceKind,
  type RecurrenceValue,
} from './recurrence'

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
  const tGenerated = useGeneratedTranslations()
  const set = (patch: Partial<RecurrenceValue>) => onChange({ ...value, ...patch })

  const kinds: { value: RecurrenceKind; label: string }[] = []
  if (fields.oneTime) kinds.push({ value: 'one_time', label: 'One-time (single due date)' })
  if (fields.recurring) kinds.push({ value: 'frequency', label: 'Recurring (cadence)' })

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <GeneratedValue value={title} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <GeneratedValue
          value={
            kinds.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor="rec-kind">
                  <GeneratedText id="m_0c71ccdfab354c" />
                </Label>
                <Select
                  id="rec-kind"
                  value={value.kind}
                  onChange={(e) => set({ kind: e.target.value as RecurrenceKind })}
                >
                  <GeneratedValue
                    value={kinds.map((k) => (
                      <option key={k.value} value={k.value}>
                        <GeneratedValue value={k.label} />
                      </option>
                    ))}
                  />
                </Select>
              </div>
            ) : null
          }
        />

        <GeneratedValue
          value={
            value.kind === 'one_time' ? (
              <div className="space-y-1.5">
                <Label htmlFor="rec-due">
                  <GeneratedText id="m_18244bb4488b03" />
                </Label>
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
                  <Label htmlFor="rec-freq">
                    <GeneratedText id="m_1151ed0308b6d1" />
                  </Label>
                  <Select
                    id="rec-freq"
                    value={value.frequency ?? 'week'}
                    onChange={(e) => set({ frequency: e.target.value as Frequency })}
                  >
                    <GeneratedValue
                      value={FREQUENCIES.map((f) => (
                        <option key={f.value} value={f.value}>
                          <GeneratedValue value={f.label} /> (<GeneratedValue value={f.cron} />)
                        </option>
                      ))}
                    />
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rec-cron">
                    <GeneratedText id="m_0f75fbe6acc6db" />
                  </Label>
                  <Input
                    id="rec-cron"
                    value={value.cron ?? ''}
                    onChange={(e) => set({ cron: e.target.value || undefined })}
                    placeholder={tGenerated('m_1509ce693ccc4f')}
                  />
                </div>
                <GeneratedValue
                  value={
                    fields.quantity ? (
                      <div className="space-y-1.5">
                        <Label htmlFor="rec-qty">
                          <GeneratedText id="m_13adfb08c5ed8b" />
                        </Label>
                        <Input
                          id="rec-qty"
                          type="number"
                          min={1}
                          step={1}
                          value={value.quantity ?? 1}
                          onChange={(e) => {
                            const next = Number(e.target.value)
                            set({
                              quantity: Number.isFinite(next) ? Math.max(1, Math.trunc(next)) : 1,
                            })
                          }}
                        />
                      </div>
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    fields.threshold ? (
                      <div className="space-y-1.5">
                        <Label htmlFor="rec-pct">
                          <GeneratedText id="m_11c19fc3db953d" />
                        </Label>
                        <Input
                          id="rec-pct"
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={value.compliantPercentage ?? 100}
                          onChange={(e) => {
                            const next = Number(e.target.value)
                            set({
                              compliantPercentage: Number.isFinite(next)
                                ? Math.max(0, Math.min(100, next))
                                : 100,
                            })
                          }}
                        />
                      </div>
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    fields.dueOffset ? (
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="rec-off">
                          <GeneratedText id="m_11bc5b3e56eaa6" />
                        </Label>
                        <Input
                          id="rec-off"
                          type="number"
                          min={0}
                          step={1}
                          value={value.dueOffsetMinutes ?? ''}
                          onChange={(e) =>
                            set({
                              dueOffsetMinutes:
                                e.target.value === '' ? undefined : Number(e.target.value),
                            })
                          }
                          placeholder={tGenerated('m_0bfdd812b8d1e8')}
                        />
                      </div>
                    ) : null
                  }
                />
              </div>
            )
          }
        />

        <GeneratedValue
          value={
            fields.remind ? (
              <div className="space-y-1.5">
                <Label htmlFor="rec-remind">
                  <GeneratedText id="m_1c4240b068c336" />
                </Label>
                <Input
                  id="rec-remind"
                  type="number"
                  min={0}
                  value={value.remindBeforeDays ?? 7}
                  onChange={(e) =>
                    set({
                      remindBeforeDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)),
                    })
                  }
                />
              </div>
            ) : null
          }
        />
      </CardContent>
    </Card>
  )
}
