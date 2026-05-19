'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button, Input, Label, Select } from '@beaconhs/ui'
import type { FormField, LogicRule } from '@beaconhs/forms-core'

const OPS: { value: LogicRule extends infer R ? (R extends { op: string } ? R['op'] : never) : never; label: string; takesValue: boolean }[] = [
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
    else onChange({ op: next, rules: clauses as any })
  }

  function updateClause(i: number, patch: Partial<SimpleRule>) {
    const next = clauses.map((c, j) => (j === i ? ({ ...(c as SimpleRule), ...patch } as LogicRule) : c))
    emit(combinator, next)
  }

  function addClause() {
    const first = availableFields[0]?.id ?? ''
    if (!first) return
    emit(combinator, [...clauses, { op: 'eq', field: first, value: '' } as LogicRule])
  }

  function removeClause(i: number) {
    emit(combinator, clauses.filter((_, j) => j !== i))
  }

  function emit(comb: 'and' | 'or', list: LogicRule[]) {
    if (list.length === 0) onChange(undefined)
    else if (list.length === 1) onChange(list[0])
    else onChange({ op: comb, rules: list as any })
  }

  if (availableFields.length === 0) {
    return <p className="text-xs text-slate-500">No other fields to reference yet.</p>
  }

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/50 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-600">Show when</span>
        <Select
          className="h-7 w-24 text-xs"
          value={combinator}
          onChange={(e) => setCombinator(e.target.value as 'and' | 'or')}
        >
          <option value="and">all of</option>
          <option value="or">any of</option>
        </Select>
      </div>
      {clauses.length === 0 ? (
        <p className="text-xs text-slate-500">Always visible.</p>
      ) : (
        <ul className="space-y-1.5">
          {clauses.map((c, i) => {
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
                  onChange={(e) =>
                    updateClause(i, {
                      op: e.target.value as SimpleRule['op'],
                      value: OPS.find((o) => o.value === e.target.value)?.takesValue
                        ? clause.value ?? ''
                        : undefined,
                    })
                  }
                >
                  {OPS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                {opMeta?.takesValue ? (
                  <Input
                    className="h-8 flex-1 text-xs"
                    value={String(clause.value ?? '')}
                    onChange={(e) => updateClause(i, { value: e.target.value })}
                  />
                ) : null}
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
        </ul>
      )}
      <Button size="sm" variant="outline" onClick={addClause}>
        <Plus size={12} /> Add clause
      </Button>
    </div>
  )
}

function normalize(rule: LogicRule | undefined): { combinator: 'and' | 'or'; clauses: LogicRule[] } {
  if (!rule) return { combinator: 'and', clauses: [] }
  if ('rules' in rule && (rule.op === 'and' || rule.op === 'or')) {
    return { combinator: rule.op, clauses: rule.rules }
  }
  return { combinator: 'and', clauses: [rule] }
}

export function describeRule(
  rule: LogicRule | undefined,
  fieldLookup: Record<string, string>,
): string {
  if (!rule) return 'Always'
  if ('rules' in rule) {
    return rule.rules.map((r) => describeRule(r, fieldLookup)).join(` ${rule.op === 'or' ? 'OR' : 'AND'} `)
  }
  if ('rule' in rule) return `NOT (${describeRule(rule.rule, fieldLookup)})`
  if (rule.op === 'isSet') return `${fieldLookup[rule.field] ?? rule.field} has value`
  if (rule.op === 'isNotSet') return `${fieldLookup[rule.field] ?? rule.field} is empty`
  return `${fieldLookup[rule.field] ?? rule.field} ${OPS.find((o) => o.value === rule.op)?.label ?? rule.op} ${String(rule.value ?? '')}`
}

export type { LogicRule, FormField }
