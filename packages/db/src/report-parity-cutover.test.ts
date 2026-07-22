import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  new URL('../drizzle/0019_report_parity_cutover.sql', import.meta.url),
  'utf8',
)

describe('report parity cutover', () => {
  it('repoints tenant-owned built-in duplicates before deleting only system duplicates', () => {
    const repointAt = sql.indexOf('UPDATE "report_schedules" AS schedule')
    const deleteAt = sql.indexOf('DELETE FROM "report_definitions" AS duplicate')

    expect(repointAt).toBeGreaterThan(-1)
    expect(deleteAt).toBeGreaterThan(repointAt)
    expect(sql).toContain('duplicate."kind" = \'built_in\'')
    expect(sql).toContain('canonical."tenant_id" IS NULL')
  })

  it('retires the flat training matrix report and promotes dedicated parity runners', () => {
    expect(sql).toContain('"slug" = \'training_certificate_matrix\'')
    expect(sql).toContain("WHEN 'skills_matrix' THEN 'skills_matrix'")
    expect(sql).toContain("WHEN 'corrective_actions_list' THEN 'corrective_actions_list'")
    expect(sql).toContain("WHEN 'ppe_list' THEN 'ppe_list'")
    expect(sql).not.toContain('equipment_roi')
    expect(sql).not.toContain('equipment_charges')
  })
})
