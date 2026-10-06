import { describe, expect, it } from 'vitest'
import type { ReportRunResult } from '@braedonsaunders/appkit-reports'
import { withDomainCellTones } from './cell-tones'

// The Training — Missing report listed expired people identically to everyone
// else, so the rows that needed acting on were indistinguishable from the ones
// already handled. Colouring is only useful if it means the same thing on every
// surface, so the rules are attached to the run result rather than to a view.

function resultWith(columns: ReportRunResult['groups'][number]['columns']): ReportRunResult {
  return {
    groups: [{ kind: 'results', title: 'G', columns, rows: [] }],
    summary: [],
    rowCount: 0,
    truncated: false,
    durationMs: 1,
  } as ReportRunResult
}

describe('withDomainCellTones', () => {
  it('colours training coverage by urgency', () => {
    const out = withDomainCellTones(
      resultWith([{ key: 'coverage_status', label: 'Coverage', semanticType: 'category' }]),
    )
    const column = out.groups[0]!.columns[0]!
    expect(column.tones).toEqual({
      expired: 'critical',
      missing: 'critical',
      expiring: 'warning',
      valid: 'positive',
    })
  })

  it('distinguishes bookings from earned certificate coverage', () => {
    const out = withDomainCellTones(
      resultWith([
        { key: 'booking_coverage_status', label: 'Coverage', semanticType: 'category' },
        { key: 'coverage_status', label: 'Certificate coverage', semanticType: 'category' },
      ]),
    )
    expect(out.groups[0]!.columns[0]!.tones?.booked).toBe('info')
    expect(out.groups[0]!.columns[1]!.tones?.booked).toBeUndefined()
  })

  it('leaves columns it has no opinion about untouched', () => {
    const out = withDomainCellTones(
      resultWith([{ key: 'person_name', label: 'Person', semanticType: 'category' }]),
    )
    const column = out.groups[0]!.columns[0]!
    expect(column.tones).toBeUndefined()
  })

  it('does not mutate the result it is given', () => {
    const input = resultWith([
      { key: 'coverage_status', label: 'Coverage', semanticType: 'category' },
    ])
    const before = JSON.stringify(input)
    withDomainCellTones(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('keeps every other column property', () => {
    const out = withDomainCellTones(
      resultWith([{ key: 'result', label: 'Result', semanticType: 'category', align: 'center' }]),
    )
    const column = out.groups[0]!.columns[0]!
    expect(column).toMatchObject({ key: 'result', label: 'Result', align: 'center' })
  })
})
