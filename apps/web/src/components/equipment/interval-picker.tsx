'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// Cadence picker for equipment maintenance — "Pre-use / On demand / Every N
// day|week|month|year". Shared by the inspection-type drawer + builder, the
// per-unit schedule drawer, and the reminder repeat control, so every cadence
// in the module is entered the same way.

import { Input, Label, Select } from '@beaconhs/ui'
import { EQUIPMENT_INTERVAL_UNITS, type EquipmentIntervalUnit } from '@/lib/equipment/intervals'

export type IntervalValue = {
  isPreUse: boolean
  intervalValue: number | null
  intervalUnit: EquipmentIntervalUnit | null
}

type Mode = 'pre_use' | 'on_demand' | 'every'

function modeOf(v: IntervalValue): Mode {
  if (v.isPreUse) return 'pre_use'
  return v.intervalValue && v.intervalUnit ? 'every' : 'on_demand'
}

export function IntervalPicker({
  value,
  onChange,
  label = 'Interval',
  allowPreUse = false,
  allowOnDemand = true,
  onDemandLabel = 'On demand',
  disabled,
  idPrefix = 'interval',
}: {
  value: IntervalValue
  onChange: (next: IntervalValue) => void
  label?: string | null
  allowPreUse?: boolean
  allowOnDemand?: boolean
  onDemandLabel?: string
  disabled?: boolean
  idPrefix?: string
}) {
  const tGenerated = useGeneratedTranslations()
  // When neither pre-use nor on-demand is allowed, the cadence is mandatory —
  // skip the mode select entirely and render just the value + unit inputs.
  const onlyEvery = !allowPreUse && !allowOnDemand
  const mode = onlyEvery ? 'every' : modeOf(value)

  function setMode(next: Mode) {
    if (next === 'pre_use') onChange({ isPreUse: true, intervalValue: null, intervalUnit: null })
    else if (next === 'on_demand')
      onChange({ isPreUse: false, intervalValue: null, intervalUnit: null })
    else
      onChange({
        isPreUse: false,
        intervalValue: value.intervalValue ?? 1,
        intervalUnit: value.intervalUnit ?? 'month',
      })
  }

  return (
    <div className="space-y-1.5">
      <GeneratedValue
        value={
          label ? (
            <Label htmlFor={`${idPrefix}-mode`}>
              <GeneratedValue value={label} />
            </Label>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <GeneratedValue
          value={
            onlyEvery ? (
              <span className="text-sm text-slate-600 dark:text-slate-300">
                <GeneratedText id="m_1a812a9a9de996" />
              </span>
            ) : (
              <Select
                id={`${idPrefix}-mode`}
                value={mode}
                disabled={disabled}
                onChange={(e) => setMode(e.currentTarget.value as Mode)}
                className="w-36"
              >
                <GeneratedValue
                  value={
                    allowOnDemand ? (
                      <option value="on_demand">
                        <GeneratedValue value={onDemandLabel} />
                      </option>
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    allowPreUse ? (
                      <option value="pre_use">
                        <GeneratedText id="m_0169e159d93a5b" />
                      </option>
                    ) : null
                  }
                />
                <option value="every">
                  <GeneratedText id="m_185ca90e8a0046" />
                </option>
              </Select>
            )
          }
        />
        <GeneratedValue
          value={
            mode === 'every' ? (
              <>
                <Input
                  id={`${idPrefix}-value`}
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  disabled={disabled}
                  value={value.intervalValue ?? 1}
                  onChange={(e) => {
                    const n = Math.max(1, Math.trunc(Number(e.currentTarget.value) || 1))
                    onChange({ ...value, isPreUse: false, intervalValue: n })
                  }}
                  className="w-20"
                  aria-label={tGenerated('m_1845d41fa99dae')}
                />
                <Select
                  id={`${idPrefix}-unit`}
                  disabled={disabled}
                  value={value.intervalUnit ?? 'month'}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      isPreUse: false,
                      intervalUnit: e.currentTarget.value as EquipmentIntervalUnit,
                    })
                  }
                  className="w-32"
                  aria-label={tGenerated('m_0ddb550df9618d')}
                >
                  <GeneratedValue
                    value={EQUIPMENT_INTERVAL_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        <GeneratedValue
                          value={(value.intervalValue ?? 1) === 1 ? u.singular : u.plural}
                        />
                      </option>
                    ))}
                  />
                </Select>
              </>
            ) : null
          }
        />
      </div>
    </div>
  )
}
