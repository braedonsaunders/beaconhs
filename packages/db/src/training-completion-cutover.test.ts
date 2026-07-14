import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { ATTACHMENT_TENANT_REFERENCES } from './attachment-integrity'
import {
  tenantUsers,
  trainingCertificates,
  trainingClassAttendees,
  trainingRecords,
  trainingSkillCertificates,
} from './schema'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const migrationSql = readProductionCutoverSection('0020_training_completion_cutover.sql')

function indexColumns(table: Parameters<typeof getTableConfig>[0], name: string): string[] {
  const index = getTableConfig(table).indexes.find((candidate) => candidate.config.name === name)
  if (!index) throw new Error(`Missing index ${name}`)
  return index.config.columns.map((column) =>
    'name' in column ? (column.name ?? 'expression') : 'expression',
  )
}

describe('training completion clean cutover', () => {
  it('models persisted reviewed decisions and class-level uniqueness', () => {
    const attendee = getTableConfig(trainingClassAttendees)
    expect(attendee.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'completion_attended',
        'completion_passed',
        'completion_grade',
        'completion_reviewed_at',
        'completion_reviewed_by_tenant_user_id',
      ]),
    )
    expect(
      indexColumns(trainingClassAttendees, 'training_class_attendees_tenant_class_person_ux'),
    ).toEqual(['tenant_id', 'class_id', 'person_id'])
    expect(indexColumns(trainingRecords, 'training_records_active_class_person_ux')).toEqual([
      'tenant_id',
      'class_id',
      'person_id',
    ])

    const reviewerFk = attendee.foreignKeys
      .map((foreignKey) => foreignKey.reference())
      .find((reference) =>
        reference.columns.some((column) => column.name === 'completion_reviewed_by_tenant_user_id'),
      )
    expect(reviewerFk?.columns.map((column) => column.name)).toEqual([
      'tenant_id',
      'completion_reviewed_by_tenant_user_id',
    ])
    expect(reviewerFk?.foreignColumns.map((column) => column.name)).toEqual(['tenant_id', 'id'])
    expect(reviewerFk && getTableConfig(reviewerFk.foreignTable).name).toBe(
      getTableConfig(tenantUsers).name,
    )
    expect(attendee.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'training_class_attendees_completion_grade_ck',
        'training_class_attendees_completion_review_ck',
      ]),
    )
  })

  it('retires both generated-PDF shadow columns from schema and attachment manifest', () => {
    expect(getTableConfig(trainingCertificates).columns.map((column) => column.name)).not.toContain(
      'pdf_attachment_id',
    )
    expect(
      getTableConfig(trainingSkillCertificates).columns.map((column) => column.name),
    ).not.toContain('pdf_attachment_id')
    const references = ATTACHMENT_TENANT_REFERENCES.map(({ table, column }) => `${table}.${column}`)
    expect(references).not.toContain('training_certificates.pdf_attachment_id')
    expect(references).not.toContain('training_skill_certificates.pdf_attachment_id')
  })

  it('fails closed before uniqueness changes and never silently deduplicates', () => {
    expect(migrationSql).toContain('duplicate class attendees exist')
    expect(migrationSql).toContain('a class roster exceeds 1000 attendees')
    expect(migrationSql).toContain('duplicate active class records exist')
    expect(migrationSql).not.toMatch(/DELETE FROM training_class_attendees/i)
    expect(migrationSql).not.toMatch(/DELETE FROM training_records/i)
    expect(migrationSql.indexOf('duplicate class attendees exist')).toBeLessThan(
      migrationSql.indexOf('training_class_attendees_tenant_class_person_ux'),
    )
  })

  it('deletes only exact historical artifacts and proves durable object cleanup', () => {
    expect(migrationSql).toContain("audit.action = 'export'")
    expect(migrationSql).toContain(
      "audit.entity_type IN ('training_certificate', 'training_skill_certificate')",
    )
    expect(migrationSql).toContain("audit.metadata ->> 'certificateAttachmentId'")
    expect(migrationSql).toContain("audit.metadata ->> 'walletAttachmentId'")
    expect(migrationSql).not.toMatch(/filename\s+(?:LIKE|~)/i)
    expect(migrationSql).toContain("fk.confrelid = 'public.attachments'::regclass")
    expect(migrationSql).toContain('candidate is reused in JSON data')
    expect(migrationSql).toContain('DELETE FROM attachments AS attachment')
    expect(migrationSql).toContain('storage_object_deletion_outbox AS deletion')
    expect(migrationSql).toContain('expected % durable deletion intents')

    const deleteAt = migrationSql.indexOf('DELETE FROM attachments AS attachment')
    const queueProofAt = migrationSql.indexOf('expected % durable deletion intents')
    const firstDropAt = migrationSql.indexOf('DROP COLUMN "pdf_attachment_id"')
    expect(deleteAt).toBeGreaterThan(0)
    expect(queueProofAt).toBeGreaterThan(deleteAt)
    expect(firstDropAt).toBeGreaterThan(queueProofAt)
  })

  it('adds new relationships and checks without an unvalidated cutover window', () => {
    for (const constraint of [
      'training_class_attendees_tenant_completion_reviewer_fk',
      'training_class_attendees_completion_grade_ck',
      'training_class_attendees_completion_review_ck',
    ]) {
      expect(migrationSql).toContain(`CONSTRAINT "${constraint}"`)
      expect(migrationSql).toContain(`VALIDATE CONSTRAINT "${constraint}"`)
    }
    expect(migrationSql).toContain('NOT VALID')
  })
})
