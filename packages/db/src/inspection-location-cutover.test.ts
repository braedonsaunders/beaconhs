import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0020_inspection_location_storage.sql'),
  'utf8',
)

describe('inspection location cutover', () => {
  it('promotes the legacy location into one canonical column under forced RLS', () => {
    const relax = migration.indexOf('ALTER TABLE "inspection_records" NO FORCE ROW LEVEL SECURITY')
    const relaxTemplates = migration.indexOf(
      'ALTER TABLE "pdf_templates" NO FORCE ROW LEVEL SECURITY',
    )
    const add = migration.indexOf('ADD COLUMN IF NOT EXISTS "location_on_site" text')
    const backfill = migration.indexOf(
      `SET "location_on_site" = NULLIF(btrim("metadata"->>'locationOnSite'), '')`,
    )
    const removeLegacyCopy = migration.indexOf(`SET "metadata" = "metadata" - 'locationOnSite'`)
    const removeDuplicateCustomer = migration.indexOf(`SET "customer_org_unit_id" = NULL`)
    const restore = migration.indexOf('ALTER TABLE "inspection_records" FORCE ROW LEVEL SECURITY')
    const restoreTemplates = migration.indexOf(
      'ALTER TABLE "pdf_templates" FORCE ROW LEVEL SECURITY',
    )

    expect(relax).toBeGreaterThanOrEqual(0)
    expect(relaxTemplates).toBeGreaterThan(relax)
    expect(add).toBeGreaterThan(relaxTemplates)
    expect(backfill).toBeGreaterThan(add)
    expect(removeLegacyCopy).toBeGreaterThan(backfill)
    expect(removeDuplicateCustomer).toBeGreaterThan(removeLegacyCopy)
    expect(restoreTemplates).toBeGreaterThan(removeDuplicateCustomer)
    expect(restore).toBeGreaterThan(restoreTemplates)
  })

  it('updates only the canonical seeded inspection PDF contract', () => {
    expect(migration).toContain(`WHERE "key" = 'inspection-report-pdf'`)
    expect(migration).toContain(`AND "record_subject_key" = 'inspections'`)
    expect(migration).toContain(`regexp_replace("source_html", '>Site</td>', '>Location</td>')`)
    expect(migration).toContain(`data-if="location_on_site"`)
    expect(migration).toContain(`Location on site</td>`)
    expect(migration).toContain(`{{location_on_site}}</td></tr>`)
  })

  it('does not preserve the legacy Location as a duplicate customer relation', () => {
    expect(migration).toContain(`WHERE "metadata"->>'legacy' = 'JOBSITEINSPECTIONS'`)
    expect(migration).toContain(`SET "customer_org_unit_id" = NULL`)
  })
})
