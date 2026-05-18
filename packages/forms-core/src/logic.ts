import type { LogicRule } from './schema'

export type FieldValues = Record<string, unknown>

export function evalLogicRule(rule: LogicRule, values: FieldValues): boolean {
  switch (rule.op) {
    case 'and':
      return rule.rules.every((r) => evalLogicRule(r, values))
    case 'or':
      return rule.rules.some((r) => evalLogicRule(r, values))
    case 'not':
      return !evalLogicRule(rule.rule, values)
    case 'eq':
      return values[rule.field] === rule.value
    case 'ne':
      return values[rule.field] !== rule.value
    case 'gt':
      return Number(values[rule.field]) > Number(rule.value)
    case 'lt':
      return Number(values[rule.field]) < Number(rule.value)
    case 'gte':
      return Number(values[rule.field]) >= Number(rule.value)
    case 'lte':
      return Number(values[rule.field]) <= Number(rule.value)
    case 'in':
      return rule.value.includes(values[rule.field])
    case 'notIn':
      return !rule.value.includes(values[rule.field])
    case 'isSet': {
      const v = values[rule.field]
      return v !== undefined && v !== null && v !== ''
    }
    case 'isNotSet': {
      const v = values[rule.field]
      return v === undefined || v === null || v === ''
    }
  }
}
