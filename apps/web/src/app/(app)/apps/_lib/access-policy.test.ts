import { describe, expect, it } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'
import { effectiveRoleAssignments } from '../../../../lib/effective-role-policy'
import { canAccessTemplate, canEditResponsePayload } from './access-policy'
import { parseBuilderReturnTo } from './return-to'

function context(
  permissions: string[] = [],
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    isSuperAdmin: false,
    timezone: 'America/Toronto',
    membership: { id: 'membership-1', displayName: 'Test User' },
    personId: 'person-1',
    permissions: new Set(permissions),
    scopes: [{ type: 'tenant' }],
    db: async () => {
      throw new Error('Database access is not expected in a policy unit test')
    },
    ...overrides,
  }
}

const published = {
  status: 'published' as const,
  allowedRoles: null,
  deletedAt: null,
}

describe('Builder template access policy', () => {
  it('uses only the role a multi-role user is currently acting under', () => {
    const assignments = [
      { roleId: 'manager-id', key: 'safety_manager' },
      { roleId: 'worker-id', key: 'worker' },
    ]
    const template = { ...published, allowedRoles: ['safety_manager'] }
    const ctx = context()

    const allRoleKeys = new Set(
      effectiveRoleAssignments(null, assignments).map((assignment) => assignment.key),
    )
    const managerRoleKeys = new Set(
      effectiveRoleAssignments('manager-id', assignments).map((assignment) => assignment.key),
    )
    const workerRoleKeys = new Set(
      effectiveRoleAssignments('worker-id', assignments).map((assignment) => assignment.key),
    )

    expect(canAccessTemplate(ctx, template, allRoleKeys, 'operate')).toBe(true)
    expect(canAccessTemplate(ctx, template, managerRoleKeys, 'operate')).toBe(true)
    expect(canAccessTemplate(ctx, template, workerRoleKeys, 'operate')).toBe(false)
  })

  it('blocks draft, archived, and deleted templates from direct operational access', () => {
    const ctx = context()
    const roleKeys = new Set(['worker'])

    expect(
      canAccessTemplate(
        ctx,
        { status: 'draft', allowedRoles: ['worker'], deletedAt: null },
        roleKeys,
        'operate',
      ),
    ).toBe(false)
    expect(
      canAccessTemplate(
        ctx,
        { status: 'archived', allowedRoles: ['worker'], deletedAt: null },
        roleKeys,
        'browse-records',
      ),
    ).toBe(false)
    expect(
      canAccessTemplate(ctx, { ...published, deletedAt: new Date() }, roleKeys, 'operate'),
    ).toBe(false)
  })

  it('allows open audiences and rejects a non-builder whose active role is not allowed', () => {
    const ctx = context()

    expect(canAccessTemplate(ctx, published, new Set(), 'operate')).toBe(true)
    expect(canAccessTemplate(ctx, { ...published, allowedRoles: [] }, new Set(), 'operate')).toBe(
      true,
    )
    expect(
      canAccessTemplate(
        ctx,
        { ...published, allowedRoles: ['supervisor'] },
        new Set(['worker']),
        'operate',
      ),
    ).toBe(false)
  })

  it('keeps author preview and edit explicit without permitting draft submissions', () => {
    const builder = context(['forms.template.create'])
    const draft = { status: 'draft' as const, allowedRoles: ['worker'], deletedAt: null }
    const archived = { status: 'archived' as const, allowedRoles: null, deletedAt: null }

    expect(canAccessTemplate(builder, draft, new Set(), 'builder-edit')).toBe(true)
    expect(canAccessTemplate(builder, draft, new Set(), 'browse-records')).toBe(true)
    expect(canAccessTemplate(builder, draft, new Set(), 'operate')).toBe(false)
    expect(canAccessTemplate(builder, archived, new Set(), 'browse-records')).toBe(true)
    expect(canAccessTemplate(builder, archived, new Set(), 'operate')).toBe(false)
    expect(
      canAccessTemplate(builder, { ...published, allowedRoles: ['worker'] }, new Set(), 'operate'),
    ).toBe(true)
    expect(canAccessTemplate(context(), draft, new Set(['worker']), 'builder-edit')).toBe(false)
  })
})

describe('Builder response payload access policy', () => {
  const draft = { status: 'draft', locked: false, submittedBy: 'membership-1' }

  it('allows an owner to work a draft and rejects a different ordinary member', () => {
    expect(canEditResponsePayload(context(['forms.response.create']), draft)).toBe(true)
    expect(
      canEditResponsePayload(
        context(['forms.response.create'], {
          membership: { id: 'membership-2', displayName: 'Other User' },
        }),
        draft,
      ),
    ).toBe(false)
  })

  it('keeps locked records immutable and preserves the reviewer manage tier', () => {
    expect(
      canEditResponsePayload(context(['forms.response.read.all']), {
        ...draft,
        submittedBy: 'membership-2',
      }),
    ).toBe(true)
    expect(
      canEditResponsePayload(context(['forms.response.read.all']), {
        ...draft,
        locked: true,
      }),
    ).toBe(false)
  })

  it('only allows an unowned response to be claimed while it is a working draft', () => {
    const ctx = context(['forms.response.create'])
    expect(canEditResponsePayload(ctx, { ...draft, submittedBy: null })).toBe(true)
    expect(canEditResponsePayload(ctx, { ...draft, status: 'submitted', submittedBy: null })).toBe(
      false,
    )
  })
})

describe('Builder filler return path', () => {
  it('accepts only the supported hazard-assessment anchor', () => {
    expect(
      parseBuilderReturnTo('/hazard-assessments/018f47ba-86c4-7ee2-8d7a-5e7602f2a001#section-apps'),
    ).toBe('/hazard-assessments/018f47ba-86c4-7ee2-8d7a-5e7602f2a001#section-apps')
    expect(parseBuilderReturnTo('/apps/responses')).toBeNull()
    expect(parseBuilderReturnTo('//example.com')).toBeNull()
    expect(parseBuilderReturnTo('/hazard-assessments/not-a-uuid#section-apps')).toBeNull()
  })
})
