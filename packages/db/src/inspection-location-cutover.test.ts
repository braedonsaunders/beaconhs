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
    const add = migration.indexOf('ADD COLUMN IF NOT EXISTS "location" text')
    const backfill = migration.indexOf(
      `SET "location" = NULLIF(btrim("metadata"->>'locationOnSite'), '')`,
    )
    const removeLegacyCopy = migration.indexOf(`SET "metadata" = "metadata" - 'locationOnSite'`)
    const restore = migration.indexOf('ALTER TABLE "inspection_records" FORCE ROW LEVEL SECURITY')
    const restoreTemplates = migration.indexOf(
      'ALTER TABLE "pdf_templates" FORCE ROW LEVEL SECURITY',
    )

    expect(relax).toBeGreaterThanOrEqual(0)
    expect(relaxTemplates).toBeGreaterThan(relax)
    expect(add).toBeGreaterThan(relaxTemplates)
    expect(backfill).toBeGreaterThan(add)
    expect(removeLegacyCopy).toBeGreaterThan(backfill)
    expect(restoreTemplates).toBeGreaterThan(removeLegacyCopy)
    expect(restore).toBeGreaterThan(restoreTemplates)
  })

  it('updates only the canonical seeded inspection PDF contract', () => {
    expect(migration).toContain(`WHERE "key" = 'inspection-report-pdf'`)
    expect(migration).toContain(`AND "record_subject_key" = 'inspections'`)
    expect(migration).toContain(`'>Location</td>\\1{{location}}</td>'`)
  })
})
