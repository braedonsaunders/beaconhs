'use client'

// Guided builder for a FormulaExpression tree. Used by the designer's "Calc"
// tab on formula / calc fields. Renders a small recursive editor that lets
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
export type PickerFieldDesc = { id: string; label: string; kind: EntityKind }

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
          Preview · {value ? renderPreviewValue(previewValue) : '—'}
        </summary>
        <div className="mt-2 space-y-2">
          {allFields.length > 0 ? (
            <div className="space-y-1">
              <div className="font-semibold text-slate-500">Example top-level values</div>
              {allFields.map((f) => (
                <div key={f.id} className="flex items-center gap-1">
                  <Label className="w-32 truncate text-[10px]">{f.label}</Label>
                  <Input
                    className="h-7 flex-1 text-xs"
                    value={preview.values[f.id] ?? ''}
                    onChange={(e) =>
                      setPreview((p) => ({ ...p, values: { ...p.values, [f.id]: e.target.value } }))
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}
          {repeatingSections.length > 0 ? (
            <div className="space-y-2">
              <div className="font-semibold text-slate-500">Example repeating sections</div>
              {repeatingSections.map((sec) => {
                const rowCount = preview.rowCounts[sec.id] ?? 0
                return (
                  <div key={sec.id} className="rounded border border-slate-200 bg-white p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{sec.label}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="rounded border border-slate-200 px-1.5 py-0.5"
                          onClick={() =>
                            setPreview((p) => ({
                              ...p,
                              rowCounts: { ...p.rowCounts, [sec.id]: Math.max(0, rowCount - 1) },
                            }))
                          }
                        >
                          −
                        </button>
                        <span>{rowCount} rows</span>
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
                    {Array.from({ length: rowCount }, (_, i) => (
                      <div
                        key={i}
                        className="mt-1 grid grid-cols-2 gap-1 border-t border-slate-100 pt-1"
                      >
                        {sec.fields.map((f) => {
                          const k = `${sec.id}.${i}.${f.id}`
                          return (
                            <Input
                              key={f.id}
                              className="h-7 text-xs"
                              placeholder={`row ${i + 1} ${f.label}`}
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
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          ) : null}
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
  if (!value) {
    return (
      <Select
        className="h-8 text-xs"
        value=""
        onChange={(e) => onChange(makeDefault(e.target.value as FormulaExpression['kind']))}
      >
        <option value="">— pick an operator —</option>
        {GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {OPS.filter((op) => op.group === g.kind).map((op) => (
              <option key={op.kind} value={op.kind}>
                {op.label}
              </option>
            ))}
          </optgroup>
        ))}
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
          {GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {OPS.filter((op) => op.group === g.kind).map((op) => (
                <option key={op.kind} value={op.kind}>
                  {op.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        {showClear && onClear ? (
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:text-red-500"
            onClick={onClear}
            title="Clear"
          >
            <Trash2 size={12} />
          </button>
        ) : null}
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
          <option value="">— pick field —</option>
          {allFields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label} ({f.id})
            </option>
          ))}
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
          {value.kind === 'concat' ? (
            <div className="flex items-center gap-1">
              <Label className="text-[10px]">Separator</Label>
              <Input
                className="h-7 flex-1 text-xs"
                value={value.separator ?? ''}
                onChange={(e) => onChange({ ...value, separator: e.target.value })}
              />
            </div>
          ) : null}
        </NodeList>
      )

    case 'subtract':
    case 'divide':
      return (
        <div className="space-y-1">
          <div>
            <div className="text-[10px] font-semibold text-slate-500">Left</div>
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
            <div className="text-[10px] font-semibold text-slate-500">Right</div>
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
            <option value="">— pick section —</option>
            {repeatingSections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
          <Select
            className="h-7 text-xs"
            value={value.rowFieldKey}
            onChange={(e) => onChange({ ...value, rowFieldKey: e.target.value })}
            disabled={!sec}
          >
            <option value="">— pick row field —</option>
            {sec?.fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
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
          <option value="">— pick section —</option>
          {repeatingSections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      )

    case 'if':
      return (
        <div className="space-y-2">
          <div>
            <div className="text-[10px] font-semibold text-slate-500">When (condition)</div>
            <LogicBuilder
              rule={value.condition}
              availableFields={allFields}
              onChange={(rule) => onChange({ ...value, condition: rule ?? ALWAYS_TRUE })}
            />
          </div>
          <div>
            <div className="text-[10px] font-semibold text-slate-500">Then</div>
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
            <div className="text-[10px] font-semibold text-slate-500">Else</div>
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
          {pickerFields.length === 0 ? (
            <p className="text-[10px] text-slate-500 italic">
              No picker fields in this template. Add an equipment / person / site / PPE / document /
              course picker first.
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
              <option value="">— pick picker field —</option>
              {pickerFields.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.kind})
                </option>
              ))}
            </Select>
          )}
          <Select
            className="h-7 text-xs"
            value={value.attrKey}
            onChange={(e) => onChange({ ...value, attrKey: e.target.value })}
            disabled={!picker}
          >
            <option value="">— pick attribute —</option>
            {attrs.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
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
      {children}
      {items.map((it, i) => (
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
      <Button
        size="sm"
        variant="outline"
        onClick={() => onChange([...items, { kind: 'literal', value: 0 }])}
      >
        <Plus size={12} /> Add operand
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

const ALWAYS_TRUE: LogicRule = { op: 'isSet', field: '__never_set__' }

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
