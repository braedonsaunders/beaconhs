'use client'

import { useState } from 'react'
import { Input, Label, Select } from '@beaconhs/ui'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { EQUIPMENT_LOG_KINDS } from '@/lib/equipment/mutation-input'

export function EquipmentLogKindFields({
  defaultKind = 'note',
  defaultAmount,
}: {
  defaultKind?: string
  defaultAmount?: string | null
}) {
  const t = useGeneratedValueTranslations()
  const [kind, setKind] = useState(defaultKind)

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="equipment-log-kind">
          <GeneratedValue value="Kind" />
        </Label>
        <Select
          id="equipment-log-kind"
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {EQUIPMENT_LOG_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(value[0]!.toUpperCase() + value.slice(1))}
            </option>
          ))}
        </Select>
      </div>
      {kind === 'maintenance' ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="equipment-log-amount">
            <GeneratedValue value="Amount" />
          </Label>
          <Input
            id="equipment-log-amount"
            name="amount"
            defaultValue={defaultAmount ?? undefined}
            type="number"
            step="0.01"
            min="-9999999999999999.99"
            max="9999999999999999.99"
            aria-describedby="equipment-log-amount-help"
          />
          <p id="equipment-log-amount-help" className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedValue value="Optional maintenance expense. Use a negative amount for a credit or adjustment." />
          </p>
        </div>
      ) : null}
    </>
  )
}
