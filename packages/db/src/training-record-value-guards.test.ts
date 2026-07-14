import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { trainingRecords, trainingSkillAssignmentFiles } from './schema'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const migrationSql = readProductionCutoverSection('0021_training_record_value_guards.sql')

describe('training record value guards', () => {
  it('models grade and skill-file kind checks in the canonical schema', () => {
    expect(getTableConfig(trainingRecords).checks.map((check) => check.name)).toContain(
      'training_records_grade_ck',
    )
    expect(
      getTableConfig(trainingSkillAssignmentFiles).checks.map((check) => check.name),
    ).toContain('training_skill_assignment_files_kind_ck')
  })

  it('fails closed on invalid existing rows before installing constraints', () => {
    const gradePreflight = migrationSql.indexOf('Cannot install training_records_grade_ck')
    const gradeConstraint = migrationSql.indexOf('ADD CONSTRAINT "training_records_grade_ck"')
    const kindPreflight = migrationSql.indexOf(
      'Cannot install training_skill_assignment_files_kind_ck',
    )
    const kindConstraint = migrationSql.indexOf(
      'ADD CONSTRAINT "training_skill_assignment_files_kind_ck"',
    )
    expect(gradePreflight).toBeGreaterThan(-1)
    expect(gradeConstraint).toBeGreaterThan(gradePreflight)
    expect(kindPreflight).toBeGreaterThan(-1)
    expect(kindConstraint).toBeGreaterThan(kindPreflight)
    expect(migrationSql).not.toMatch(/UPDATE\s+training_records/i)
    expect(migrationSql).not.toMatch(/UPDATE\s+training_skill_assignment_files/i)
  })

  it('uses a staged validation path with no unvalidated end state', () => {
    for (const constraint of [
      'training_records_grade_ck',
      'training_skill_assignment_files_kind_ck',
    ]) {
      expect(migrationSql).toContain(`CONSTRAINT "${constraint}"`)
      expect(migrationSql).toContain(`VALIDATE CONSTRAINT "${constraint}"`)
    }
    expect(migrationSql.match(/NOT VALID/g)).toHaveLength(2)
  })
})
