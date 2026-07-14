import { describe, expect, it } from 'vitest'
import { parseBhqlQuery, type AnalyticsEntity } from '@beaconhs/analytics'
import type { ReportCustomQuery } from '@beaconhs/db/schema'
import {
  customFieldAnalyticsColumn,
  entityMapWithoutCustomField,
  reportQueryReferencesCustomField,
} from './analytics-dependency-policy'

describe('custom-field analytics dependency policy', () => {
  it('uses the stable synthetic column namespace', () => {
    expect(customFieldAnalyticsColumn('inspection_due')).toBe('cf_inspection_due')
  })

  it.each([
    { columns: ['cf_risk'] },
    { columns: ['id'], breakouts: [{ column: 'cf_risk' }] },
    { columns: ['id'], measures: [{ fn: 'sum' as const, column: 'cf_risk' }] },
    { columns: ['id'], groupBy: 'cf_risk' },
    { columns: ['id'], sort: { column: 'cf_risk', direction: 'asc' as const } },
    {
      columns: ['id'],
      filters: {
        combinator: 'and' as const,
        rules: [
          {
            combinator: 'or' as const,
            rules: [{ field: 'cf_risk', op: 'eq' as const, value: 'high' }],
          },
        ],
      },
    },
  ] satisfies Partial<ReportCustomQuery>[])('finds a report reference: %#', (fragment) => {
    const { columns = [], ...rest } = fragment
    const query: ReportCustomQuery = {
      entity: 'equipment_items',
      columns,
      ...rest,
    }
    expect(reportQueryReferencesCustomField(query, 'equipment', 'risk')).toBe(true)
  })

  it('does not confuse the same custom key on another entity', () => {
    const query: ReportCustomQuery = {
      entity: 'people',
      columns: ['cf_risk'],
    }
    expect(reportQueryReferencesCustomField(query, 'equipment', 'risk')).toBe(false)
    expect(reportQueryReferencesCustomField(query, 'person', 'risk')).toBe(true)
  })

  it('removes only the selected owner column without mutating the source map', () => {
    const equipment = {
      key: 'equipment_items',
      label: 'Equipment',
      category: 'Equipment',
      description: '',
      table: 'equipment_items',
      columns: [
        {
          key: 'id',
          label: 'ID',
          kind: 'uuid',
          semanticType: 'pk',
          canDimension: true,
          canMeasure: false,
          canBinTemporal: false,
          canBinNumeric: false,
        },
        {
          key: 'cf_risk',
          label: 'Risk',
          kind: 'text',
          semanticType: 'category',
          canDimension: true,
          canMeasure: false,
          canBinTemporal: false,
          canBinNumeric: false,
        },
      ],
    } satisfies AnalyticsEntity
    const people = {
      ...equipment,
      key: 'people',
      label: 'People',
      table: 'people',
    } satisfies AnalyticsEntity
    const source = { equipment_items: equipment, people }

    const result = entityMapWithoutCustomField(source, 'equipment', 'risk')

    expect(result.equipment_items?.columns.map(({ key }) => key)).toEqual(['id'])
    expect(result.people).toBe(people)
    expect(source.equipment_items.columns).toHaveLength(2)

    const equipmentQuery = {
      version: 'bhql/1' as const,
      stages: [{ source: 'equipment_items', columns: ['cf_risk'] }],
      display: 'table' as const,
    }
    const peopleQuery = {
      ...equipmentQuery,
      stages: [{ source: 'people', columns: ['cf_risk'] }],
    }
    expect(() => parseBhqlQuery(equipmentQuery, source)).not.toThrow()
    expect(() => parseBhqlQuery(equipmentQuery, result)).toThrow(/Unknown (?:field|column)/)
    expect(() => parseBhqlQuery(peopleQuery, result)).not.toThrow()
  })
})
