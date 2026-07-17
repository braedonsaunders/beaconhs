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

  it('retires the installed legacy fleet view before dropping its source column', () => {
    const migration = readProductionCutoverSection('0033_physical_schema_convergence.sql')
    const dropViewAt = migration.indexOf('DROP VIEW IF EXISTS "report_equipment_fleet"')
    const dropColumnAt = migration.indexOf('ALTER TABLE "equipment_types" DROP COLUMN "category"')

    expect(dropViewAt).toBeGreaterThan(-1)
    expect(dropColumnAt).toBeGreaterThan(dropViewAt)
  })
})
