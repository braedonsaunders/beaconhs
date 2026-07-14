import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { personTitles } from './schema'
import { normalizeCatalogDisplayName, normalizedCatalogNameSql } from './catalog-name'

describe('canonical catalog-name normalization', () => {
  it('normalizes Unicode compatibility forms and repeated whitespace', () => {
    expect(normalizeCatalogDisplayName('  Ｓite\t\n Supervisor  ')).toBe('Site Supervisor')
    expect(normalizeCatalogDisplayName('   ')).toBeNull()
    expect(normalizeCatalogDisplayName(null)).toBeNull()
  })

  it('renders the same unambiguous PostgreSQL key used by catalog indexes', () => {
    const query = new PgDialect().sqlToQuery(normalizedCatalogNameSql(personTitles.name)).sql

    expect(query).toContain('lower(btrim(regexp_replace(normalize("person_titles"."name", NFKC),')
    expect(query).toContain("'[[:space:]]+', ' ', 'g')")
  })
})
