import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { documentVersions } from './schema'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const migrationSql = readProductionCutoverSection('0010_chilly_proudstar.sql')

describe('document version integrity', () => {
  it('enforces one version number per document in the schema', () => {
    const index = getTableConfig(documentVersions).indexes.find(
      (candidate) => candidate.config.name === 'document_versions_document_idx',
    )
    expect(index?.config.unique).toBe(true)
    expect(index?.config.columns.map((column) => ('name' in column ? column.name : ''))).toEqual([
      'document_id',
      'version',
    ])
  })

  it('fails closed on duplicate historical rows before replacing the index', () => {
    expect(migrationSql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(migrationSql).toContain('GROUP BY "document_id", "version"')
    expect(migrationSql).toContain('HAVING count(*) > 1')
    expect(migrationSql).toContain('Document version uniqueness preflight failed')

    const relaxAt = migrationSql.indexOf(
      'ALTER TABLE "document_versions" NO FORCE ROW LEVEL SECURITY',
    )
    const preflightAt = migrationSql.indexOf('Document version uniqueness preflight failed')
    const restoreAt = migrationSql.indexOf(
      'ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY',
    )
    const dropAt = migrationSql.indexOf('DROP INDEX "document_versions_document_idx"')
    const createAt = migrationSql.indexOf('CREATE UNIQUE INDEX "document_versions_document_idx"')

    expect(preflightAt).toBeGreaterThan(relaxAt)
    expect(restoreAt).toBeGreaterThan(preflightAt)
    expect(dropAt).toBeGreaterThan(restoreAt)
    expect(createAt).toBeGreaterThan(dropAt)
  })
})
