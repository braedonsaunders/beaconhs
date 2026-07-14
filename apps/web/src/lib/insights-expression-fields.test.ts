import { describe, expect, it } from 'vitest'
import {
  filterInsightsExpressionFields,
  insightsExpressionFieldLabel,
  type InsightsExpressionField,
} from './insights-expression-fields'

describe('Insights expression field palette', () => {
  it('finds fields by label, relation group, qualified label, and key', () => {
    const fields: InsightsExpressionField[] = [
      { value: 'site.name', label: 'Name', group: 'Site' },
      { value: 'reference', label: 'Reference' },
    ]
    expect(filterInsightsExpressionFields(fields, 'site')).toEqual([fields[0]])
    expect(filterInsightsExpressionFields(fields, 'site → name')).toEqual([fields[0]])
    expect(filterInsightsExpressionFields(fields, 'reference')).toEqual([fields[1]])
    expect(insightsExpressionFieldLabel(fields[0]!)).toBe('Site → Name')
  })

  it('does not silently truncate a large matching schema', () => {
    const fields = Array.from({ length: 120 }, (_, index) => ({
      value: `field_${index}`,
      label: `Field ${index}`,
    }))
    expect(filterInsightsExpressionFields(fields, 'field')).toHaveLength(120)
  })
})
