'use client'

import {
  useGeneratedTranslations,
  GeneratedText,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Always-editable input for a single custom field — the custom-field
// counterpart of <LiveField>. Local-first like every record field: it binds
// to the record's <OfflineRecordProvider> as `custom:<key>`, and the host
// module's saver applies it (see @/lib/custom-fields/record-op). Renders the
// right control per field type; a status dot mirrors the rest of the app.

import { Star } from 'lucide-react'
import { Input, Select, Textarea, cn } from '@beaconhs/ui'
import {
  CUSTOM_FIELD_LIMITS,
  CUSTOM_FIELD_TYPE_META,
  type CustomFieldConfig,
  type CustomFieldEntityKind,
  type CustomFieldType,
} from '@beaconhs/forms-core'
import { SaveDot } from '@/components/live-field'
import { RecordFieldError } from '@/components/record-field-error'
import { customFieldOpKey, customFieldWireValue } from '@/lib/custom-fields/wire'
import { useRecordField, type RecordFieldHandle } from '@/lib/offline-drafts/offline-record'

type CustomFieldInputDef = {
  key: string
  label: string
  helpText: string | null
  fieldType: CustomFieldType
  required: boolean
  config: CustomFieldConfig | null
}

export function CustomFieldInput({
  entityKind,
  def,
  initialValue,
  disabled,
}: {
  entityKind: CustomFieldEntityKind
  def: CustomFieldInputDef
  initialValue: unknown
  disabled?: boolean
}) {
  const f = useRecordField(customFieldOpKey(def.key), customFieldWireValue(def, initialValue))
  const meta = CUSTOM_FIELD_TYPE_META[def.fieldType]
  const off = disabled || f.paused

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <GeneratedValue value={def.label} />
          <GeneratedValue value={def.required ? <span className="text-red-600"> *</span> : null} />
        </label>
        <SaveDot state={f.saveState} error={f.error} onRetry={f.retry} />
      </div>
      {entityKind === 'equipment' && def.key === 'condition' ? (
        <ConditionRating field={f} disabled={off} />
      ) : (
        <Control def={def} meta={meta} disabled={off} field={f} />
      )}
      <RecordFieldError error={f.error} />
      <GeneratedValue
        value={
          def.helpText ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              <GeneratedValue value={def.helpText} />
            </p>
          ) : null
        }
      />
    </div>
  )
}

// Dispatcher only — no hooks here, so each concrete control renders
// unconditionally (rules-of-hooks).
function Control({
  def,
  meta,
  disabled,
  field,
}: {
  def: CustomFieldInputDef
  meta: (typeof CUSTOM_FIELD_TYPE_META)[CustomFieldType]
  disabled: boolean
  field: RecordFieldHandle<string>
}) {
  switch (def.fieldType) {
    case 'select':
      return <SelectControl def={def} disabled={disabled} field={field} />
    case 'multi_select':
      return <MultiSelectControl def={def} disabled={disabled} field={field} />
    case 'boolean':
      return <BooleanControl def={def} disabled={disabled} field={field} />
    default:
      return <TextLikeControl def={def} meta={meta} disabled={disabled} field={field} />
  }
}

function SelectControl({
  def,
  disabled,
  field,
}: {
  def: CustomFieldInputDef
  disabled: boolean
  field: RecordFieldHandle<string>
}) {
  return (
    <Select value={field.value} disabled={disabled} onChange={(e) => field.commit(e.target.value)}>
      <option value="">{'— None —'}</option>
      {(def.config?.options ?? []).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  )
}

function parseSelection(wire: string): string[] {
  try {
    const parsed: unknown = JSON.parse(wire)
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : []
  } catch {
    return []
  }
}

function MultiSelectControl({
  def,
  disabled,
  field,
}: {
  def: CustomFieldInputDef
  disabled: boolean
  field: RecordFieldHandle<string>
}) {
  const selected = parseSelection(field.value)
  function toggle(v: string) {
    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]
    field.commit(JSON.stringify(next))
  }
  return (
    <div className="flex flex-wrap gap-2">
      <GeneratedValue
        value={(def.config?.options ?? []).map((o) => {
          const on = selected.includes(o.value)
          return (
            <button
              key={o.value}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => toggle(o.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-50',
                on
                  ? 'border-teal-500 bg-teal-50 text-teal-800 dark:border-teal-500 dark:bg-teal-500/15 dark:text-teal-200'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
              )}
            >
              <GeneratedValue value={o.label} />
            </button>
          )
        })}
      />
    </div>
  )
}

function BooleanControl({
  def,
  disabled,
  field,
}: {
  def: CustomFieldInputDef
  disabled: boolean
  field: RecordFieldHandle<string>
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const on = field.value === 'true'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={tGeneratedValue(def.label)}
      disabled={disabled}
      onClick={() => field.commit(on ? 'false' : 'true')}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        on ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-700',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

function TextLikeControl({
  def,
  meta,
  disabled,
  field,
}: {
  def: CustomFieldInputDef
  meta: (typeof CUSTOM_FIELD_TYPE_META)[CustomFieldType]
  disabled: boolean
  field: RecordFieldHandle<string>
}) {
  const tGeneratedValue = useGeneratedValueTranslations()

  if (def.fieldType === 'textarea') {
    return (
      <Textarea
        rows={3}
        value={field.value}
        disabled={disabled}
        placeholder={tGeneratedValue(def.config?.placeholder ?? undefined)}
        maxLength={CUSTOM_FIELD_LIMITS.textarea}
        onChange={(e) => field.change(e.target.value)}
        onBlur={() => field.commit()}
      />
    )
  }

  const inputType =
    def.fieldType === 'number'
      ? 'number'
      : def.fieldType === 'date'
        ? 'date'
        : def.fieldType === 'datetime'
          ? 'datetime-local'
          : def.fieldType === 'email'
            ? 'email'
            : def.fieldType === 'url'
              ? 'url'
              : def.fieldType === 'phone'
                ? 'tel'
                : 'text'

  const input = (
    <Input
      type={inputType}
      value={field.value}
      disabled={disabled}
      placeholder={tGeneratedValue(def.config?.placeholder ?? undefined)}
      min={meta.supportsRange ? (def.config?.min ?? undefined) : undefined}
      max={meta.supportsRange ? (def.config?.max ?? undefined) : undefined}
      step={meta.supportsRange ? (def.config?.step ?? undefined) : undefined}
      maxLength={
        def.fieldType === 'email'
          ? CUSTOM_FIELD_LIMITS.email
          : def.fieldType === 'url'
            ? CUSTOM_FIELD_LIMITS.url
            : def.fieldType === 'phone'
              ? CUSTOM_FIELD_LIMITS.phone
              : def.fieldType === 'text'
                ? CUSTOM_FIELD_LIMITS.text
                : undefined
      }
      onChange={(e) => field.change(e.target.value)}
      onBlur={() => field.commit()}
    />
  )

  // Number fields with a unit suffix render the unit beside the input.
  if (def.fieldType === 'number' && def.config?.unit) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <GeneratedValue value={input} />
        </div>
        <span className="text-sm text-slate-500 dark:text-slate-400">
          <GeneratedValue value={def.config.unit} />
        </span>
      </div>
    )
  }
  return input
}

function ConditionRating({
  field,
  disabled,
}: {
  field: RecordFieldHandle<string>
  disabled: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  const value = Number(field.value)
  const rating = Number.isInteger(value) && value >= 1 && value <= 5 ? value : 0
  return (
    <div
      role="group"
      aria-label={tGenerated('m_1d38624f70b9c4')}
      className="flex items-center gap-1"
    >
      {[1, 2, 3, 4, 5].map((stars) => (
        <button
          key={stars}
          type="button"
          disabled={disabled}
          aria-label={tGenerated('m_142c6ad32d860b', { value0: stars })}
          aria-pressed={rating === stars}
          className="rounded p-1.5 text-amber-500 focus-visible:outline focus-visible:outline-2 disabled:cursor-default"
          onClick={() => field.commit(String(stars))}
        >
          <Star size={24} fill={stars <= rating ? 'currentColor' : 'none'} />
        </button>
      ))}
      <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
        {rating ? `${rating}/5` : tGenerated('m_13e61f4185333d')}
      </span>
    </div>
  )
}
