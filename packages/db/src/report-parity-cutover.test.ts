import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  new URL('../drizzle/0019_report_parity_cutover.sql', import.meta.url),
  'utf8',
)
const trainingSql = readFileSync(
  new URL('../drizzle/0018_training_report_parity.sql', import.meta.url),
  'utf8',
)

describe('report parity cutover', () => {
  it('reconciles owner-role data with FORCE RLS restored before commit', () => {
    for (const [migration, tables] of [
      [trainingSql, ['report_definitions', 'report_schedules']],
      [sql, ['training_courses', 'report_definitions', 'report_schedules']],
    ] as const) {
      for (const table of tables) {
        const relaxAt = migration.indexOf(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`)
        const restoreAt = migration.lastIndexOf(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`)
        expect(relaxAt, `${table} relax`).toBeGreaterThan(-1)
        expect(restoreAt, `${table} restore`).toBeGreaterThan(relaxAt)
      }
    }
  })

  it('repoints tenant-owned built-in duplicates before deleting only system duplicates', () => {
    const repointAt = sql.indexOf('UPDATE "report_schedules" AS schedule')
    const deleteAt = sql.indexOf('DELETE FROM "report_definitions" AS duplicate')

    expect(repointAt).toBeGreaterThan(-1)
    expect(deleteAt).toBeGreaterThan(repointAt)
    expect(sql).toContain('duplicate."kind" = \'built_in\'')
    expect(sql).toContain('canonical."tenant_id" IS NULL')
  })

  it('retires the flat training matrix report and promotes dedicated parity runners', () => {
    expect(trainingSql).not.toContain("'training_certificate_matrix'")
    expect(sql).toContain('"slug" = \'training_certificate_matrix\'')
    expect(sql).toContain("WHEN 'skills_matrix' THEN 'skills_matrix'")
    expect(sql).toContain("WHEN 'corrective_actions_list' THEN 'corrective_actions_list'")
    expect(sql).toContain("WHEN 'ppe_list' THEN 'ppe_list'")
    expect(sql).not.toContain('equipment_roi')
    expect(sql).not.toContain('equipment_charges')
  })
})
