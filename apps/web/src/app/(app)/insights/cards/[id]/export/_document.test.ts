import { describe, expect, it } from 'vitest'
import type { FlatResult, PivotResult } from '@beaconhs/analytics'
import { aiCardDocument, cardExportFilename, cardResultDocument } from './_document'

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

    expect(cardResultDocument(result).groups[0]).toMatchObject({
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'active', label: 'Active' },
      ],
      rows: [{ name: 'Alex', active: 'Yes' }],
    })
  })

  it('splits a wide pivot and blanks legacy missing sentinels', () => {
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
      rowKeys: [{ values: ['Alex'], labels: ['Alex'] }],
      columnKeys: Array.from({ length: 9 }, (_, index) => ({
        values: [`Course ${index + 1}`],
        labels: [`Course ${index + 1}`],
      })),
      cells: [
        Array.from({ length: 9 }, (_, index) => ({
          status: index === 0 ? 'missing' : 'valid',
        })),
      ],
      rowCount: 9,
      truncated: false,
    }

    const document = cardResultDocument(result)
    expect(document.groups).toHaveLength(2)
    expect(document.groups[0]?.rows[0]?.value_0).toBe('')
    expect(document.groups[1]?.columns).toEqual([
      expect.objectContaining({ label: 'Person' }),
      expect.objectContaining({ label: 'Course 9' }),
    ])
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

it('exports dates and readable names once, retaining all matching rows', () => {
  const dimension = (key: string) => ({
    key,
    label: key,
    role: 'dimension' as const,
    semanticType: 'category' as const,
    dataType: 'string' as const,
  })
  const result: PivotResult = {
    shape: 'pivot',
    rowDimensions: [dimension('person_name'), dimension('person_id')],
    columnDimensions: [dimension('skill_name'), dimension('skill_type_id')],
    valueMeasures: [
      { ...dimension('coverage_status'), role: 'measure' },
      { ...dimension('expires_on'), role: 'measure', dataType: 'date' },
    ],
    rowKeys: [{ values: ['Alex', 'person-id'], labels: ['Alex', 'person-id'] }],
    columnKeys: [{ values: ['Welding', 'skill-id'], labels: ['Welding', 'skill-id'] }],
    cells: [[{ coverage_status: 'valid', expires_on: '2027-10-01' }]],
    rowCount: 1,
    truncated: false,
  }
  const document = cardResultDocument(result, {
    displayValueField: 'expires_on',
    rowLabelField: 'person_name',
    columnLabelField: 'skill_name',
  })
  expect(document.groups).toHaveLength(1)
  expect(document.groups[0]?.columns.map((column) => column.label)).toEqual([
    'person_name',
    'Welding',
  ])
  expect(document.groups[0]?.rows).toEqual([{ row_person_name: 'Alex', value_0: '2027-10-01' }])
})
