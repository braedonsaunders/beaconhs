import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Database } from '@beaconhs/db'
import { BUILTIN_ROLES, PERMISSION_CATALOGUE } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { canSeeRecord, moduleScopeWhere } from './visibility'

function context(permissions: string[]): RequestContext {
  return {
    userId: 'user_1',
    tenantId: '10000000-0000-4000-8000-000000000001',
    isSuperAdmin: false,
    timezone: 'America/Toronto',
    locale: 'en',
    defaultLocale: 'en',
    enabledLocales: ['en'],
    localeOverride: null,
    membership: { id: 'member_1', displayName: 'Worker' },
    personId: 'person_1',
    permissions: new Set(permissions),
    scopes: [{ type: 'self' }],
    db: async () => {
      throw new Error('visibility predicates must not hit the database here')
    },
  }
}

const tx = {} as Database
const other = { prefix: 'hazid', ownerIds: ['member_2'], siteId: 'site_1' }
const mine = { prefix: 'hazid', ownerIds: ['member_1'], siteId: 'site_1' }

async function scopeResult(permissions: string[]): Promise<string> {
  const ctx = context(permissions)
  const where = await moduleScopeWhere(ctx, tx, { prefix: 'hazid' })
  if (where === undefined) return 'all'
  return 'restricted'
}

describe('hazid.read.others visibility contract', () => {
  it('is an opt-in catalogue permission held by no seeded built-in role', () => {
    expect(PERMISSION_CATALOGUE).toContain('hazid.read.others')
    // tenant_admin inherits the full catalogue by reference, so it always
    // holds every key. The off-by-default contract applies to the seeded
    // non-admin roles.
    for (const key of ['worker', 'foreman', 'safety_manager'] as const) {
      expect(BUILTIN_ROLES[key]?.permissions).not.toContain('hazid.read.others')
    }
  })

  it('keeps a self-tier user scoped to their own assessments', async () => {
    const ctx = context(['hazid.read.self'])
    expect(await canSeeRecord(ctx, tx, other)).toBe(false)
    expect(await canSeeRecord(ctx, tx, mine)).toBe(true)
    expect(await scopeResult(['hazid.read.self'])).toBe('restricted')
  })

  it('grants a self-tier holder of hazid.read.others tenant-wide view', async () => {
    const ctx = context(['hazid.read.self', 'hazid.read.others'])
    expect(await canSeeRecord(ctx, tx, other)).toBe(true)
    expect(await canSeeRecord(ctx, tx, mine)).toBe(true)
    expect(await scopeResult(['hazid.read.self', 'hazid.read.others'])).toBe('all')
  })

  it('does not widen other modules for a hazid.read.others holder', async () => {
    const ctx = context(['hazid.read.self', 'hazid.read.others', 'incidents.read.self'])
    expect(
      await canSeeRecord(ctx, tx, {
        prefix: 'incidents',
        ownerIds: ['member_2'],
        siteId: 'site_1',
      }),
    ).toBe(false)
    const where = await moduleScopeWhere(ctx, tx, { prefix: 'incidents' })
    expect(where).not.toBeUndefined()
  })

  it('lets a read.others holder past the send-email gate', () => {
    const page = readFileSync(
      new URL('../app/(app)/hazard-assessments/[id]/page.tsx', import.meta.url),
      'utf8',
    )
    expect(page).toContain("!can(ctx, 'hazid.read.others')")
  })
})
