import { describe, expect, it } from 'vitest'
import { compileCustomReport } from '@appkit/reports'
import {
  BEACON_REPORT_SEEDS,
  EXPECTED_BEACON_REPORT_SEED_KEYS,
} from '@beaconhs/db/seed/report-definitions'
import { BEACON_REPORT_CATALOG } from './entities'

const LEGACY_REPORT_REPLACEMENTS = [
  'training_certificates',
  'training_expired_upcoming',
  'training_missing',
  'skills_matrix',
  'skills_expired_upcoming',
  'skills_missing',
  'skills_cwb',
  'ppe_list',
  'ppe_expired_upcoming',
  'compliance_by_entity',
  'compliance_by_person',
  'corrective_actions_list',
  'hazid_signatures',
  'equipment_fleet',
  'equipment_inspections',
  'equipment_oil_change_due',
] as const

describe('Beacon AppKit report catalogue', () => {
  it('compiles every seeded definition through the one AppKit query contract', () => {
    for (const definition of BEACON_REPORT_SEEDS) {
      expect(() =>
        compileCustomReport(
          definition.query,
          '00000000-0000-4000-8000-000000000001',
          BEACON_REPORT_CATALOG,
          { maxRows: 1 },
        ),
      ).not.toThrow()
    }
  })

  it('contains every intended legacy replacement exactly once', () => {
    const keys = new Set(EXPECTED_BEACON_REPORT_SEED_KEYS)
    expect(EXPECTED_BEACON_REPORT_SEED_KEYS).toHaveLength(keys.size)
    expect(BEACON_REPORT_SEEDS).toHaveLength(31)
    for (const key of LEGACY_REPORT_REPLACEMENTS) expect(keys.has(key)).toBe(true)
  })

  it('does not duplicate the Training Matrix insight or seed excluded financial reports', () => {
    const searchable = BEACON_REPORT_SEEDS.map(
      (definition) => `${definition.seedKey} ${definition.slug} ${definition.name}`,
    ).join(' ')
    expect(searchable).not.toMatch(/\btraining[ _-]matrix\b/i)
    expect(searchable).not.toMatch(/\b(equipment[ _-])?(charges?|roi)\b/i)
  })

  it('exposes the employee, course, department, and group dimensions required by training parity', () => {
    const matrix = BEACON_REPORT_CATALOG.entities.find((entity) => entity.key === 'training_matrix')
    expect(matrix).toBeDefined()
    const columns = matrix?.columns.map((column) => column.key) ?? []
    expect(columns).toEqual(
      expect.arrayContaining([
        'person_id',
        'employee_no',
        'person_name',
        'course_id',
        'course_code',
        'course_name',
        'course_type',
        'delivery_type',
        'department_id',
        'department_name',
        'group_id_list',
      ]),
    )
  })
})
