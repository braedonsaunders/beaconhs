import { describe, expect, it } from 'vitest'
import { BEACON_REPORT_SEEDS } from '@beaconhs/db/seed/report-definitions'
import type { ReportRunResult } from '@braedonsaunders/appkit-reports'
import { cwbRosterResult, isCwbRoster } from './cwb-roster'

describe('CWB monthly roster', () => {
  it('uses the native roster only for the CWB qualification query', () => {
    const query = BEACON_REPORT_SEEDS.find((seed) => seed.seedKey === 'skills_cwb')!.query
    expect(isCwbRoster(query)).toBe(true)
    expect(isCwbRoster({ ...query, filters: { combinator: 'and', rules: [] } })).toBe(false)
  })
  it('preserves separate qualifications while counting each welder once per standard', () => {
    const input: ReportRunResult = {
      groups: ['W47.1', 'W47.2'].map((title) => ({
        kind: 'results',
        title,
        columns: [{ key: 'person_name', label: 'First & last name', semanticType: 'category' }],
        rows: [
          { person_name: 'Kevin Geerts', cwb_process: 'SMAW' },
          { person_name: 'Kevin Geerts', cwb_process: 'GMAW' },
        ],
      })),
      summary: [],
      rowCount: 4,
      truncated: false,
      durationMs: 1,
    }
    const result = cwbRosterResult(
      input,
      {
        name: 'Rassaun Services Inc.',
        address: '22 Boswell Drive',
        accountNumber: 'RASSA1,RASSA2',
      },
      new Date('2026-10-09T14:00:00Z'),
    )
    expect(result.groups).toHaveLength(7)
    expect(result.groups[3]!.subtitle).toContain('Company code: RASSA1')
    expect(result.groups[3]!.subtitle).toContain('Total # of welders employed: 1')
    expect(result.groups[5]!.subtitle).toContain('Company code: RASSA2')
    expect(
      result.groups[3]!.rows.map((row) => (row as Record<string, unknown>).row_number),
    ).toEqual([1, 2])
    expect(result.groups[0]!.rows[0]!.company).toBe('RASSAUN SERVICES INC.')
    expect(input.groups).toHaveLength(2)
    expect(input.groups[0]!.rows[0]).not.toHaveProperty('row_number')
  })
})
