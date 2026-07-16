import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import { PgDialect } from 'drizzle-orm/pg-core'
import { people } from './schema'
import { primaryPersonTitleName } from './person-title-query'

describe('primary person title query', () => {
  it('pins the lookup to the outer person and tenant and excludes retired titles', () => {
    const query = new PgDialect().sqlToQuery(primaryPersonTitleName(people.id, people.tenantId)).sql

    expect(query).toContain('"person_title_assignments"."person_id" = "people"."id"')
    expect(query).toContain('"person_title_assignments"."tenant_id" = "people"."tenant_id"')
    expect(query).toContain('"person_title_assignments"."is_primary" = true')
    expect(query).toContain('"person_titles"."deleted_at" IS NULL')
  })

  it('stays fully qualified inside a single-table select field list', () => {
    // Drizzle rewrites Column chunks in the field list of a join-free select to
    // bare unqualified names. If that rewrite reaches into this fragment, the
    // subquery's column references turn ambiguous and Postgres rejects the
    // query with 42702 — which is how the person pickers broke.
    const db = drizzle.mock()
    const query = db
      .select({
        id: people.id,
        jobTitle: primaryPersonTitleName(people.id, people.tenantId),
      })
      .from(people)
      .toSQL().sql

    expect(query).toContain('"person_titles"."id" = "person_title_assignments"."title_id"')
    expect(query).toContain('"person_title_assignments"."person_id" = "people"."id"')
    expect(query).toContain('"person_title_assignments"."tenant_id" = "people"."tenant_id"')
    expect(query).not.toMatch(/ON "id" =/)
  })
})
