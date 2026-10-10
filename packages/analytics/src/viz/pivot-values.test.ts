import { describe, expect, it } from 'vitest'
import { pivotAxisLabel, pivotDisplayValue } from './pivot-values'
import type { ResultColumn } from '../result'

const settings = { displayValueField: 'expires_on', noExpiryLabel: 'No expiry' }
describe('qualification pivot display', () => {
  it('shows expiry without replacing the status used for colors', () => {
    const cell = { coverage_status: 'expired', expires_on: '2026-10-01' }
    expect(pivotDisplayValue(cell, 'coverage_status', settings)).toBe('2026-10-01')
    expect(cell.coverage_status).toBe('expired')
    expect(
      pivotDisplayValue({ coverage_status: 'missing' }, 'coverage_status', settings),
    ).toBeNull()
    expect(
      pivotDisplayValue(
        { coverage_status: 'valid', expires_on: null },
        'coverage_status',
        settings,
      ),
    ).toBe('No expiry')
    expect(
      pivotDisplayValue(
        { coverage_status: 'expired', expires_on: null },
        'coverage_status',
        settings,
      ),
    ).toBe('expired')
  })

  it('keeps UUIDs in the axis identity while showing only the name', () => {
    const dimensions: ResultColumn[] = ['name', 'id'].map((key) => ({
      key,
      label: key,
      role: 'dimension',
      semanticType: 'category',
      dataType: 'string',
    }))
    const axis = { values: ['Alex', 'unique-id'], labels: ['Alex', 'unique-id'] }
    expect(pivotAxisLabel(axis, dimensions, 'name')).toBe('Alex')
    expect(axis.values).toEqual(['Alex', 'unique-id'])
  })
})
