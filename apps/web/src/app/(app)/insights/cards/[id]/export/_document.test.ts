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
