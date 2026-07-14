import { readFileSync } from 'node:fs'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { emailTemplates, pdfTemplates, trainingContentItems, trainingLessons } from './schema'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const trainingCutoverSql = readProductionCutoverSection('0005_watery_blizzard.sql')
const templateCutoverSql = readProductionCutoverSection('0014_natural_captain_marvel.sql')
const pdfSeedSource = readFileSync(new URL('./seed/pdf-templates.ts', import.meta.url), 'utf8')

function columnNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).columns.map((column) => column.name)
}

describe('source-only template cutover', () => {
  it('keeps only canonical editable source columns in schema metadata', () => {
    expect(columnNames(emailTemplates)).toContain('source_html')
    expect(columnNames(emailTemplates)).not.toContain('mjml_source')
    expect(columnNames(emailTemplates)).not.toContain('design')
    expect(columnNames(pdfTemplates)).toContain('source_html')
    expect(columnNames(pdfTemplates)).not.toContain('design')
    expect(columnNames(trainingLessons)).toContain('content_html')
    expect(columnNames(trainingLessons)).not.toContain('content_json')
    expect(columnNames(trainingContentItems)).toContain('content_html')
    expect(columnNames(trainingContentItems)).not.toContain('content_json')
  })

  it('preflights meaningful training JSON before either idempotent drop', () => {
    expect(trainingCutoverSql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(trainingCutoverSql).toContain('meaningful legacy row(s) have no canonical content_html')
    expect(templateCutoverSql).not.toContain('training_content_items')
    expect(templateCutoverSql).not.toContain('training_lessons')
    for (const table of ['training_content_items', 'training_lessons']) {
      const relaxAt = trainingCutoverSql.indexOf(
        `ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`,
      )
      const errorAt = trainingCutoverSql.indexOf(
        'meaningful legacy row(s) have no canonical content_html',
      )
      const restoreAt = trainingCutoverSql.indexOf(
        `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
      )
      const dropAt = trainingCutoverSql.indexOf(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "content_json"`,
      )
      expect(errorAt).toBeGreaterThan(relaxAt)
      expect(restoreAt).toBeGreaterThan(errorAt)
      expect(dropAt).toBeGreaterThan(restoreAt)
    }
  })

  it('renames email HTML losslessly and fails closed on conflicting coexistence', () => {
    expect(templateCutoverSql).toContain(
      'Cannot converge email template HTML columns: % row(s) have conflicting mjml_source and source_html',
    )
    expect(templateCutoverSql).toContain(
      'ALTER TABLE email_templates RENAME COLUMN mjml_source TO source_html',
    )
    expect(templateCutoverSql).toContain('SET source_html = mjml_source')
    expect(templateCutoverSql).toContain('ALTER TABLE email_templates DROP COLUMN mjml_source')
    expect(templateCutoverSql).toContain(
      'Cannot complete email template source cutover: neither mjml_source nor source_html exists',
    )
  })

  it('removes both stored project payloads and no seed writes the retired PDF column', () => {
    expect(templateCutoverSql).toContain(
      'ALTER TABLE "email_templates" DROP COLUMN IF EXISTS "design"',
    )
    expect(templateCutoverSql).toContain(
      'ALTER TABLE "pdf_templates" DROP COLUMN IF EXISTS "design"',
    )
    expect(pdfSeedSource).not.toMatch(/\bdesign\s*=/)
    expect(pdfSeedSource).not.toMatch(/(?:^|[,(])\s*design\s*(?:,|\))/m)
  })
})
