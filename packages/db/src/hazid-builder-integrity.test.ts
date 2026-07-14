import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  formResponses,
  formTemplates,
  hazidAssessmentAppResponses,
  hazidAssessmentTypeApps,
} from './schema'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const migrationSql = readProductionCutoverSection('0007_pink_marvex.sql')

function foreignKeySignatures(table: Parameters<typeof getTableConfig>[0]): Map<string, string> {
  return new Map(
    getTableConfig(table).foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference()
      const parent = getTableConfig(reference.foreignTable).name
      const localColumns = reference.columns.map((column) => column.name).join(',')
      const parentColumns = reference.foreignColumns.map((column) => column.name).join(',')
      return [`${localColumns}->${parent}.${parentColumns}`, foreignKey.onDelete ?? 'no action']
    }),
  )
}

describe('HazID Builder relational integrity', () => {
  it('uses tenant/template composite keys for every Builder edge', () => {
    const typeAppForeignKeys = foreignKeySignatures(hazidAssessmentTypeApps)
    const responseForeignKeys = foreignKeySignatures(hazidAssessmentAppResponses)

    expect(typeAppForeignKeys.get('tenant_id,template_id->form_templates.tenant_id,id')).toBe(
      'cascade',
    )
    expect(responseForeignKeys.get('tenant_id,template_id->form_templates.tenant_id,id')).toBe(
      'cascade',
    )
    expect(
      responseForeignKeys.get(
        'tenant_id,template_id,response_id->form_responses.tenant_id,template_id,id',
      ),
    ).toBe('cascade')

    expect(typeAppForeignKeys.has('template_id->form_templates.id')).toBe(false)
    expect(responseForeignKeys.has('template_id->form_templates.id')).toBe(false)
    expect(responseForeignKeys.has('response_id->form_responses.id')).toBe(false)
    expect(responseForeignKeys.has('type_app_id->hazid_assessment_type_apps.id')).toBe(false)

    const parentKeys = getTableConfig(hazidAssessmentTypeApps)
      .indexes.filter((index) => index.config.unique)
      .map((index) => index.config.columns.map((column) => ('name' in column ? column.name : '')))
    expect(parentKeys).toContainEqual(['tenant_id', 'template_id', 'id'])

    const formTemplateKeys = getTableConfig(formTemplates)
      .indexes.filter((index) => index.config.unique)
      .map((index) => index.config.columns.map((column) => ('name' in column ? column.name : '')))
    expect(formTemplateKeys).toContainEqual(['tenant_id', 'id'])

    const formResponseKeys = getTableConfig(formResponses)
      .indexes.filter((index) => index.config.unique)
      .map((index) => index.config.columns.map((column) => ('name' in column ? column.name : '')))
    expect(formResponseKeys).toContainEqual(['tenant_id', 'template_id', 'id'])
  })

  it('preserves historical links with a tenant-safe partial SET NULL key', () => {
    const constraint = 'hazid_assessment_app_responses_tenant_template_type_app_fk'
    expect(constraint.length).toBeLessThanOrEqual(63)
    expect(migrationSql).toContain(
      `CONSTRAINT "${constraint}" FOREIGN KEY ("tenant_id","template_id","type_app_id")`,
    )
    expect(migrationSql).toContain(
      'REFERENCES "public"."hazid_assessment_type_apps"("tenant_id","template_id","id") ON DELETE SET NULL ("type_app_id")',
    )
    expect(migrationSql).toContain(`VALIDATE CONSTRAINT "${constraint}"`)

    const validateAt = migrationSql.indexOf(`VALIDATE CONSTRAINT "${constraint}"`)
    const legacyDropAt = migrationSql.indexOf(
      'DROP CONSTRAINT "hazid_assessment_app_responses_type_app_id_hazid_assessment_type_apps_id_fk"',
    )
    expect(validateAt).toBeGreaterThanOrEqual(0)
    expect(legacyDropAt).toBeGreaterThan(validateAt)
  })

  it('fails migration preflight on orphaned or mismatched bridge rows', () => {
    expect(migrationSql).toContain('HazID Builder-link integrity preflight failed')
    expect(migrationSql).toContain('hazid_assessment_type_apps.template')
    expect(migrationSql).toContain('hazid_assessment_app_responses.template')
    expect(migrationSql).toContain('hazid_assessment_app_responses.response')
    expect(migrationSql).toContain('hazid_assessment_app_responses.type_app')
    expect(migrationSql).toContain('parent."id" IS NULL')
    expect(migrationSql).toContain('child."tenant_id" IS DISTINCT FROM parent."tenant_id"')
    expect(migrationSql).toContain('child."template_id" IS DISTINCT FROM parent."template_id"')
  })
})
