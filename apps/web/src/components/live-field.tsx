'use client'

import { RichTextEditor } from '@beaconhs/ui/rich-text-editor'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Always-editable record fields — the legacy form's killer mobile trait,
// modernised. No edit-pencil, no drawer: the input on the page IS the field.
// Every field is local-first: it binds by `field` (the module saver's op key)
// to the record's <OfflineRecordProvider>, which writes each edit to the
// device (~300 ms after typing pauses; immediately on blur, select, tap, and
// when the page hides) and syncs it to the server with a compare-and-set
// (see @/lib/offline-drafts/offline-record). A tiny status dot tells the crew
// where the field stands; the page's sync indicator covers the whole record.
//
// Shared primitive — used by every native record page (incidents, hazard
// assessments, inspections, corrective actions, training, people, …).

import { useState } from 'react'
import { htmlToText, normalizeDocumentHref, sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { Input, SearchSelect, Select, Textarea, cn, type SelectOption } from '@beaconhs/ui'
import { useRecordField, type FieldSaveState } from '@/lib/offline-drafts/offline-record'
import { RecordFieldError } from './record-field-error'
import { RemoteSearchSelect } from './remote-search-select'
import { toast } from '@/lib/toast'
import type { PickerLookup } from '@/lib/picker-options'

export function SaveDot({
  state,
  error,
  onRetry,
}: {
  state: FieldSaveState
  /** Why the server refused the value (shown as a tooltip). */
  error?: string | null
  onRetry?: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  if (state === 'idle') return null
  if (state === 'error' && onRetry) {
    return (
      <button
        type="button"
        onClick={() => {
          // Touch screens have no tooltips: say why before trying again.
          if (error) toast.error(tGeneratedValue(error))
          onRetry()
        }}
        title={error ? tGeneratedValue(error) : undefined}
        className="text-[11px] font-medium text-red-600 hover:underline dark:text-red-400"
      >
        <GeneratedText id="m_13b78c61dbb517" />
      </button>
    )
  }
  return (
    <span
      title={state === 'error' && error ? tGeneratedValue(error) : undefined}
      className={cn(
        'text-[11px] font-medium',
        state === 'saving' && 'text-slate-400',
        state === 'dirty' && 'text-slate-400',
        state === 'saved' && 'text-emerald-600 dark:text-emerald-400',
        state === 'error' && 'text-red-600 dark:text-red-400',
      )}
    >
      <GeneratedValue
        value={
          state === 'saving' ? (
            <GeneratedText id="m_106811f2aac664" />
          ) : state === 'dirty' ? (
            '…'
          ) : state === 'saved' ? (
            <GeneratedText id="m_0a3bcf685192f1" />
          ) : (
            <GeneratedText id="m_13b78c61dbb517" />
          )
        }
      />
    </span>
  )
}

function FieldLabel({
  label,
  state,
  error,
  onRetry,
}: {
  label: string
  state: FieldSaveState
  error: string | null
  onRetry: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
        <GeneratedValue value={label} />
      </label>
      <SaveDot state={state} error={error} onRetry={onRetry} />
    </div>
  )
}

/**
 * A value the system owns, shown in the same grid as the live fields.
 *
 * Some record facts are recorded automatically and must never look editable —
 * who created the record, when it was locked. Rendering them as a disabled
 * input invites people to try; this reads as what it is.
 */
export function ReadOnlyField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
        <GeneratedValue value={label} />
      </div>
      <p className="text-sm text-slate-900 dark:text-slate-100">
        <GeneratedValue value={value || '—'} />
      </p>
    </div>
  )
}

export function LiveField({
  field,
  label,
  initialValue,
  multiline = false,
  rows = 3,
  type = 'text',
  placeholder,
  maxLength,
  min,
  max,
  disabled,
}: {
  /** The record saver's op key (usually the column name). */
  field: string
  label: string
  initialValue: string | null
  multiline?: boolean
  rows?: number
  /** Input type for single-line fields. Ignored when `multiline`. */
  type?: 'text' | 'number' | 'date'
  placeholder?: string
  maxLength?: number
  min?: number | string
  max?: number | string
  disabled?: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const f = useRecordField(field, initialValue ?? '')
  const shared = {
    value: f.value,
    placeholder,
    maxLength,
    min,
    max,
    disabled: disabled || f.paused,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      f.change(e.target.value),
    onBlur: () => f.commit(),
  }

  return (
    <div className="space-y-1">
      <FieldLabel
        label={tGeneratedValue(label)}
        state={f.saveState}
        error={f.error}
        onRetry={f.retry}
      />
      <GeneratedValue
        value={multiline ? <Textarea rows={rows} {...shared} /> : <Input type={type} {...shared} />}
      />
      <RecordFieldError error={f.error} />
    </div>
  )
}

export function LiveSelect({
  field,
  label,
  initialValue,
  options,
  emptyLabel = '—',
  allowEmpty = true,
  disabled,
}: {
  field: string
  label: string
  initialValue: string | null
  options: { value: string; label: string }[]
  emptyLabel?: string
  /** Render a blank option. Set false for NOT-NULL enum columns. */
  allowEmpty?: boolean
  disabled?: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const f = useRecordField(field, initialValue ?? '')

  return (
    <div className="space-y-1">
      <FieldLabel
        label={tGeneratedValue(label)}
        state={f.saveState}
        error={f.error}
        onRetry={f.retry}
      />
      <Select
        value={f.value}
        disabled={disabled || f.paused}
        onChange={(e) => f.commit(e.target.value)}
      >
        {allowEmpty ? <option value="">{emptyLabel}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <RecordFieldError error={f.error} />
    </div>
  )
}

/** Remote-search counterpart for high-cardinality reference tables. */
export function LiveRemoteSelect({
  field,
  label,
  initialValue,
  initialOption,
  lookup,
  contextId,
  emptyLabel = '—',
  allowEmpty = true,
  disabled,
}: {
  field: string
  label: string
  initialValue: string | null
  initialOption?: SelectOption
  lookup: PickerLookup
  contextId?: string
  emptyLabel?: string
  allowEmpty?: boolean
  disabled?: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const f = useRecordField(field, initialValue ?? '')

  return (
    <div className="space-y-1">
      <FieldLabel
        label={tGeneratedValue(label)}
        state={f.saveState}
        error={f.error}
        onRetry={f.retry}
      />
      <RemoteSearchSelect
        lookup={lookup}
        contextId={contextId}
        value={f.value}
        onChange={(next) => f.commit(next)}
        initialOption={initialOption}
        placeholder={tGeneratedValue(emptyLabel)}
        searchPlaceholder={tGenerated('m_1f0a8c50aedb8c', { value0: label.toLowerCase() })}
        sheetTitle={`Select ${label.toLowerCase()}`}
        ariaLabel={label}
        clearable={allowEmpty}
        emptyLabel={tGeneratedValue(emptyLabel)}
        disabled={disabled || f.paused}
      />
      <RecordFieldError error={f.error} />
    </div>
  )
}

export function LivePersonSelect({
  field,
  label,
  initialValue,
  options,
  initialOption,
  sheetTitle = 'Select person',
  placeholder = 'Select a person…',
  searchPlaceholder = 'Search active people…',
  disabled,
}: {
  field: string
  label: string
  initialValue: string | null
  options: SelectOption[]
  initialOption?: SelectOption
  sheetTitle?: string
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const f = useRecordField(field, initialValue ?? '')

  return (
    <div className="space-y-1">
      <FieldLabel
        label={tGeneratedValue(label)}
        state={f.saveState}
        error={f.error}
        onRetry={f.retry}
      />
      <SearchSelect
        value={f.value}
        onChange={(next) => f.commit(next)}
        options={
          initialOption?.value === f.value && !options.some((option) => option.value === f.value)
            ? [initialOption, ...options]
            : options
        }
        placeholder={tGeneratedValue(placeholder)}
        searchPlaceholder={tGeneratedValue(searchPlaceholder)}
        sheetTitle={sheetTitle}
        ariaLabel={label}
        clearable
        emptyLabel={tGenerated('m_0dd5f8a31ce3e1')}
        disabled={disabled || f.paused}
      />
      <RecordFieldError error={f.error} />
    </div>
  )
}

/**
 * Date-time field (`datetime-local`, wall-clock time in the worker's
 * timezone). Written to the device after typing pauses and on blur: the input
 * emits '' for an incomplete keyboard edit, so it never saves on every change.
 * An empty value IS saved — nullable columns clear, required ones are refused
 * and show the field's error state.
 */
export function LiveDateTime({
  field,
  label,
  initialValue,
  disabled,
}: {
  field: string
  label: string
  /** datetime-local formatted string, e.g. 2026-06-11T14:30 */
  initialValue: string
  disabled?: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const f = useRecordField(field, initialValue)

  return (
    <div className="space-y-1">
      <FieldLabel
        label={tGeneratedValue(label)}
        state={f.saveState}
        error={f.error}
        onRetry={f.retry}
      />
      <Input
        type="datetime-local"
        value={f.value}
        disabled={disabled || f.paused}
        onChange={(e) => f.change(e.target.value)}
        onBlur={() => f.commit()}
      />
      <RecordFieldError error={f.error} />
    </div>
  )
}

/**
 * Tap-to-save boolean switch. Sends `'true'`/`'false'` — the saver coerces
 * them back to a boolean column.
 */
export function LiveToggle({
  field,
  label,
  initialValue,
  disabled,
}: {
  field: string
  label: string
  initialValue: boolean
  disabled?: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const f = useRecordField(field, initialValue ? 'true' : 'false')
  const on = f.value === 'true'
  const off = disabled || f.paused

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
      <span className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <GeneratedValue value={label} />
        <SaveDot state={f.saveState} error={f.error} onRetry={f.retry} />
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={tGeneratedValue(label)}
        disabled={off}
        onClick={() => {
          if (!off) f.commit(on ? 'false' : 'true')
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
    </div>
  )
}

const SEVERITY_LABELS: Record<number, string> = {
  1: 'No first aid / no damage',
  2: 'First aid / < $1k',
  3: 'Medical aid / < $5k',
  4: 'Critical / < $25k',
  5: 'Fatality / > $25k',
}

const SEVERITY_ACTIVE: Record<number, string> = {
  1: 'border-emerald-400 bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-700',
  2: 'border-lime-400 bg-lime-100 text-lime-900 dark:bg-lime-950/50 dark:text-lime-200 dark:border-lime-700',
  3: 'border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-700',
  4: 'border-orange-400 bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-200 dark:border-orange-700',
  5: 'border-red-400 bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-200 dark:border-red-700',
}

/**
 * Editable 1–5 severity picker. Tap a cell to set; tap the active cell again
 * to clear. Sends the number as a string (empty clears the column).
 */
export function LiveSeverityRating({
  field,
  label,
  initialValue,
  disabled,
}: {
  field: string
  label: string
  initialValue: number | null
  disabled?: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const f = useRecordField(field, initialValue == null ? '' : String(initialValue))
  const value = f.value === '' ? null : Number(f.value)
  const off = disabled || f.paused

  function pick(n: number) {
    if (off) return
    f.commit(value === n ? '' : String(n))
  }

  return (
    <div className="space-y-1">
      <FieldLabel
        label={tGeneratedValue(label)}
        state={f.saveState}
        error={f.error}
        onRetry={f.retry}
      />
      <div className="flex items-center gap-1.5">
        <GeneratedValue
          value={[1, 2, 3, 4, 5].map((n) => {
            const active = value === n
            return (
              <button
                key={n}
                type="button"
                disabled={off}
                onClick={() => pick(n)}
                title={tGeneratedValue(`${n} — ${SEVERITY_LABELS[n]}`)}
                aria-pressed={active}
                className={cn(
                  'flex h-11 flex-1 items-center justify-center rounded-lg border text-sm font-semibold transition-colors disabled:opacity-50 sm:h-9',
                  active
                    ? SEVERITY_ACTIVE[n]
                    : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500',
                )}
              >
                <GeneratedValue value={n} />
              </button>
            )
          })}
        />
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        <GeneratedValue
          value={value ? SEVERITY_LABELS[value] : <GeneratedText id="m_13e61f4185333d" />}
        />
      </p>
      <RecordFieldError error={f.error} />
    </div>
  )
}

// Is this HTML effectively blank? (fresh TipTap doc, stray tags, &nbsp; only)
function htmlIsEmpty(html: string): boolean {
  return htmlToText(html).length === 0
}

/**
 * Rich-text field. Many legacy narrative columns hold HTML (`<p>`,
 * `<strong>`, `&nbsp;`…) — a plain textarea would show the raw markup, so this
 * renders the formatted HTML and edits it with the shared `RichTextEditor`,
 * sending HTML back. Click-to-edit: the heavy TipTap editor mounts only while
 * a field is being edited (one at a time), keeping the page light on phones.
 */
export function LiveRichText({
  field,
  label,
  initialValue,
  placeholder = 'Add…',
  disabled,
}: {
  field: string
  label: string
  initialValue: string | null
  placeholder?: string
  disabled?: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const [editing, setEditing] = useState(false)
  const f = useRecordField(field, initialValue ?? '')
  const off = disabled || f.paused

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <GeneratedValue value={label} />
        </label>
        <div className="flex items-center gap-2">
          <SaveDot state={f.saveState} error={f.error} onRetry={f.retry} />
          <GeneratedValue
            value={
              off ? null : editing ? (
                <button
                  type="button"
                  onClick={() => {
                    f.commit()
                    setEditing(false)
                  }}
                  className="text-[11px] font-medium text-teal-700 hover:underline dark:text-teal-400"
                >
                  <GeneratedText id="m_00609f822e0571" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-[11px] font-medium text-teal-700 hover:underline dark:text-teal-400"
                >
                  <GeneratedText id="m_03a66f9d34ac7b" />
                </button>
              )
            }
          />
        </div>
      </div>
      <GeneratedValue
        value={
          editing && !off ? (
            <RichTextEditor
              defaultValue={f.value}
              onChange={(html: string) => f.change(html)}
              placeholder={tGeneratedValue(placeholder)}
              minHeight="120px"
              normalizeLink={normalizeDocumentHref}
              onInvalidLink={() => toast.error(tGenerated('m_19dc719a9038ec'))}
            />
          ) : (
            <div
              role={off ? undefined : 'button'}
              tabIndex={off ? undefined : 0}
              onClick={() => {
                if (!off) setEditing(true)
              }}
              onKeyDown={(e) => {
                if (!off && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  setEditing(true)
                }
              }}
              className={cn(
                'min-h-[2.5rem] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900',
                !off && 'cursor-text hover:border-slate-300 dark:hover:border-slate-700',
              )}
            >
              <GeneratedValue
                value={
                  htmlIsEmpty(f.value) ? (
                    <span className="text-slate-400 dark:text-slate-500">
                      <GeneratedValue value={placeholder} />
                    </span>
                  ) : (
                    <div
                      className="prose prose-sm prose-slate dark:prose-invert max-w-none"
                      // Stored narrative HTML is user-supplied — sanitize before
                      // rendering (defense-in-depth alongside write-side sanitization).
                      dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(f.value) }}
                    />
                  )
                }
              />
            </div>
          )
        }
      />
      <RecordFieldError error={f.error} />
    </div>
  )
}
