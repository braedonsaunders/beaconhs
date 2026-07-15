'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Create / edit flyout for a custom-field definition. URL-driven
// (?drawer=new | <id>), one UrlDrawer + form handling both modes — mirrors the
// equipment-type drawer. The field type drives which extra controls show
// (options for choice types; unit/range for numbers).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button, Input, Label, Select, Textarea, UrlDrawer, cn } from '@beaconhs/ui'
import {
  CUSTOM_FIELD_LIMITS,
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
  groupKey: string | null
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
  nativeGroups = [],
  closeHref,
  saveAction,
}: {
  mode: 'new' | 'edit' | null
  editing: DesignerEditing | null
  kind: CustomFieldEntityKind
  hasSubtype: boolean
  subtypeLabel: string | null
  subtypeOptions: { id: string; name: string }[]
  /** Native field groups the field can render inside (equipment only). */
  nativeGroups?: { key: string; label: string }[]
  closeHref: string
  saveAction: SaveAction
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  function close() {
    router.push(closeHref)
    router.refresh()
  }
  return (
    <UrlDrawer
      open={mode !== null}
      closeHref={closeHref}
      title={tGeneratedValue(
        mode === 'edit' ? tGenerated('m_074a585e7afb0d') : tGenerated('m_1ddc0d39deb418'),
      )}
      description={tGenerated('m_073bfb443d54ab')}
      size="lg"
    >
      <DesignerForm
        key={editing?.id ?? 'new'}
        editing={editing}
        kind={kind}
        hasSubtype={hasSubtype}
        subtypeLabel={subtypeLabel}
        subtypeOptions={subtypeOptions}
        nativeGroups={nativeGroups}
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
  nativeGroups,
  saveAction,
  onDone,
}: {
  editing: DesignerEditing | null
  kind: CustomFieldEntityKind
  hasSubtype: boolean
  subtypeLabel: string | null
  subtypeOptions: { id: string; name: string }[]
  nativeGroups: { key: string; label: string }[]
  saveAction: SaveAction
  onDone: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [label, setLabel] = useState(editing?.label ?? '')
  const [fieldType, setFieldType] = useState<CustomFieldType>(editing?.fieldType ?? 'text')
  const [helpText, setHelpText] = useState(editing?.helpText ?? '')
  const [groupLabel, setGroupLabel] = useState(editing?.groupLabel ?? '')
  const [groupKey, setGroupKey] = useState(editing?.groupKey ?? '')
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
    setError(tGeneratedValue(null))
    const trimmed = label.trim()
    if (!trimmed) {
      setError(tGenerated('m_032e518e5b40a1'))
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
      setError(tGenerated('m_0d84be61d0f239'))
      return
    }
    if (
      cleanOptions &&
      new Set(cleanOptions.map((option) => option.value)).size !== cleanOptions.length
    ) {
      setError(tGenerated('m_175fa61ba6c857'))
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
    const nextSubtypeId = hasSubtype ? subtypeId || null : null
    const destructiveChanges: string[] = []
    if (editing && nextSubtypeId && editing.subtypeId !== nextSubtypeId) {
      destructiveChanges.push(
        `saved values on records outside the selected ${subtypeLabel?.toLowerCase() ?? 'type'} will be removed`,
      )
    }
    if (editing && meta.hasOptions) {
      const nextValues = new Set((cleanOptions ?? []).map((option) => option.value))
      const removed = (editing.config?.options ?? []).filter(
        (option) => !nextValues.has(option.value),
      )
      if (removed.length > 0) {
        destructiveChanges.push(
          `saved selections using ${removed.length} removed option${removed.length === 1 ? '' : 's'} will be cleared`,
        )
      }
    }
    if (editing && fieldType === 'number') {
      const oldMin = editing.config?.min ?? null
      const oldMax = editing.config?.max ?? null
      const oldStep = editing.config?.step ?? null
      const nextMin = min.trim() ? Number(min) : null
      const nextMax = max.trim() ? Number(max) : null
      const nextStep = step.trim() ? Number(step) : null
      if (
        (nextMin !== null && (oldMin === null || nextMin > oldMin)) ||
        (nextMax !== null && (oldMax === null || nextMax < oldMax)) ||
        nextStep !== oldStep
      ) {
        destructiveChanges.push(
          'saved numbers that do not fit the new range or step will be cleared',
        )
      }
    }
    if (
      destructiveChanges.length > 0 &&
      !window.confirm(tGenerated('m_10aac5db2ebced', { value0: destructiveChanges.join('; ') }))
    ) {
      return
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
        groupKey: groupKey || null,
        subtypeId: nextSubtypeId,
        sortOrder: Number(sortOrder) || 0,
        isActive,
      })
      if (res.ok) onDone()
      else setError(tGeneratedValue(res.error))
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
        <Label htmlFor="cf-label">
          <GeneratedText id="m_1440aa48f9546a" />
        </Label>
        <Input
          id="cf-label"
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.currentTarget.value)}
          placeholder={tGenerated('m_161e2a00286530')}
          maxLength={CUSTOM_FIELD_LIMITS.label}
          required
        />
        <p className="text-xs text-slate-400 dark:text-slate-500">
          <GeneratedText id="m_1fac01d3a190cf" />
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cf-type">
            <GeneratedText id="m_1dcd0f4883781f" />
          </Label>
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
          <GeneratedValue
            value={
              editing ? (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  <GeneratedText id="m_0072fbeb120a2c" />
                </p>
              ) : null
            }
          />
        </div>
        <GeneratedValue
          value={
            nativeGroups.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="cf-placement">
                  <GeneratedText id="m_08fcf5dc4a7e37" />
                </Label>
                <Select
                  id="cf-placement"
                  value={groupKey}
                  onChange={(e) => setGroupKey(e.currentTarget.value)}
                >
                  <option value="">{'Its own section'}</option>
                  {nativeGroups.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.label}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null
          }
        />
        <GeneratedValue
          value={
            !groupKey ? (
              <div className="space-y-1.5">
                <Label htmlFor="cf-group">
                  <GeneratedText id="m_051fb491e56a24" />
                </Label>
                <Input
                  id="cf-group"
                  value={groupLabel}
                  onChange={(e) => setGroupLabel(e.currentTarget.value)}
                  placeholder={tGenerated('m_06857ce00f0a8a')}
                  maxLength={CUSTOM_FIELD_LIMITS.groupLabel}
                />
              </div>
            ) : null
          }
        />
      </div>

      <GeneratedValue
        value={
          hasSubtype ? (
            <div className="space-y-1.5">
              <Label htmlFor="cf-subtype">
                <GeneratedText id="m_1b4e50d87500ba" />{' '}
                <GeneratedValue
                  value={subtypeLabel?.toLowerCase() ?? <GeneratedText id="m_1d3e8ca87746ae" />}
                />
              </Label>
              <Select
                id="cf-subtype"
                value={subtypeId}
                onChange={(e) => setSubtypeId(e.currentTarget.value)}
              >
                <option value="">
                  {'All'} {subtypeLabel?.toLowerCase() ?? 'types'}
                </option>
                {subtypeOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                <GeneratedText id="m_0190e7556a98d5" />{' '}
                <GeneratedValue
                  value={subtypeLabel?.toLowerCase() ?? <GeneratedText id="m_1d3e8ca87746ae" />}
                />
                <GeneratedText id="m_186e355d12ce64" />
              </p>
              <GeneratedValue
                value={
                  editing ? (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      <GeneratedText id="m_1163139b88a5f0" />{' '}
                      <GeneratedValue
                        value={
                          subtypeLabel?.toLowerCase() ?? <GeneratedText id="m_1d3e8ca87746ae" />
                        }
                      />{' '}
                      <GeneratedText id="m_05ee3553244a0f" />
                    </p>
                  ) : null
                }
              />
            </div>
          ) : null
        }
      />

      <GeneratedValue
        value={
          meta.hasOptions ? (
            <div className="space-y-2">
              <Label>
                <GeneratedText id="m_0e69ebb67d27c2" />
              </Label>
              <div className="space-y-2">
                <GeneratedValue
                  value={options.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={opt.label}
                        onChange={(e) => updateOption(i, { label: e.currentTarget.value })}
                        placeholder={tGenerated('m_1d088977412efb')}
                        className="flex-1"
                        maxLength={CUSTOM_FIELD_LIMITS.optionLabel}
                      />
                      <button
                        type="button"
                        onClick={() => removeOption(i)}
                        className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                        aria-label={tGenerated('m_060bee20495d1a')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addOption}
                disabled={options.length >= CUSTOM_FIELD_LIMITS.options}
              >
                <Plus size={14} /> <GeneratedText id="m_157bc1fc2157b9" />
              </Button>
            </div>
          ) : null
        }
      />

      <GeneratedValue
        value={
          meta.supportsUnit || meta.supportsRange ? (
            <div className="grid grid-cols-2 gap-3">
              <GeneratedValue
                value={
                  meta.supportsUnit ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="cf-unit">
                        <GeneratedText id="m_1b1663e433323c" />
                      </Label>
                      <Input
                        id="cf-unit"
                        value={unit}
                        onChange={(e) => setUnit(e.currentTarget.value)}
                        placeholder={tGenerated('m_1ae44fcb25ead5')}
                        maxLength={CUSTOM_FIELD_LIMITS.unit}
                      />
                    </div>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  meta.supportsRange ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="cf-min">
                          <GeneratedText id="m_100639ca393959" />
                        </Label>
                        <Input
                          id="cf-min"
                          type="number"
                          step="any"
                          value={min}
                          onChange={(e) => setMin(e.currentTarget.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="cf-max">
                          <GeneratedText id="m_1929e34b445f83" />
                        </Label>
                        <Input
                          id="cf-max"
                          type="number"
                          step="any"
                          value={max}
                          onChange={(e) => setMax(e.currentTarget.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="cf-step">
                          <GeneratedText id="m_0cff7e37da2b3f" />
                        </Label>
                        <Input
                          id="cf-step"
                          type="number"
                          step="any"
                          value={step}
                          onChange={(e) => setStep(e.currentTarget.value)}
                        />
                      </div>
                    </>
                  ) : null
                }
              />
            </div>
          ) : null
        }
      />

      <div className="space-y-1.5">
        <Label htmlFor="cf-help">
          <GeneratedText id="m_0d04877b1a742b" />
        </Label>
        <Textarea
          id="cf-help"
          value={helpText}
          onChange={(e) => setHelpText(e.currentTarget.value)}
          rows={2}
          placeholder={tGenerated('m_08b210350bc696')}
          maxLength={CUSTOM_FIELD_LIMITS.helpText}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cf-sort">
            <GeneratedText id="m_1e92b40de46761" />
          </Label>
          <Input
            id="cf-sort"
            type="number"
            step={1}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.currentTarget.value)}
          />
        </div>
        <GeneratedValue
          value={
            meta.supportsPlaceholder ? (
              <div className="space-y-1.5">
                <Label htmlFor="cf-placeholder">
                  <GeneratedText id="m_1c62a99fb77c0a" />
                </Label>
                <Input
                  id="cf-placeholder"
                  value={placeholder}
                  onChange={(e) => setPlaceholder(e.currentTarget.value)}
                  maxLength={CUSTOM_FIELD_LIMITS.placeholder}
                />
              </div>
            ) : null
          }
        />
      </div>

      <div className="flex flex-wrap gap-4">
        <Toggle checked={required} onChange={setRequired} label={tGenerated('m_12fe2fe7a9ddad')} />
        <Toggle checked={isActive} onChange={setIsActive} label={tGenerated('m_1e1b1fdb7dd78e')} />
      </div>

      <GeneratedValue
        value={
          error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
              <GeneratedValue value={error} />
            </p>
          ) : null
        }
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          <GeneratedText id="m_112e2e8ecda428" />
        </Button>
        <Button type="submit" disabled={pending}>
          <GeneratedValue
            value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          />
          <GeneratedValue
            value={
              editing ? (
                <GeneratedText id="m_1ab9025ed1067c" />
              ) : (
                <GeneratedText id="m_1c04a4097c750a" />
              )
            }
          />
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
      <GeneratedValue value={label} />
    </button>
  )
}
