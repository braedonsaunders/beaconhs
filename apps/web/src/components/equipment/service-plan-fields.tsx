'use client'
import { Button, Input, Label, Select, Textarea } from '@beaconhs/ui'
import { Plus, Trash2 } from 'lucide-react'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import type { ServiceRule } from '@beaconhs/db/equipment-service'
import type { ServicePlanInput } from '@/lib/equipment/service-plans'
export type ServiceMeterOption = { id: string; name: string; unit: string; value: number | null }
export const STANDARD_SERVICE_METERS: ServiceMeterOption[] = [
  { id: 'engine_hours', name: 'Engine hours', unit: 'hours', value: null },
  { id: 'odometer', name: 'Odometer', unit: 'km', value: null },
]
export function ServicePlanFields({
  value,
  onChange,
  meters,
  today,
  disabled = false,
}: {
  value: ServicePlanInput
  onChange: (v: ServicePlanInput) => void
  meters: ServiceMeterOption[]
  today: string
  disabled?: boolean
}) {
  const t = useGeneratedValueTranslations()
  const choices = [
    ...STANDARD_SERVICE_METERS,
    ...meters,
    ...(value.meters ?? []).map((m) => ({ ...m })),
  ]
  function updateRule(index: number, rule: ServiceRule) {
    onChange({ ...value, rules: value.rules.map((r, i) => (i === index ? rule : r)) })
  }
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <div>
        <Label>
          <GeneratedValue value="Maintenance name" />
        </Label>
        <Input
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          maxLength={240}
          required
          placeholder={t('e.g. Engine oil and filter')}
        />
      </div>
      <div>
        <Label>
          <GeneratedValue value="Maintenance type" />
        </Label>
        <Select
          value={value.category ?? 'custom'}
          onChange={(e) =>
            onChange({ ...value, category: e.target.value === 'oil_change' ? 'oil_change' : null })
          }
        >
          <option value="custom">{t('Other maintenance')}</option>
          <option value="oil_change">{t('Oil change')}</option>
        </Select>
      </div>
      <p className="text-sm text-slate-500">
        <GeneratedValue value="Add the conditions that make this task due. Use a date, a usage counter, or a combination." />
      </p>
      {value.rules.map((rule, index) => (
        <div
          key={index}
          className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
        >
          <div className="flex gap-2">
            <Select
              aria-label={t('Condition')}
              value={rule.kind === 'calendar' ? 'calendar' : rule.meter}
              onChange={(e) =>
                updateRule(
                  index,
                  e.target.value === 'calendar'
                    ? { kind: 'calendar', every: 3, unit: 'month', dueOn: today }
                    : { kind: 'meter', meter: e.target.value, every: 100, dueAt: null },
                )
              }
            >
              <option value="calendar">{t('Calendar interval')}</option>
              {choices.map((m) => (
                <option key={m.id} value={m.id}>
                  {t(m.name)} ({t(m.unit)})
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('Remove condition')}
              disabled={value.rules.length === 1}
              onClick={() =>
                onChange({ ...value, rules: value.rules.filter((_, i) => i !== index) })
              }
            >
              <Trash2 size={16} />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>
                <GeneratedValue value="Repeat every" />
              </Label>
              <Input
                aria-label={t('Repeat every')}
                type="number"
                min={rule.kind === 'calendar' ? 1 : 0.001}
                step={rule.kind === 'calendar' ? 1 : 0.001}
                required={value.isActive}
                value={rule.every || ''}
                onChange={(e) =>
                  updateRule(
                    index,
                    rule.kind === 'calendar'
                      ? { ...rule, every: e.target.value === '' ? null : Number(e.target.value) }
                      : { ...rule, every: Number(e.target.value) },
                  )
                }
              />
            </div>
            {rule.kind === 'calendar' ? (
              <div>
                <Label>
                  <GeneratedValue value="Unit" />
                </Label>
                <Select
                  aria-label={t('Unit')}
                  value={rule.unit}
                  onChange={(e) =>
                    updateRule(index, {
                      ...rule,
                      unit: e.target.value as 'day' | 'week' | 'month' | 'year',
                    })
                  }
                >
                  {['day', 'week', 'month', 'year'].map((u) => (
                    <option key={u} value={u}>
                      {t(u)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <div>
                <Label>
                  <GeneratedValue value="Next due reading" />
                </Label>
                <Input
                  aria-label={t('Next due reading')}
                  type="number"
                  min={0}
                  step="0.001"
                  value={rule.dueAt ?? ''}
                  onChange={(e) =>
                    updateRule(index, {
                      ...rule,
                      dueAt: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </div>
            )}
          </div>
          {rule.kind === 'calendar' ? (
            <div>
              <Label>
                <GeneratedValue value="Next due date" />
              </Label>
              <Input
                aria-label={t('Next due date')}
                type="date"
                value={rule.dueOn ?? ''}
                onChange={(e) => updateRule(index, { ...rule, dueOn: e.target.value || null })}
              />
            </div>
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={value.rules.length >= 12}
          onClick={() => {
            const used = new Set(value.rules.filter((r) => r.kind === 'meter').map((r) => r.meter))
            const meter = choices.find((m) => !used.has(m.id))
            onChange({
              ...value,
              rules: [
                ...value.rules,
                value.rules.some((r) => r.kind === 'calendar')
                  ? { kind: 'meter', meter: meter?.id ?? 'engine_hours', every: 100, dueAt: null }
                  : { kind: 'calendar', every: 3, unit: 'month', dueOn: today },
              ],
            })
          }}
        >
          <Plus size={14} />
          <GeneratedValue value="Add condition" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={(value.meters?.length ?? 0) >= 12}
          onClick={() =>
            onChange({
              ...value,
              meters: [
                ...(value.meters ?? []),
                { id: crypto.randomUUID(), name: '', unit: '', value: null },
              ],
            })
          }
        >
          <Plus size={14} />
          <GeneratedValue value="Add custom counter" />
        </Button>
      </div>
      {(value.meters ?? []).map((meter, index) => (
        <div key={meter.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3">
          <Input
            aria-label={t('Counter name')}
            placeholder={t('Counter name')}
            value={meter.name}
            onChange={(e) =>
              onChange({
                ...value,
                meters: value.meters?.map((m, i) =>
                  i === index ? { ...m, name: e.target.value } : m,
                ),
              })
            }
            required
          />
          <Input
            aria-label={t('Counter unit')}
            placeholder={t('e.g. cycles, tonnes, miles')}
            value={meter.unit}
            onChange={(e) =>
              onChange({
                ...value,
                meters: value.meters?.map((m, i) =>
                  i === index ? { ...m, unit: e.target.value } : m,
                ),
              })
            }
            required
          />
          <Input
            aria-label={t('Current reading')}
            type="number"
            min={0}
            step="0.001"
            placeholder={t('Current reading')}
            value={meter.value ?? ''}
            onChange={(e) =>
              onChange({
                ...value,
                meters: value.meters?.map((m, i) =>
                  i === index
                    ? { ...m, value: e.target.value === '' ? null : Number(e.target.value) }
                    : m,
                ),
              })
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange({
                ...value,
                meters: value.meters?.filter((m) => m.id !== meter.id),
                rules: value.rules.filter((r) => r.kind !== 'meter' || r.meter !== meter.id),
              })
            }
          >
            <GeneratedValue value="Remove counter" />
          </Button>
        </div>
      ))}
      {value.rules.length > 1 ? (
        <div>
          <Label>
            <GeneratedValue value="When is it due?" />
          </Label>
          <Select
            value={value.match}
            onChange={(e) => onChange({ ...value, match: e.target.value as 'any' | 'all' })}
          >
            <option value="any">{t('Whichever comes first')}</option>
            <option value="all">{t('When all conditions are met')}</option>
          </Select>
        </div>
      ) : null}
      {value.id ? (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.resetReadings ?? false}
              onChange={(e) => onChange({ ...value, resetReadings: e.target.checked })}
            />
            <GeneratedValue value="A meter was replaced or reset" />
          </label>
          {value.resetReadings ? (
            <>
              <p className="text-xs text-slate-500">
                <GeneratedValue value="Correct the equipment reading and next-due thresholds for the new meter. Previous completion evidence stays in history." />
              </p>
              <Textarea
                aria-label={t('Meter reset explanation')}
                required
                minLength={10}
                maxLength={1000}
                value={value.resetReason ?? ''}
                onChange={(e) => onChange({ ...value, resetReason: e.target.value })}
              />
            </>
          ) : null}
        </div>
      ) : null}
      <div>
        <Label>
          <GeneratedValue value="Instructions / notes" />
        </Label>
        <Textarea
          value={value.notes ?? ''}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          maxLength={5000}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.isActive}
          onChange={(e) => onChange({ ...value, isActive: e.target.checked })}
        />
        <GeneratedValue value="Track this maintenance" />
      </label>
      <p className="text-xs text-slate-500">
        <GeneratedValue value="Leave an unknown due date or reading blank. The task will show Needs setup until it can be evaluated. Completion records are kept in the equipment log." />
      </p>
    </fieldset>
  )
}
