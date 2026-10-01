import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { RequestContext } from '@beaconhs/tenant'
import type { RoleScope } from '@beaconhs/db/schema'
vi.mock('@/lib/reference', () => ({ nextReference: vi.fn() }))
vi.mock('@/lib/visibility', () => import('../../../lib/visibility'))
import { journalAuthorScopeWhere, journalScopeWhere } from './_lib'

function context(permissions: string[], scopes: RoleScope[]): RequestContext {
  return {
    permissions: new Set(permissions),
    scopes,
    personId: 'viewer-person',
    membership: { id: 'viewer-member' },
    isSuperAdmin: false,
  } as RequestContext
}
const dialect = new PgDialect()
function query(ctx: RequestContext) {
  return dialect.sqlToQuery(journalScopeWhere(ctx, 'viewer-person')!)
}

describe('journal assigned data scope', () => {
  it('grants Shop colleagues and own entries without granting every journal', () => {
    const result = query(
      context(['journals.read.site'], [{ type: 'team', departmentIds: ['shop'], groupIds: [] }]),
    )
    expect(result.sql).toContain(
      'in (select "people"."id" from "people" where "people"."department_id" in',
    )
    expect(result.sql).toContain('coalesce("journal_entries"."person_id"')
    expect(result.sql).toContain('inner join "tenant_users"')
    expect(result.sql).toContain(
      '"tenant_users"."id" = "journal_entries"."created_by_tenant_user_id"',
    )
    expect(result.sql).toContain('"people"."tenant_id" = "journal_entries"."tenant_id"')
    expect(result.params).toEqual(['viewer-person', 'viewer-member', 'shop'])
  })
  it('unions departments, groups, crews, named people and locations', () => {
    const result = query(
      context(
        ['journals.read.site'],
        [
          { type: 'team', departmentIds: ['shop'], groupIds: ['foremen'] },
          { type: 'crews', crewIds: ['crew'] },
          { type: 'people', personIds: ['colleague'] },
          { type: 'sites', siteIds: ['site'] },
        ],
      ),
    )
    expect(result.params).toEqual([
      'viewer-person',
      'viewer-member',
      'shop',
      'foremen',
      'crew',
      'colleague',
      'site',
    ])
    expect(result.sql).toContain('jsonb_exists_any')
    expect(result.sql).toContain('"people"."crew_id" in')
  })
  it('requires scoped read permission and never treats tenant scope as read-all', () => {
    const scopes: RoleScope[] = [
      { type: 'team', departmentIds: ['shop'], groupIds: [] },
      { type: 'tenant' },
    ]
    expect(query(context(['journals.read.self'], scopes)).params).toEqual([
      'viewer-person',
      'viewer-member',
    ])
    expect(query(context(['journals.read.site'], [{ type: 'tenant' }])).params).toEqual([
      'viewer-person',
      'viewer-member',
    ])
    expect(journalScopeWhere(context(['journals.read.all'], scopes), null)).toBeUndefined()
    expect(
      dialect.sqlToQuery(
        journalScopeWhere({ ...context(['journals.read.site'], []), membership: null }, null)!,
      ).sql,
    ).toBe('false')
  })
  it('bounds author-specific browsing by the viewer scope', () => {
    const result = dialect.sqlToQuery(
      journalAuthorScopeWhere(
        context(['journals.read.site'], [{ type: 'team', departmentIds: ['shop'], groupIds: [] }]),
        'viewer-person',
        { personId: 'target', tenantUserId: 'target-member' },
      ),
    )
    expect(result.params).toEqual([
      'target',
      'target-member',
      'viewer-person',
      'viewer-member',
      'shop',
    ])
    expect(result.sql).toContain(' and ')
  })
})
