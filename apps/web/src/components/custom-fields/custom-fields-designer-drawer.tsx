'use client'

// Create / edit flyout for a custom-field definition. URL-driven
// (?drawer=new | <id>), one UrlDrawer + form handling both modes — mirrors the
// equipment-type drawer. The field type drives which extra controls show
// (options for choice types; unit/range for numbers).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button, Input, Label, Select, Textarea, UrlDrawer, cn } from '@beaconhs/ui'
import {
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_META,
  type CustomFieldEntityKind,
  type CustomFieldOption,
  type CustomFieldType,
} from '@beaconhs/forms-core'
import type { SaveCustomFieldInput, SaveResult } from '@/lib/custom-fields/actions'

export type DesignerEditing = {
  id: string
  label: string
  helpText: string | null
  fieldType: CustomFieldType
  required: boolean
  groupLabel: string | null
  subtypeId: string | null
  sortOrder: number
  isActive: boolean
  config: {
    options?: CustomFieldOption[]
    unit?: string | null
    min?: number | null
    max?: number | null
    step?: number | null
    placeholder?: string | null
  } | null
}

type SaveAction = (input: SaveCustomFieldInput) => Promise<SaveResult>

export function CustomFieldsDesignerDrawer({
  mode,
  editing,
  kind,
  hasSubtype,
  subtypeLabel,
  subtypeOptions,
  closeHref,
  saveAction,
}: {
  mode: 'new' | 'edit' | null
  editing: DesignerEditing | null
  kind: CustomFieldEntityKind
  hasSubtype: boolean
  subtypeLabel: string | null
  subtypeOptions: { id: string; name: string }[]
  closeHref: string
  saveAction: SaveAction
}) {
  const router = useRouter()
  function close() {
    router.push(closeHref)
    router.refresh()
  }
  return (
    <UrlDrawer
      open={mode !== null}
      closeHref={closeHref}
      title={mode === 'edit' ? 'Edit custom field' : 'New custom field'}
      description="Define an extra attribute. Values are captured inline on each record."
      size="lg"
    >
      <DesignerForm
        key={editing?.id ?? 'new'}
        editing={editing}
        kind={kind}
        hasSubtype={hasSubtype}
        subtypeLabel={subtypeLabel}
        subtypeOptions={subtypeOptions}
        saveAction={saveAction}
        onDone={close}
      />
    </UrlDrawer>
  )
}

function DesignerForm({
  editing,
  kind,
  hasSubtype,
  subtypeLabel,
  subtypeOptions,
  saveAction,
  onDone,
}: {
  editing: DesignerEditing | null
  kind: CustomFieldEntityKind
  hasSubtype: boolean
  subtypeLabel: string | null
  subtypeOptions: { id: string; name: string }[]
  saveAction: SaveAction
  onDone: () => void
}) {
  const [label, setLabel] = useState(editing?.label ?? '')
  const [fieldType, setFieldType] = useState<CustomFieldType>(editing?.fieldType ?? 'text')
  const [helpText, setHelpText] = useState(editing?.helpText ?? '')
  const [groupLabel, setGroupLabel] = useState(editing?.groupLabel ?? '')
  const [required, setRequired] = useState(editing?.required ?? false)
  const [isActive, setIsActive] = useState(editing?.isActive ?? true)
  const [subtypeId, setSubtypeId] = useState(editing?.subtypeId ?? '')
  const [sortOrder, setSortOrder] = useState(
    editing?.sortOrder != null ? String(editing.sortOrder) : '0',
  )
  const [unit, setUnit] = useState(editing?.config?.unit ?? '')
  const [placeholder, setPlaceholder] = useState(editing?.config?.placeholder ?? '')
  const [min, setMin] = useState(editing?.config?.min != null ? String(editing.config.min) : '')
  const [max, setMax] = useState(editing?.config?.max != null ? String(editing.config.max) : '')
  const [step, setStep] = useState(editing?.config?.step != null ? String(editing.config.step) : '')
  const [options, setOptions] = useState<CustomFieldOption[]>(editing?.config?.options ?? [])
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const meta = CUSTOM_FIELD_TYPE_META[fieldType]

  function addOption() {
    setOptions((o) => [...o, { value: '', label: '' }])
  }
  function updateOption(i: number, patch: Partial<CustomFieldOption>) {
    setOptions((o) => o.map((opt, idx) => (idx === i ? { ...opt, ...patch } : opt)))
  }
  function removeOption(i: number) {
    setOptions((o) => o.filter((_, idx) => idx !== i))
  }

  function submit() {
    setError(null)
    const trimmed = label.trim()
    if (!trimmed) {
      setError('Label is required.')
      return
    }
    const cleanOptions = meta.hasOptions
      ? options
          .map((o) => ({
            value: (o.value || o.label)
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_'),
            label: (o.label || o.value).trim(),
          }))
          .filter((o) => o.value && o.label)
      : undefined
    if (meta.hasOptions && (!cleanOptions || cleanOptions.length === 0)) {
      setError('Add at least one option.')
      return
    }
    const config = {
      ...(meta.hasOptions ? { options: cleanOptions } : {}),
      ...(meta.supportsUnit && unit.trim() ? { unit: unit.trim() } : {}),
      ...(meta.supportsRange && min.trim() ? { min: Number(min) } : {}),
      ...(meta.supportsRange && max.trim() ? { max: Number(max) } : {}),
      ...(meta.supportsRange && step.trim() ? { step: Number(step) } : {}),
      ...(placeholder.trim() ? { placeholder: placeholder.trim() } : {}),
    }
    start(async () => {
      const res = await saveAction({
        kind,
        id: editing?.id,
        label: trimmed,
        helpText: helpText.trim() || null,
        fieldType,
        config: Object.keys(config).length > 0 ? config : null,
        required,
        groupLabel: groupLabel.trim() || null,
        subtypeId: hasSubtype ? subtypeId || null : null,
        sortOrder: Number(sortOrder) || 0,
        isActive,
      })
      if (res.ok) onDone()
      else setError(res.error)
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="cf-label">Label *</Label>
        <Input
          id="cf-label"
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.currentTarget.value)}
          placeholder="e.g. LEL sensor reading"
          required
        />
        <p className="text-xs text-slate-400 dark:text-slate-500">
          A stable key is derived from the label on creation and never changes.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cf-type">Field type</Label>
          <Select
            id="cf-type"
            value={fieldType}
            disabled={!!editing}
            onChange={(e) => setFieldType(e.currentTarget.value as CustomFieldType)}
          >
            {CUSTOM_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {CUSTOM_FIELD_TYPE_META[t].label}
              </option>
            ))}
          </Select>
          {editing ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Type is fixed after creation.
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cf-group">Group (section heading)</Label>
          <Input
            id="cf-group"
            value={groupLabel}
            onChange={(e) => setGroupLabel(e.currentTarget.value)}
            placeholder="e.g. Gas detector"
          />
        </div>
      </div>

      {hasSubtype ? (
        <div className="space-y-1.5">
          <Label htmlFor="cf-subtype">Applies to {subtypeLabel?.toLowerCase() ?? 'type'}</Label>
          <Select
            id="cf-subtype"
            value={subtypeId}
            onChange={(e) => setSubtypeId(e.currentTarget.value)}
          >
            <option value="">All {subtypeLabel?.toLowerCase() ?? 'types'}</option>
            {subtypeOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Scope the field to one {subtypeLabel?.toLowerCase() ?? 'type'}, or leave on “All” to
            show it on every record.
          </p>
        </div>
      ) : null}

      {meta.hasOptions ? (
        <div className="space-y-2">
          <Label>Options</Label>
          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={opt.label}
                  onChange={(e) => updateOption(i, { label: e.currentTarget.value })}
                  placeholder="Label"
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                  aria-label="Remove option"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addOption}>
            <Plus size={14} /> Add option
          </Button>
        </div>
      ) : null}

      {meta.supportsUnit || meta.supportsRange ? (
        <div className="grid grid-cols-2 gap-3">
          {meta.supportsUnit ? (
            <div className="space-y-1.5">
              <Label htmlFor="cf-unit">Unit</Label>
              <Input
                id="cf-unit"
                value={unit}
                onChange={(e) => setUnit(e.currentTarget.value)}
                placeholder="e.g. ppm, %, kg"
              />
            </div>
          ) : null}
          {meta.supportsRange ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="cf-min">Min</Label>
                <Input
                  id="cf-min"
                  type="number"
                  value={min}
                  onChange={(e) => setMin(e.currentTarget.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-max">Max</Label>
                <Input
                  id="cf-max"
                  type="number"
                  value={max}
                  onChange={(e) => setMax(e.currentTarget.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-step">Step</Label>
                <Input
                  id="cf-step"
                  type="number"
                  value={step}
                  onChange={(e) => setStep(e.currentTarget.value)}
                />
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="cf-help">Help text</Label>
        <Textarea
          id="cf-help"
          value={helpText}
          onChange={(e) => setHelpText(e.currentTarget.value)}
          rows={2}
          placeholder="Optional guidance shown under the field."
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cf-sort">Sort order</Label>
          <Input
            id="cf-sort"
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.currentTarget.value)}
          />
        </div>
        {fieldType !== 'boolean' ? (
          <div className="space-y-1.5">
            <Label htmlFor="cf-placeholder">Placeholder</Label>
            <Input
              id="cf-placeholder"
              value={placeholder}
              onChange={(e) => setPlaceholder(e.currentTarget.value)}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-4">
        <Toggle checked={required} onChange={setRequired} label="Required" />
        <Toggle checked={isActive} onChange={setIsActive} label="Active" />
      </div>

      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          {editing ? 'Save changes' : 'Create field'}
        </Button>
      </div>
    </form>
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"
    >
      <span
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-700',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </span>
      {label}
    </button>
  )
}
