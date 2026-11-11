import { describe, expect, it } from 'vitest'
import type { FlatResult, PivotResult } from '@beaconhs/analytics'
import {
  aiCardDocument,
  cardExportFilename,
  flatCardDocument,
  pivotMatrixDocument,
} from './_document'

describe('card export documents', () => {
  it('renders flat results as a printable table', () => {
    const result: FlatResult = {
      shape: 'flat',
      columns: [
        {
          key: 'name',
          label: 'Name',
          role: 'dimension',
          semanticType: 'entity-name',
          dataType: 'string',
        },
        {
          key: 'active',
          label: 'Active',
          role: 'measure',
          semanticType: 'measure',
          dataType: 'boolean',
        },
      ],
      rows: [{ name: 'Alex', active: true }],
      rowCount: 1,
      truncated: false,
    }

    expect(flatCardDocument(result).groups[0]).toMatchObject({
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'active', label: 'Active' },
      ],
      rows: [{ name: 'Alex', active: 'Yes' }],
    })
  })

  it('preserves full pivot matrix structure, RAG cell tokens, and blanks missing sentinels', () => {
    const result: PivotResult = {
      shape: 'pivot',
      rowDimensions: [
        {
          key: 'person',
          label: 'Person',
          role: 'dimension',
          semanticType: 'entity-name',
          dataType: 'string',
        },
      ],
      columnDimensions: [
        {
          key: 'course',
          label: 'Course',
          role: 'dimension',
          semanticType: 'entity-name',
          dataType: 'string',
        },
      ],
      valueMeasures: [
        {
          key: 'status',
          label: 'Status',
          role: 'measure',
          semanticType: 'measure',
          dataType: 'string',
        },
      ],
      rowKeys: [
        { values: ['Bennett, David'], labels: ['Bennett, David'] },
        { values: ['Parker, Jamie'], labels: ['Parker, Jamie'] },
      ],
      columnKeys: [
        { values: ['WHMIS'], labels: ['WHMIS'] },
        { values: ['Working at Heights'], labels: ['Working at Heights'] },
        { values: ['First Aid'], labels: ['First Aid'] },
        { values: ['Confined Space'], labels: ['Confined Space'] },
      ],
      cells: [
        [{ status: 'valid' }, { status: 'missing' }, { status: 'expiring' }, { status: 'expired' }],
        [{ status: 'valid' }, { status: 'valid' }, { status: 'valid' }, { status: 'missing' }],
      ],
      rowCount: 8,
      truncated: false,
    }

    const document = pivotMatrixDocument(result, {}, { searchQuery: 'bennett' })
    expect(document.rowCount).toBe(1)
    expect(document.sections).toHaveLength(1)
    expect(document.sections[0]).toMatchObject({
      rowHeaderLabel: 'Person',
      columns: ['WHMIS', 'Working at Heights', 'First Aid', 'Confined Space'],
      rows: [
        {
          label: 'Bennett, David',
          cells: [
            { value: 'valid', token: 'green' },
            { value: '', token: 'grey' },
            { value: 'expiring', token: 'amber' },
            { value: 'expired', token: 'red' },
          ],
        },
      ],
    })
  })

  it('exports qualification matrix expiry dates, RAG legend, and no-expiry labels like PivotTable', () => {
    const dimension = (key: string, label = key) => ({
      key,
      label,
      role: 'dimension' as const,
      semanticType: 'category' as const,
      dataType: 'string' as const,
    })
    const result: PivotResult = {
      shape: 'pivot',
      rowDimensions: [dimension('person_name', 'Employee'), dimension('person_id')],
      columnDimensions: [dimension('skill_name', 'Skill'), dimension('skill_type_id')],
      valueMeasures: [
        { ...dimension('coverage_status'), role: 'measure' },
        { ...dimension('expires_on'), role: 'measure', dataType: 'date' },
      ],
      rowKeys: [{ values: ['Alex', 'person-id'], labels: ['Alex', 'person-id'] }],
      columnKeys: [
        { values: ['Welding', 'skill-1'], labels: ['Welding', 'skill-1'] },
        { values: ['WHMIS', 'skill-2'], labels: ['WHMIS', 'skill-2'] },
        { values: ['Rigging', 'skill-3'], labels: ['Rigging', 'skill-3'] },
      ],
      cells: [
        [
          { coverage_status: 'valid', expires_on: '2027-10-01' },
          { coverage_status: 'no_expiry', expires_on: null },
          { coverage_status: 'missing', expires_on: null },
        ],
      ],
      rowCount: 1,
      truncated: true,
    }
    const document = pivotMatrixDocument(result, {
      displayValueField: 'expires_on',
      rowLabelField: 'person_name',
      columnLabelField: 'skill_name',
      noExpiryLabel: 'No expiry',
    })
    expect(document.sections).toHaveLength(1)
    expect(document.sections[0]).toMatchObject({
      rowHeaderLabel: 'Employee',
      columns: ['Welding', 'WHMIS', 'Rigging'],
      legend: [
        { label: 'Valid', token: 'green' },
        { label: 'Expiring', token: 'amber' },
        { label: 'Expired', token: 'red' },
      ],
      rows: [
        {
          label: 'Alex',
          cells: [
            { value: '2027-10-01', token: 'green' },
            { value: 'No expiry', token: 'green' },
            { value: '', token: 'grey' },
          ],
        },
      ],
    })
    expect(document.truncatedNotice).toBe(
      'This matrix reached its data limit. Use Filters to narrow the results.',
    )
  })

  it('derives numeric heatmap color scales when vizType is heatmap', () => {
    const result: PivotResult = {
      shape: 'pivot',
      rowDimensions: [
        {
          key: 'site',
          label: 'Site',
          role: 'dimension',
          semanticType: 'entity-name',
          dataType: 'string',
        },
      ],
      columnDimensions: [
        {
          key: 'month',
          label: 'Month',
          role: 'dimension',
          semanticType: 'temporal',
          dataType: 'string',
        },
      ],
      valueMeasures: [
        {
          key: 'count',
          label: 'Incidents',
          role: 'measure',
          semanticType: 'measure',
          dataType: 'number',
        },
      ],
      rowKeys: [{ values: ['Sudbury'], labels: ['Sudbury'] }],
      columnKeys: [
        { values: ['Jan'], labels: ['Jan'] },
        { values: ['Feb'], labels: ['Feb'] },
      ],
      cells: [[{ count: 1 }, { count: 5 }]],
      rowCount: 1,
      truncated: false,
    }

    const document = pivotMatrixDocument(result, {}, { vizType: 'heatmap' })
    expect(document.sections[0]?.rows[0]?.cells[0]?.backgroundColor).toMatch(/^rgba\(/)
    expect(document.sections[0]?.rows[0]?.cells[1]?.backgroundColor).toMatch(/^rgba\(/)
  })

  it('renders AI analysis and creates a safe filename', () => {
    const document = aiCardDocument(
      {
        summary: 'Conditions are stable.',
        points: [{ tone: 'positive', title: 'Good trend', detail: 'Fewer incidents.' }],
      },
      12,
    )
    expect(document.groups[1]?.rows).toEqual([
      { tone: 'positive', point: 'Good trend', detail: 'Fewer incidents.' },
    ])
    expect(cardExportFilename('Training — Matrix!')).toBe('training-matrix')
  })
})
