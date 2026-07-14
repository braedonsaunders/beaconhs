import { describe, expect, it } from 'vitest'
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
})
