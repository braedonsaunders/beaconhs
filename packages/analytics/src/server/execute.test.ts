import { describe, expect, it } from 'vitest'
import type { BhqlPivot } from '@beaconhs/db/schema'
import type { FlatResult, ResultColumn } from '../result'
import { reshapePivot } from './execute'

const dimension = (key: string): ResultColumn => ({
  key,
  label: key,
  role: 'dimension',
  semanticType: 'category',
  dataType: 'string',
})

const measure: ResultColumn = {
  key: 'status',
  label: 'Status',
  role: 'measure',
  semanticType: 'measure',
  dataType: 'string',
}

const pivot: BhqlPivot = {
  rows: [{ breakout: 'person' }],
  columns: [{ breakout: 'course' }],
  values: [{ measure: 'status' }],
}

describe('reshapePivot', () => {
  it('drops an empty column tuple instead of rendering a none column', () => {
    const flat: FlatResult = {
      shape: 'flat',
      columns: [dimension('person'), dimension('course'), measure],
      rows: [
        { person: 'Alex', course: null, status: 'missing' },
        { person: 'Alex', course: 'WHMIS', status: 'valid' },
      ],
      rowCount: 2,
      truncated: false,
    }

    const result = reshapePivot(flat, pivot)

    expect(result.columnKeys).toEqual([{ values: ['WHMIS'], labels: ['WHMIS'] }])
    expect(result.cells).toEqual([[{ status: 'valid' }]])
  })

  it('retains a partially populated multi-dimension column tuple', () => {
    const multiPivot: BhqlPivot = {
      ...pivot,
      columns: [{ breakout: 'course' }, { breakout: 'level' }],
    }
    const flat: FlatResult = {
      shape: 'flat',
      columns: [dimension('person'), dimension('course'), dimension('level'), measure],
      rows: [{ person: 'Alex', course: 'WHMIS', level: null, status: 'valid' }],
      rowCount: 1,
      truncated: false,
    }

    expect(reshapePivot(flat, multiPivot).columnKeys).toEqual([
      { values: ['WHMIS', null], labels: ['WHMIS', '(none)'] },
    ])
  })
})
