'use client'

import {
  useGeneratedTranslations,
  GeneratedText,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Always-editable, auto-saving input for a single custom field — the
// custom-field counterpart of <LiveField>. Saves through the generic
// `updateCustomFieldValueAction` (entityKind + id + key + value). Renders the
// right control per field type; a status dot mirrors the rest of the app.

import { useEffect, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import { Input, Select, Textarea, cn } from '@beaconhs/ui'
import {
  CUSTOM_FIELD_LIMITS,
  CUSTOM_FIELD_TYPE_META,
  type CustomFieldConfig,
  type CustomFieldEntityKind,
  type CustomFieldType,
} from '@beaconhs/forms-core'
import { SaveDot, useAutoSave, type SaveState } from '@/components/live-field'

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
  recordId,
  def,
  initialValue,
  disabled,
  updateAction,
}: {
  entityKind: CustomFieldEntityKind
  recordId: string
  def: CustomFieldInputDef
  initialValue: unknown
  disabled?: boolean
  updateAction: (formData: FormData) => Promise<void>
}) {
  // Last successfully persisted value (text-like controls only) — advanced in
  // onSaved so a failed save keeps the field dirty and retry works.
  const baseline = useRef(
    typeof initialValue === 'string' || typeof initialValue === 'number'
      ? String(initialValue)
      : '',
  )
  const { state, setState, save, retry, hasPending } = useAutoSave({
    prepare: (value) => {
      const fd = new FormData()
      fd.set('entityKind', entityKind)
      fd.set('id', recordId)
      fd.set('key', def.key)
      fd.set('value', value)
      return fd
    },
    updateAction,
    onSaved: (v) => {
      baseline.current = v
    },
  })

  const meta = CUSTOM_FIELD_TYPE_META[def.fieldType]

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <GeneratedValue value={def.label} />
          <GeneratedValue value={def.required ? <span className="text-red-600"> *</span> : null} />
        </label>
        <SaveDot state={state} onRetry={retry} />
      </div>
      {entityKind === 'equipment' && def.key === 'condition' ? (
        <ConditionRating
          initialValue={initialValue}
          disabled={disabled}
          persist={save}
          hasPending={hasPending}
        />
      ) : (
        <Control
          def={def}
          meta={meta}
          disabled={disabled}
          initialValue={initialValue}
          setState={setState}
          persist={save}
          baseline={baseline}
          hasPending={hasPending}
        />
      )}
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

// Dispatcher only — no hooks here, so each concrete control owns its own state
// and hooks run unconditionally (rules-of-hooks).
function Control({
  def,
  meta,
  disabled,
  initialValue,
  setState,
  persist,
  baseline,
  hasPending,
}: {
  def: CustomFieldInputDef
  meta: (typeof CUSTOM_FIELD_TYPE_META)[CustomFieldType]
  disabled?: boolean
  initialValue: unknown
  setState: (s: SaveState) => void
  persist: (value: string) => void
  baseline: { current: string }
  hasPending: () => boolean
}) {
  switch (def.fieldType) {
    case 'select':
      return (
        <SelectControl
          def={def}
          disabled={disabled}
          initialValue={initialValue}
          persist={persist}
        />
      )
    case 'multi_select':
      return (
        <MultiSelectControl
          def={def}
          disabled={disabled}
          initialValue={initialValue}
          persist={persist}
        />
      )
    case 'boolean':
      return (
        <BooleanControl
          def={def}
          disabled={disabled}
          initialValue={initialValue}
          persist={persist}
        />
      )
    default:
      return (
        <TextLikeControl
          def={def}
          meta={meta}
          disabled={disabled}
          initialValue={
            typeof initialValue === 'string' || typeof initialValue === 'number'
              ? String(initialValue)
              : ''
          }
          setState={setState}
          persist={persist}
          baseline={baseline}
          hasPending={hasPending}
        />
      )
  }
}

function SelectControl({
  def,
  disabled,
  initialValue,
  persist,
}: {
  def: CustomFieldInputDef
  disabled?: boolean
  initialValue: unknown
  persist: (value: string) => void
}) {
  const allowed = new Set((def.config?.options ?? []).map((option) => option.value))
  const [value, setValue] = useState(
    typeof initialValue === 'string' && allowed.has(initialValue) ? initialValue : '',
  )
  return (
    <Select
      value={value}
      disabled={disabled}
      onChange={(e) => {
        setValue(e.target.value)
        persist(e.target.value)
      }}
    >
      <option value="">{'— None —'}</option>
      {(def.config?.options ?? []).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  )
}

function MultiSelectControl({
  def,
  disabled,
  initialValue,
  persist,
}: {
  def: CustomFieldInputDef
  disabled?: boolean
  initialValue: unknown
  persist: (value: string) => void
}) {
  const allowed = new Set((def.config?.options ?? []).map((option) => option.value))
  const initial = Array.isArray(initialValue)
    ? (initialValue as unknown[]).filter(
        (value): value is string => typeof value === 'string' && allowed.has(value),
      )
    : []
  const [selected, setSelected] = useState<string[]>(initial)
  function toggle(v: string) {
    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]
    setSelected(next)
    persist(JSON.stringify(next))
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
  initialValue,
  persist,
}: {
  def: CustomFieldInputDef
  disabled?: boolean
  initialValue: unknown
  persist: (value: string) => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const [on, setOn] = useState(initialValue === true)
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={tGeneratedValue(def.label)}
      disabled={disabled}
      onClick={() => {
        const next = !on
        setOn(next)
        persist(next ? 'true' : 'false')
      }}
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
  initialValue,
  setState,
  persist,
  baseline,
  hasPending,
}: {
  def: CustomFieldInputDef
  meta: (typeof CUSTOM_FIELD_TYPE_META)[CustomFieldType]
  disabled?: boolean
  initialValue: string
  setState: (s: SaveState) => void
  persist: (value: string) => void
  baseline: { current: string }
  hasPending: () => boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const [value, setValue] = useState(initialValue)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  function commit(next: string) {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    // Baseline only advances after a successful save (in the parent's onSaved),
    // so a failed save stays retryable instead of dead-ending on this check.
    if (next === baseline.current && !hasPending()) {
      setState('idle')
      return
    }
    persist(next)
  }

  function onChange(next: string) {
    setValue(next)
    setState('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => commit(next), 1000)
  }

  if (def.fieldType === 'textarea') {
    return (
      <Textarea
        rows={3}
        value={value}
        disabled={disabled}
        placeholder={tGeneratedValue(def.config?.placeholder ?? undefined)}
        maxLength={CUSTOM_FIELD_LIMITS.textarea}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => commit(value)}
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
      value={value}
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
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => commit(value)}
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
  initialValue,
  disabled,
  persist,
  hasPending,
}: {
  initialValue: unknown
  disabled?: boolean
  persist: (value: string) => void
  hasPending: () => boolean
}) {
  const tGenerated = useGeneratedTranslations()

  const [value, setValue] = useState(Number(initialValue))
  useEffect(() => {
    if (!hasPending()) setValue(Number(initialValue))
  }, [initialValue, hasPending])
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
          onClick={() => {
            setValue(stars)
            persist(String(stars))
          }}
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
