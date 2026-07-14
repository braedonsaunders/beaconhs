import { describe, expect, it } from 'vitest'
import { REPORT_VIEWS_SQL } from './views'

describe('reporting view cutover', () => {
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
})
