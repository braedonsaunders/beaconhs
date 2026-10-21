'use client'

import { Button, Input, Label, Select } from '@beaconhs/ui'
import type { ComplianceTargetRef } from '@beaconhs/db/schema'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { obligationTargetOptions } from './_target-options'

type Conditions = NonNullable<ComplianceTargetRef['skillConditions']>
export function SkillConditions({
  typeId,
  value,
  onChange,
}: {
  typeId: string
  value: Conditions
  onChange: (v: Conditions) => void
}) {
  const t = useGeneratedValueTranslations()
  function update(index: number, patch: Partial<Conditions[number]>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  return (
    <div className="space-y-3">
      <Label>
        <GeneratedValue value="Qualification conditions" />
      </Label>
      <p className="text-xs text-slate-500">
        <GeneratedValue value="All conditions must match the same valid ticket. Missing values do not qualify. Separate required items with commas; F/H/V/O covers F and H." />
      </p>
      {value.map((row, index) => (
        <div key={index} className="grid gap-2 rounded border p-3 sm:grid-cols-2">
          <RemoteSearchSelect
            value={row.fieldId}
            onChange={(fieldId) => update(index, { fieldId })}
            loadOptions={async (input) =>
              obligationTargetOptions({
                kind: 'skill_field',
                contextId: typeId,
                query: input.query,
                selected: input.selected,
              })
            }
            placeholder={t('Additional field')}
          />
          <Select
            value={row.operator}
            onChange={(e) =>
              update(index, { operator: e.target.value as Conditions[number]['operator'] })
            }
            aria-label={t('Comparison')}
          >
            <option value="equals">
              <GeneratedValue value="Equals" />
            </option>
            <option value="contains_all">
              <GeneratedValue value="Contains every item" />
            </option>
            <option value="contains_any">
              <GeneratedValue value="Contains any item" />
            </option>
          </Select>
          <Input
            value={row.values.join(', ')}
            onChange={(e) =>
              update(index, {
                values: row.operator === 'equals' ? [e.target.value] : e.target.value.split(','),
              })
            }
            aria-label={t('Required values')}
            placeholder={t('F, H')}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <GeneratedValue value="Remove condition" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={!typeId || value.length >= 20}
        onClick={() => onChange([...value, { fieldId: '', operator: 'contains_all', values: [] }])}
      >
        <GeneratedValue value="Add qualification condition" />
      </Button>
    </div>
  )
}
