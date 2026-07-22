import { describe, expect, it } from 'vitest'
import { readProductionCutoverSection } from './test/read-production-cutover-section'
import { REPORT_VIEWS_SQL } from './views'

describe('reporting view cutover', () => {
  it('appends skill report columns after the installed view shape', () => {
    const skills = REPORT_VIEWS_SQL.find((statement) =>
      statement.includes('CREATE OR REPLACE VIEW report_skill_assignments'),
    )
    expect(skills).toBeDefined()

    const installedTailAt = skills?.indexOf('END AS status') ?? -1
    const appendedColumnsAt = skills?.indexOf('AS cwb_standard') ?? -1
    expect(installedTailAt).toBeGreaterThan(-1)
    expect(appendedColumnsAt).toBeGreaterThan(installedTailAt)
  })

  it('reads equipment type categories through the canonical catalog relation', () => {
    const fleet = REPORT_VIEWS_SQL.find((statement) =>
      statement.includes('CREATE OR REPLACE VIEW report_equipment_fleet'),
    )
    expect(fleet).toBeDefined()
    expect(fleet).toContain('type_category.name                   AS type_category')
    expect(fleet).toContain('LEFT JOIN equipment_categories type_category')
    expect(fleet).toContain('type_category.id = t.category_id')
    expect(fleet).not.toContain('t.category                           AS type_category')
  })

  it('exposes assigned training and legacy-parity runtime filter fields', () => {
    const training = REPORT_VIEWS_SQL.find((statement) =>
      statement.includes('CREATE OR REPLACE VIEW report_training_matrix'),
    )
    expect(training).toBeDefined()
    expect(training).toContain('p.department_id                   AS department_id')
    expect(training).toContain('c.delivery_type                   AS delivery_type')
    expect(training).toContain('AS group_ids')
    expect(training).toContain('FROM compliance_status cs')
    expect(training).toContain('AS is_required')
    expect(training).toContain('c.course_type                     AS course_type')
    expect(training?.indexOf('AS course_type')).toBeGreaterThan(
      training?.indexOf('AS is_required') ?? -1,
    )
  })

  it('retires the installed legacy fleet view before dropping its source column', () => {
    const migration = readProductionCutoverSection('0033_physical_schema_convergence.sql')
    const dropViewAt = migration.indexOf('DROP VIEW IF EXISTS "report_equipment_fleet"')
    const dropColumnAt = migration.indexOf('ALTER TABLE "equipment_types" DROP COLUMN "category"')

    expect(dropViewAt).toBeGreaterThan(-1)
    expect(dropColumnAt).toBeGreaterThan(dropViewAt)
  })
})
