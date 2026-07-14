import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'

/** Canonical display form for tenant-owned named lookup/catalog rows. */
export function normalizeCatalogDisplayName(value: unknown): string | null {
  if (value == null) return null
  const normalized = String(value).normalize('NFKC').trim().replace(/\s+/gu, ' ')
  return normalized || null
}

/** PostgreSQL expression shared by normalized catalog lookups and unique indexes. */
export function normalizedCatalogNameSql(value: SQLWrapper): SQL<string> {
  return sql<string>`lower(btrim(regexp_replace(normalize(${value}, NFKC), '[[:space:]]+', ' ', 'g')))`
}

/** Check expression paired with normalized catalog unique indexes. */
export function catalogNameIsNonblankSql(value: SQLWrapper): SQL<boolean> {
  return sql<boolean>`${normalizedCatalogNameSql(value)} <> ''`
}
