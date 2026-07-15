'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

// Guided builder for a FormulaExpression tree. Used by the designer's "Calc"
// tab on formula fields. Renders a small recursive editor that lets
// the user pick an operator, then either literals, field refs, repeating-row
// sums, or nested sub-expressions.
//
// The user is never asked to write JSON. A live "preview value" pane sits
// beneath the tree so the designer can sanity-check the formula against
// example data without leaving the screen.

import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Input, Label, Select } from '@beaconhs/ui'
import {
  ENTITY_ATTRS,
  evaluateFormulaTree,
  type EntityKind,
  type EvalContext,
  type FormulaExpression,
  type LogicRule,
} from '@beaconhs/forms-core'
import { LogicBuilder } from './logic-builder'

// Designer-facing description of a single-entity picker field in the
// template. Used to populate the `entity_attr` operator picker.
type PickerFieldDesc = { id: string; label: string; kind: EntityKind }

// Each entry in this list is one supported operator. The shape carries enough
// metadata for the picker UI to render the right input affordance.
type OpDef = {
  kind: FormulaExpression['kind']
  label: string
  group: 'value' | 'math' | 'section' | 'string' | 'cond' | 'entity'
  description: string
}

const OPS: OpDef[] = [
  // Value
  { kind: 'literal', label: 'Number / text', group: 'value', description: 'Constant value' },
  { kind: 'field_ref', label: 'Field value', group: 'value', description: 'Read another field' },
  // Math
  { kind: 'sum', label: 'Sum (a + b + …)', group: 'math', description: 'Add a list of values' },
  {
    kind: 'product',
    label: 'Product (a × b × …)',
    group: 'math',
    description: 'Multiply a list of values',
  },
  { kind: 'subtract', label: 'Subtract (a − b)', group: 'math', description: 'a minus b' },
  { kind: 'divide', label: 'Divide (a ÷ b)', group: 'math', description: 'a divided by b' },
  { kind: 'min', label: 'Minimum', group: 'math', description: 'Smallest of a list' },
  { kind: 'max', label: 'Maximum', group: 'math', description: 'Largest of a list' },
  { kind: 'power', label: 'Power (aᵇ)', group: 'math', description: 'Raise a base to an exponent' },
  {
    kind: 'root',
    label: 'Root (ⁿ√a)',
    group: 'math',
    description: 'nth root — degree 2 is a square root, 3 a cube root',
  },
  { kind: 'abs', label: 'Absolute value', group: 'math', description: 'Distance from zero' },
  { kind: 'round', label: 'Round', group: 'math', description: 'Round to N decimal places' },
  {
    kind: 'floor',
    label: 'Round down (floor)',
    group: 'math',
    description: 'Largest integer ≤ value',
  },
  {
    kind: 'ceil',
    label: 'Round up (ceil)',
    group: 'math',
    description: 'Smallest integer ≥ value',
  },
  // Section
  {
    kind: 'sum_section',
    label: 'Sum field across rows',
    group: 'section',
    description: 'Sum a field across every row of a repeating section',
  },
  {
    kind: 'count_section',
    label: 'Count rows in section',
    group: 'section',
    description: 'How many rows in a repeating section',
  },
  {
    kind: 'avg_section',
    label: 'Average field across rows',
    group: 'section',
    description: 'Average a field across every row of a repeating section',
  },
  {
    kind: 'min_section',
    label: 'Minimum field across rows',
    group: 'section',
    description: 'Smallest value of a field across the rows',
  },
  {
    kind: 'max_section',
    label: 'Maximum field across rows',
    group: 'section',
    description: 'Largest value of a field across the rows',
  },
  // String
  {
    kind: 'concat',
    label: 'Concatenate text',
    group: 'string',
    description: 'Join strings together',
  },
  // Conditional
  { kind: 'if', label: 'If / else', group: 'cond', description: 'Branch on a condition' },
  // Entity
  {
    kind: 'entity_attr',
    label: 'Entity attribute',
    group: 'entity',
    description: 'Read an attribute off the entity selected by a picker field',
  },
]

export function FormulaBuilder({
  value,
  allFields,
  repeatingSections,
  pickerFields,
  onChange,
}: {
  value: FormulaExpression | undefined
  allFields: { id: string; label: string }[]
  repeatingSections: { id: string; label: string; fields: { id: string; label: string }[] }[]
  // Single-entity picker fields present elsewhere in this template. Drives
  // the `entity_attr` operator's picker → attr dropdowns. May be empty —
  // the operator is still selectable, just yields a "no pickers" placeholder.
  pickerFields?: PickerFieldDesc[]
  onChange: (next: FormulaExpression | undefined) => void
}) {
  const tGenerated = useGeneratedTranslations()
  // The preview pane lets the user fill in example values for any field /
  // repeating-row field referenced in the formula and see what evaluates.
  const [preview, setPreview] = useState<{
    values: Record<string, string>
    rowCounts: Record<string, number>
  }>({
    values: {},
    rowCounts: {},
  })

  const previewCtx: EvalContext = useMemo(() => {
    const rows: Record<string, Array<Record<string, unknown>>> = {}
    for (const sec of repeatingSections) {
      const count = preview.rowCounts[sec.id] ?? 0
      rows[sec.id] = Array.from({ length: count }, (_, i) => {
        const r: Record<string, unknown> = {}
        for (const f of sec.fields) {
          const k = `${sec.id}.${i}.${f.id}`
          const v = preview.values[k]
          // Best-effort numeric coercion so sum_section preview makes sense.
          if (v !== undefined && v !== '') {
            const n = Number(v)
            r[f.id] = Number.isFinite(n) ? n : v
          }
        }
        return r
      })
    }
    const values: Record<string, unknown> = {}
    for (const f of allFields) {
      const v = preview.values[f.id]
      if (v !== undefined && v !== '') {
        const n = Number(v)
        values[f.id] = Number.isFinite(n) ? n : v
      }
    }
    return { values, rows }
  }, [allFields, preview, repeatingSections])

  const previewValue = value ? evaluateFormulaTree(value, previewCtx) : null

  return (
    <div className="space-y-3">
      <Node
        value={value}
        allFields={allFields}
        repeatingSections={repeatingSections}
        pickerFields={pickerFields ?? []}
        onChange={onChange}
        onClear={() => onChange(undefined)}
      />

      <details className="rounded-md border border-slate-200 bg-slate-50/50 p-2 text-xs">
        <summary className="cursor-pointer font-semibold text-slate-600">
          <GeneratedText id="m_07c67e89962d16" />{' '}
          <GeneratedValue value={value ? renderPreviewValue(previewValue) : '—'} />
        </summary>
        <div className="mt-2 space-y-2">
          <GeneratedValue
            value={
              allFields.length > 0 ? (
                <div className="space-y-1">
                  <div className="font-semibold text-slate-500">
                    <GeneratedText id="m_1e3a16a7c41097" />
                  </div>
                  <GeneratedValue
                    value={allFields.map((f) => (
                      <div key={f.id} className="flex items-center gap-1">
                        <Label className="w-32 truncate text-[10px]">
                          <GeneratedValue value={f.label} />
                        </Label>
                        <Input
                          className="h-7 flex-1 text-xs"
                          value={preview.values[f.id] ?? ''}
                          onChange={(e) =>
                            setPreview((p) => ({
                              ...p,
                              values: { ...p.values, [f.id]: e.target.value },
                            }))
                          }
                        />
                      </div>
                    ))}
                  />
                </div>
              ) : null
            }
          />
          <GeneratedValue
            value={
              repeatingSections.length > 0 ? (
                <div className="space-y-2">
                  <div className="font-semibold text-slate-500">
                    <GeneratedText id="m_04b7380779afc4" />
                  </div>
                  <GeneratedValue
                    value={repeatingSections.map((sec) => {
                      const rowCount = preview.rowCounts[sec.id] ?? 0
                      return (
                        <div key={sec.id} className="rounded border border-slate-200 bg-white p-2">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">
                              <GeneratedValue value={sec.label} />
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className="rounded border border-slate-200 px-1.5 py-0.5"
                                onClick={() =>
                                  setPreview((p) => ({
                                    ...p,
                                    rowCounts: {
                                      ...p.rowCounts,
                                      [sec.id]: Math.max(0, rowCount - 1),
                                    },
                                  }))
                                }
                              >
                                −
                              </button>
                              <span>
                                <GeneratedValue value={rowCount} />{' '}
                                <GeneratedText id="m_19f38a950f87b6" />
                              </span>
                              <button
                                type="button"
                                className="rounded border border-slate-200 px-1.5 py-0.5"
                                onClick={() =>
                                  setPreview((p) => ({
                                    ...p,
                                    rowCounts: { ...p.rowCounts, [sec.id]: rowCount + 1 },
                                  }))
                                }
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <GeneratedValue
                            value={Array.from({ length: rowCount }, (_, i) => (
                              <div
                                key={i}
                                className="mt-1 grid grid-cols-2 gap-1 border-t border-slate-100 pt-1"
                              >
                                <GeneratedValue
                                  value={sec.fields.map((f) => {
                                    const k = `${sec.id}.${i}.${f.id}`
                                    return (
                                      <Input
                                        key={f.id}
                                        className="h-7 text-xs"
                                        placeholder={tGenerated('m_14dac40a7e102a', {
                                          value0: i + 1,
                                          value1: f.label,
                                        })}
                                        value={preview.values[k] ?? ''}
                                        onChange={(e) =>
                                          setPreview((p) => ({
                                            ...p,
                                            values: { ...p.values, [k]: e.target.value },
                                          }))
                                        }
                                      />
                                    )
                                  })}
                                />
                              </div>
                            ))}
                          />
                        </div>
                      )
                    })}
                  />
                </div>
              ) : null
            }
          />
        </div>
      </details>
    </div>
  )
}

function renderPreviewValue(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—'
  return String(v)
}

function Node({
  value,
  allFields,
  repeatingSections,
  pickerFields,
  onChange,
  onClear,
  showClear = true,
}: {
  value: FormulaExpression | undefined
  allFields: { id: string; label: string }[]
  repeatingSections: { id: string; label: string; fields: { id: string; label: string }[] }[]
  pickerFields: PickerFieldDesc[]
  onChange: (next: FormulaExpression) => void
  onClear?: () => void
  showClear?: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  if (!value) {
    return (
      <Select
        className="h-8 text-xs"
        value=""
        onChange={(e) => onChange(makeDefault(e.target.value as FormulaExpression['kind']))}
      >
        <option value="">
          <GeneratedText id="m_0b6d9aa275a131" />
        </option>
        <GeneratedValue
          value={GROUPS.map((g) => (
            <optgroup key={g.label} label={tGeneratedValue(g.label)}>
              <GeneratedValue
                value={OPS.filter((op) => op.group === g.kind).map((op) => (
                  <option key={op.kind} value={op.kind}>
                    <GeneratedValue value={op.label} />
                  </option>
                ))}
              />
            </optgroup>
          ))}
        />
      </Select>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-2">
      <div className="flex items-center justify-between gap-1">
        <Select
          className="h-7 flex-1 text-xs"
          value={value.kind}
          onChange={(e) => onChange(makeDefault(e.target.value as FormulaExpression['kind']))}
        >
          <GeneratedValue
            value={GROUPS.map((g) => (
              <optgroup key={g.label} label={tGeneratedValue(g.label)}>
                <GeneratedValue
                  value={OPS.filter((op) => op.group === g.kind).map((op) => (
                    <option key={op.kind} value={op.kind}>
                      <GeneratedValue value={op.label} />
                    </option>
                  ))}
                />
              </optgroup>
            ))}
          />
        </Select>
        <GeneratedValue
          value={
            showClear && onClear ? (
              <button
                type="button"
                className="rounded p-1 text-slate-400 hover:text-red-500"
                onClick={onClear}
                title={tGenerated('m_1e4d427e74e767')}
              >
                <Trash2 size={12} />
              </button>
            ) : null
          }
        />
      </div>
      <NodeBody
        value={value}
        allFields={allFields}
        repeatingSections={repeatingSections}
        pickerFields={pickerFields}
        onChange={onChange}
      />
    </div>
  )
}

function NodeBody({
  value,
  allFields,
  repeatingSections,
  pickerFields,
  onChange,
}: {
  value: FormulaExpression
  allFields: { id: string; label: string }[]
  repeatingSections: { id: string; label: string; fields: { id: string; label: string }[] }[]
  pickerFields: PickerFieldDesc[]
  onChange: (next: FormulaExpression) => void
}) {
  switch (value.kind) {
    case 'literal':
      return (
        <Input
          className="h-7 text-xs"
          value={String(value.value)}
          onChange={(e) => {
            const raw = e.target.value
            const asNum = Number(raw)
            onChange({ kind: 'literal', value: raw !== '' && Number.isFinite(asNum) ? asNum : raw })
          }}
        />
      )

    case 'field_ref':
      return (
        <Select
          className="h-7 text-xs"
          value={value.fieldKey}
          onChange={(e) => onChange({ kind: 'field_ref', fieldKey: e.target.value })}
        >
          <option value="">
            <GeneratedText id="m_013296217bd0ea" />
          </option>
          <GeneratedValue
            value={allFields.map((f) => (
              <option key={f.id} value={f.id}>
                <GeneratedValue value={f.label} /> (<GeneratedValue value={f.id} />)
              </option>
            ))}
          />
        </Select>
      )

    case 'sum':
    case 'product':
    case 'min':
    case 'max':
    case 'concat':
      return (
        <NodeList
          items={value.of}
          allFields={allFields}
          repeatingSections={repeatingSections}
          pickerFields={pickerFields}
          onChange={(of) => onChange({ ...value, of })}
        >
          <GeneratedValue
            value={
              value.kind === 'concat' ? (
                <div className="flex items-center gap-1">
                  <Label className="text-[10px]">
                    <GeneratedText id="m_09a3fb77851262" />
                  </Label>
                  <Input
                    className="h-7 flex-1 text-xs"
                    value={value.separator ?? ''}
                    onChange={(e) => onChange({ ...value, separator: e.target.value })}
                  />
                </div>
              ) : null
            }
          />
        </NodeList>
      )

    case 'subtract':
    case 'divide':
      return (
        <div className="space-y-1">
          <div>
            <div className="text-[10px] font-semibold text-slate-500">
              <GeneratedText id="m_146f7d831bfd96" />
            </div>
            <Node
              value={value.left}
              allFields={allFields}
              repeatingSections={repeatingSections}
              pickerFields={pickerFields}
              onChange={(next) => onChange({ ...value, left: next })}
              showClear={false}
            />
          </div>
          <div>
            <div className="text-[10px] font-semibold text-slate-500">
              <GeneratedText id="m_0d4127eb7af91b" />
            </div>
            <Node
              value={value.right}
              allFields={allFields}
              repeatingSections={repeatingSections}
              pickerFields={pickerFields}
              onChange={(next) => onChange({ ...value, right: next })}
              showClear={false}
            />
          </div>
        </div>
      )

    case 'power':
    case 'root': {
      const isPower = value.kind === 'power'
      const left = isPower ? value.base : value.of
      const right = isPower ? value.exponent : value.degree
      return (
        <div className="space-y-1">
          <div>
            <div className="text-[10px] font-semibold text-slate-500">
              <GeneratedValue
                value={
                  isPower ? (
                    <GeneratedText id="m_0301e90977d549" />
                  ) : (
                    <GeneratedText id="m_1cc0e5e7b5f442" />
                  )
                }
              />
            </div>
            <Node
              value={left}
              allFields={allFields}
              repeatingSections={repeatingSections}
              pickerFields={pickerFields}
              onChange={(next) =>
                onChange(isPower ? { ...value, base: next } : { ...value, of: next })
              }
              showClear={false}
            />
          </div>
          <div>
            <div className="text-[10px] font-semibold text-slate-500">
              <GeneratedValue
                value={
                  isPower ? (
                    <GeneratedText id="m_1979ef2713c627" />
                  ) : (
                    <GeneratedText id="m_10f4f461b6e849" />
                  )
                }
              />
            </div>
            <Node
              value={right}
              allFields={allFields}
              repeatingSections={repeatingSections}
              pickerFields={pickerFields}
              onChange={(next) =>
                onChange(isPower ? { ...value, exponent: next } : { ...value, degree: next })
              }
              showClear={false}
            />
          </div>
        </div>
      )
    }

    case 'abs':
    case 'floor':
    case 'ceil':
      return (
        <Node
          value={value.of}
          allFields={allFields}
          repeatingSections={repeatingSections}
          pickerFields={pickerFields}
          onChange={(next) => onChange({ ...value, of: next })}
          showClear={false}
        />
      )

    case 'round':
      return (
        <div className="space-y-1">
          <Node
            value={value.of}
            allFields={allFields}
            repeatingSections={repeatingSections}
            pickerFields={pickerFields}
            onChange={(next) => onChange({ ...value, of: next })}
            showClear={false}
          />
          <div className="flex items-center gap-1">
            <Label className="text-[10px]">
              <GeneratedText id="m_05b9318155a4da" />
            </Label>
            <Input
              type="number"
              min="0"
              className="h-7 w-20 text-xs"
              value={String(value.places ?? 0)}
              onChange={(e) =>
                onChange({ ...value, places: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
              }
            />
          </div>
        </div>
      )

    case 'sum_section':
    case 'avg_section':
    case 'min_section':
    case 'max_section': {
      const sec = repeatingSections.find((s) => s.id === value.sectionKey)
      return (
        <div className="space-y-1">
          <Select
            className="h-7 text-xs"
            value={value.sectionKey}
            onChange={(e) => onChange({ ...value, sectionKey: e.target.value, rowFieldKey: '' })}
          >
            <option value="">
              <GeneratedText id="m_14e9585fa8e12d" />
            </option>
            <GeneratedValue
              value={repeatingSections.map((s) => (
                <option key={s.id} value={s.id}>
                  <GeneratedValue value={s.label} />
                </option>
              ))}
            />
          </Select>
          <Select
            className="h-7 text-xs"
            value={value.rowFieldKey}
            onChange={(e) => onChange({ ...value, rowFieldKey: e.target.value })}
            disabled={!sec}
          >
            <option value="">
              <GeneratedText id="m_125aac439d6c75" />
            </option>
            <GeneratedValue
              value={sec?.fields.map((f) => (
                <option key={f.id} value={f.id}>
                  <GeneratedValue value={f.label} />
                </option>
              ))}
            />
          </Select>
        </div>
      )
    }

    case 'count_section':
      return (
        <Select
          className="h-7 text-xs"
          value={value.sectionKey}
          onChange={(e) => onChange({ ...value, sectionKey: e.target.value })}
        >
          <option value="">
            <GeneratedText id="m_14e9585fa8e12d" />
          </option>
          <GeneratedValue
            value={repeatingSections.map((s) => (
              <option key={s.id} value={s.id}>
                <GeneratedValue value={s.label} />
              </option>
            ))}
          />
        </Select>
      )

    case 'if':
      return (
        <div className="space-y-2">
          <div>
            <div className="text-[10px] font-semibold text-slate-500">
              <GeneratedText id="m_0c75ca758719d2" />
            </div>
            <LogicBuilder
              rule={value.condition}
              availableFields={allFields}
              onChange={(rule) => onChange({ ...value, condition: rule ?? ALWAYS_TRUE })}
            />
          </div>
          <div>
            <div className="text-[10px] font-semibold text-slate-500">
              <GeneratedText id="m_1aea6765cbbb07" />
            </div>
            <Node
              value={value.then}
              allFields={allFields}
              repeatingSections={repeatingSections}
              pickerFields={pickerFields}
              onChange={(next) => onChange({ ...value, then: next })}
              showClear={false}
            />
          </div>
          <div>
            <div className="text-[10px] font-semibold text-slate-500">
              <GeneratedText id="m_196f872aa354d3" />
            </div>
            <Node
              value={value.else}
              allFields={allFields}
              repeatingSections={repeatingSections}
              pickerFields={pickerFields}
              onChange={(next) => onChange({ ...value, else: next })}
              showClear={false}
            />
          </div>
        </div>
      )

    case 'entity_attr': {
      // 2-step picker: choose a picker field, then choose an attribute from
      // its kind's ENTITY_ATTRS list. The available attrs change when the
      // picker selection changes, so we reset attrKey whenever the picker
      // does — keeps designers from accidentally bouncing an attr off a
      // mismatched kind.
      const picker = pickerFields.find((p) => p.id === value.pickerFieldKey)
      const attrs = picker ? ENTITY_ATTRS[picker.kind] : []
      return (
        <div className="space-y-1">
          <GeneratedValue
            value={
              pickerFields.length === 0 ? (
                <p className="text-[10px] text-slate-500 italic">
                  <GeneratedText id="m_15ca343c0669d7" />
                </p>
              ) : (
                <Select
                  className="h-7 text-xs"
                  value={value.pickerFieldKey}
                  onChange={(e) =>
                    onChange({
                      kind: 'entity_attr',
                      pickerFieldKey: e.target.value,
                      attrKey: '',
                    })
                  }
                >
                  <option value="">
                    <GeneratedText id="m_12a2068b6d7120" />
                  </option>
                  <GeneratedValue
                    value={pickerFields.map((p) => (
                      <option key={p.id} value={p.id}>
                        <GeneratedValue value={p.label} /> (<GeneratedValue value={p.kind} />)
                      </option>
                    ))}
                  />
                </Select>
              )
            }
          />
          <Select
            className="h-7 text-xs"
            value={value.attrKey}
            onChange={(e) => onChange({ ...value, attrKey: e.target.value })}
            disabled={!picker}
          >
            <option value="">
              <GeneratedText id="m_11fc7f034f88ce" />
            </option>
            <GeneratedValue
              value={attrs.map((a) => (
                <option key={a.key} value={a.key}>
                  <GeneratedValue value={a.label} />
                </option>
              ))}
            />
          </Select>
        </div>
      )
    }
  }
}

function NodeList({
  items,
  allFields,
  repeatingSections,
  pickerFields,
  onChange,
  children,
}: {
  items: FormulaExpression[]
  allFields: { id: string; label: string }[]
  repeatingSections: { id: string; label: string; fields: { id: string; label: string }[] }[]
  pickerFields: PickerFieldDesc[]
  onChange: (next: FormulaExpression[]) => void
  children?: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <GeneratedValue value={children} />
      <GeneratedValue
        value={items.map((it, i) => (
          <div key={i} className="rounded border border-slate-100 bg-slate-50 p-1">
            <Node
              value={it}
              allFields={allFields}
              repeatingSections={repeatingSections}
              pickerFields={pickerFields}
              onChange={(next) => onChange(items.map((x, j) => (j === i ? next : x)))}
              onClear={() => onChange(items.filter((_, j) => j !== i))}
            />
          </div>
        ))}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => onChange([...items, { kind: 'literal', value: 0 }])}
      >
        <Plus size={12} /> <GeneratedText id="m_068bf7c4eb45a2" />
      </Button>
    </div>
  )
}

const GROUPS: { kind: OpDef['group']; label: string }[] = [
  { kind: 'value', label: 'Value' },
  { kind: 'math', label: 'Math' },
  { kind: 'section', label: 'Repeating section' },
  { kind: 'string', label: 'Text' },
  { kind: 'cond', label: 'Conditional' },
  { kind: 'entity', label: 'Entity attribute' },
]

// An empty conjunction is true and does not require an invented field id, so
// fresh conditional formulas remain valid under schema reference checks.
const ALWAYS_TRUE: LogicRule = { op: 'and', rules: [] }

function makeDefault(kind: FormulaExpression['kind']): FormulaExpression {
  switch (kind) {
    case 'literal':
      return { kind: 'literal', value: 0 }
    case 'field_ref':
      return { kind: 'field_ref', fieldKey: '' }
    case 'sum':
    case 'product':
    case 'min':
    case 'max':
      return { kind, of: [{ kind: 'literal', value: 0 }] }
    case 'subtract':
    case 'divide':
      return {
        kind,
        left: { kind: 'literal', value: 0 },
        right: { kind: 'literal', value: 1 },
      }
    case 'power':
      return {
        kind: 'power',
        base: { kind: 'literal', value: 0 },
        exponent: { kind: 'literal', value: 2 },
      }
    case 'root':
      return {
        kind: 'root',
        of: { kind: 'literal', value: 0 },
        degree: { kind: 'literal', value: 2 },
      }
    case 'abs':
    case 'floor':
    case 'ceil':
      return { kind, of: { kind: 'literal', value: 0 } }
    case 'round':
      return { kind: 'round', of: { kind: 'literal', value: 0 }, places: 0 }
    case 'sum_section':
    case 'avg_section':
    case 'min_section':
    case 'max_section':
      return { kind, sectionKey: '', rowFieldKey: '' }
    case 'count_section':
      return { kind: 'count_section', sectionKey: '' }
    case 'concat':
      return { kind: 'concat', of: [{ kind: 'literal', value: '' }], separator: '' }
    case 'if':
      return {
        kind: 'if',
        condition: ALWAYS_TRUE,
        then: { kind: 'literal', value: 0 },
        else: { kind: 'literal', value: 0 },
      }
    case 'entity_attr':
      return { kind: 'entity_attr', pickerFieldKey: '', attrKey: '' }
  }
}
