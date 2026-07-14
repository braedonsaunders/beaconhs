import type { SQL } from 'drizzle-orm'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { roleAssignments } from './schema/iam'
import { personGroups } from './schema/people-groups'
import { personTitleAssignments, personTitles } from './schema/people-titles'
import { jobTitleTaskAcknowledgments } from './schema/job-title-tasks'
import { crews, departments, trades } from './schema/org'
import { syncCrosswalk } from './schema/sync'

function uniqueIndex(name: string, table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.find((index) => index.config.name === name)
}

describe('identity and access relational invariants', () => {
  it('allows at most one assignment for a member and role', () => {
    const index = uniqueIndex('role_assignments_tenant_user_role_ux', roleAssignments)

    expect(index?.config.unique).toBe(true)
    expect(index?.config.columns.map((column) => ('name' in column ? column.name : null))).toEqual([
      'tenant_id',
      'tenant_user_id',
      'role_id',
    ])
  })

  it('allows at most one primary title for a person', () => {
    const index = uniqueIndex('person_title_assignments_one_primary_ux', personTitleAssignments)

    expect(index?.config.unique).toBe(true)
    expect(index?.config.columns.map((column) => ('name' in column ? column.name : null))).toEqual([
      'tenant_id',
      'person_id',
    ])
    expect(index?.config.where).toBeDefined()
  })

  it('keeps one inbound owner per canonical row and one source title per person', () => {
    const canonicalOwner = uniqueIndex(
      'sync_crosswalk_tenant_entity_canonical_owner_ux',
      syncCrosswalk,
    )
    expect(canonicalOwner?.config.unique).toBe(true)
    expect(
      canonicalOwner?.config.columns.map((column) => ('name' in column ? column.name : null)),
    ).toEqual(['tenant_id', 'entity', 'canonical_id'])

    const sourceTitle = uniqueIndex(
      'person_title_assignments_source_owner_ux',
      personTitleAssignments,
    )
    expect(sourceTitle?.config.unique).toBe(true)
    expect(sourceTitle?.config.where).toBeDefined()
    expect(
      sourceTitle?.config.columns.map((column) => ('name' in column ? column.name : null)),
    ).toEqual(['tenant_id', 'person_id', 'source_connection_id'])
  })

  it('requires every title assignment to have an owner and every source title to be primary', () => {
    expect(
      getTableConfig(personTitleAssignments).checks.map((constraint) => constraint.name),
    ).toEqual(
      expect.arrayContaining([
        'person_title_assignments_has_owner_ck',
        'person_title_assignments_source_primary_ck',
      ]),
    )
  })

  it('keeps acknowledgement signature evidence tenant-bound', () => {
    const foreignKey = getTableConfig(jobTitleTaskAcknowledgments).foreignKeys.find(
      (candidate) => candidate.getName() === 'job_title_task_acks_tenant_signature_attachment_fk',
    )
    const reference = foreignKey?.reference()

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'tenant_id',
      'signature_attachment_id',
    ])
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual(['tenant_id', 'id'])
  })

  it.each([
    ['person_titles', personTitles, 'person_titles_tenant_normalized_name_ux'],
    ['person_groups', personGroups, 'person_groups_tenant_normalized_name_ux'],
    ['departments', departments, 'departments_tenant_normalized_name_ux'],
    ['trades', trades, 'trades_tenant_normalized_name_ux'],
    ['crews', crews, 'crews_tenant_normalized_name_ux'],
  ] as const)('%s enforces one normalized name per tenant', (_label, table, indexName) => {
    const index = uniqueIndex(indexName, table)
    expect(index?.config.unique).toBe(true)
    expect(index?.config.columns).toHaveLength(2)
    expect('name' in index!.config.columns[0]! ? index!.config.columns[0]!.name : null).toBe(
      'tenant_id',
    )
    expect('name' in index!.config.columns[1]!).toBe(false)
    const expression = new PgDialect().sqlToQuery(index!.config.columns[1] as SQL).sql
    expect(expression).toContain('normalize(')
    expect(expression).toContain('NFKC')
    expect(expression).toContain("'[[:space:]]+', ' ', 'g'")
  })

  it.each([
    ['person_titles', personTitles, 'person_titles_name_nonblank_ck'],
    ['person_groups', personGroups, 'person_groups_name_nonblank_ck'],
    ['departments', departments, 'departments_name_nonblank_ck'],
    ['trades', trades, 'trades_name_nonblank_ck'],
    ['crews', crews, 'crews_name_nonblank_ck'],
  ] as const)('%s rejects blank normalized names', (_label, table, checkName) => {
    expect(getTableConfig(table).checks.map((constraint) => constraint.name)).toContain(checkName)
  })
})
