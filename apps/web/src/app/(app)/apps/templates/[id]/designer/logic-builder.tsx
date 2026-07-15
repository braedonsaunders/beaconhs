'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

import { Plus, Trash2 } from 'lucide-react'
import { Button, Input, Select } from '@beaconhs/ui'
import type { LogicRule } from '@beaconhs/forms-core'

const OPS: {
  value: LogicRule extends infer R ? (R extends { op: string } ? R['op'] : never) : never
  label: string
  takesValue: boolean
}[] = [
  { value: 'eq', label: 'equals', takesValue: true },
  { value: 'ne', label: 'does not equal', takesValue: true },
  { value: 'gt', label: 'greater than', takesValue: true },
  { value: 'lt', label: 'less than', takesValue: true },
  { value: 'gte', label: '≥', takesValue: true },
  { value: 'lte', label: '≤', takesValue: true },
  { value: 'in', label: 'is one of (comma-sep)', takesValue: true },
  { value: 'notIn', label: 'is none of', takesValue: true },
  { value: 'isSet', label: 'has any value', takesValue: false },
  { value: 'isNotSet', label: 'is empty', takesValue: false },
]

type SimpleRule = {
  op: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'notIn' | 'isSet' | 'isNotSet'
  field: string
  value?: unknown
}

// The forms-core schema requires `in`/`notIn` values to be ARRAYS (the
// evaluator does `rule.value.includes(v)`; a raw string would silently give
// substring semantics and fail schema validation on publish). The editor keeps
// the comma-separated affordance but stores the split array.
function coerceClauseValue(op: SimpleRule['op'], raw: unknown): unknown {
  if (op === 'in' || op === 'notIn') {
    const text = Array.isArray(raw) ? raw.map((v) => String(v)).join(', ') : String(raw ?? '')
    return text.split(',').map((s) => s.trim())
  }
  return Array.isArray(raw) ? raw.map((v) => String(v)).join(', ') : (raw ?? '')
}

function displayClauseValue(raw: unknown): string {
  if (Array.isArray(raw)) return raw.map((v) => String(v)).join(', ')
  return String(raw ?? '')
}

/**
 * Two-mode logic editor:
 *   - "all"/"any" combinator over a flat list of clauses (simple, covers ~90%)
 *   - "raw JSON" fallback for nested/advanced rules
 */
export function LogicBuilder({
  rule,
  availableFields,
  onChange,
}: {
  rule: LogicRule | undefined
  availableFields: { id: string; label: string }[]
  onChange: (rule: LogicRule | undefined) => void
}) {
  const { combinator, clauses } = normalize(rule)

  function setCombinator(next: 'and' | 'or') {
    if (clauses.length === 0) onChange(undefined)
    else if (clauses.length === 1) onChange(clauses[0])
    else onChange({ op: next, rules: clauses })
  }

  function updateClause(i: number, patch: Partial<SimpleRule>) {
    const next = clauses.map((c, j) =>
      j === i ? ({ ...(c as SimpleRule), ...patch } as LogicRule) : c,
    )
    emit(combinator, next)
  }

  function addClause() {
    const first = availableFields[0]?.id ?? ''
    if (!first) return
    emit(combinator, [...clauses, { op: 'eq', field: first, value: '' } as LogicRule])
  }

  function removeClause(i: number) {
    emit(
      combinator,
      clauses.filter((_, j) => j !== i),
    )
  }

  function emit(comb: 'and' | 'or', list: LogicRule[]) {
    if (list.length === 0) onChange(undefined)
    else if (list.length === 1) onChange(list[0])
    else onChange({ op: comb, rules: list })
  }

  if (availableFields.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        <GeneratedText id="m_05d940858b4013" />
      </p>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/50 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-600">
          <GeneratedText id="m_1909228b977073" />
        </span>
        <Select
          className="h-7 w-24 text-xs"
          value={combinator}
          onChange={(e) => setCombinator(e.target.value as 'and' | 'or')}
        >
          <option value="and">{'all of'}</option>
          <option value="or">{'any of'}</option>
        </Select>
      </div>
      <GeneratedValue
        value={
          clauses.length === 0 ? (
            <p className="text-xs text-slate-500">
              <GeneratedText id="m_1f4f0e0d31c570" />
            </p>
          ) : (
            <ul className="space-y-1.5">
              <GeneratedValue
                value={clauses.map((c, i) => {
                  const clause = c as SimpleRule
                  const opMeta = OPS.find((o) => o.value === clause.op)
                  return (
                    <li key={i} className="flex items-center gap-1">
                      <Select
                        className="h-8 flex-1 text-xs"
                        value={clause.field}
                        onChange={(e) => updateClause(i, { field: e.target.value })}
                      >
                        {availableFields.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label} ({f.id})
                          </option>
                        ))}
                      </Select>
                      <Select
                        className="h-8 w-28 text-xs"
                        value={clause.op}
                        onChange={(e) => {
                          const nextOp = e.target.value as SimpleRule['op']
                          updateClause(i, {
                            op: nextOp,
                            value: OPS.find((o) => o.value === nextOp)?.takesValue
                              ? coerceClauseValue(nextOp, clause.value)
                              : undefined,
                          })
                        }}
                      >
                        {OPS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                      <GeneratedValue
                        value={
                          opMeta?.takesValue ? (
                            <Input
                              className="h-8 flex-1 text-xs"
                              value={displayClauseValue(clause.value)}
                              onChange={(e) =>
                                updateClause(i, {
                                  value: coerceClauseValue(clause.op, e.target.value),
                                })
                              }
                            />
                          ) : null
                        }
                      />
                      <button
                        type="button"
                        onClick={() => removeClause(i)}
                        className="text-slate-400 hover:text-red-500"
                      >
                        <Trash2 size={12} />
                      </button>
                    </li>
                  )
                })}
              />
            </ul>
          )
        }
      />
      <Button size="sm" variant="outline" onClick={addClause}>
        <Plus size={12} /> <GeneratedText id="m_040c74bbbf4722" />
      </Button>
    </div>
  )
}

function normalize(rule: LogicRule | undefined): {
  combinator: 'and' | 'or'
  clauses: LogicRule[]
} {
  if (!rule) return { combinator: 'and', clauses: [] }
  if ('rules' in rule && (rule.op === 'and' || rule.op === 'or')) {
    return { combinator: rule.op, clauses: rule.rules }
  }
  return { combinator: 'and', clauses: [rule] }
}
