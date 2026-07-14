import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@beaconhs/db'
import { roleAssignments } from '@beaconhs/db/schema'
import { upsertRoleAssignments } from './role-assignment-upsert'

describe('upsertRoleAssignments', () => {
  it('uses the complete tenant/member/role unique key and updates the scope', async () => {
    const returning = vi.fn().mockResolvedValue([{ membershipId: 'membership-1' }])
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning })
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate })
    const insert = vi.fn().mockReturnValue({ values })
    const tx = { insert } as unknown as Database

    const result = await upsertRoleAssignments(tx, [
      {
        tenantId: 'tenant-1',
        tenantUserId: 'membership-1',
        roleId: 'role-1',
        scope: { type: 'self' },
      },
    ])

    expect(insert).toHaveBeenCalledWith(roleAssignments)
    expect(values).toHaveBeenCalledWith([
      {
        tenantId: 'tenant-1',
        tenantUserId: 'membership-1',
        roleId: 'role-1',
        scope: { type: 'self' },
      },
    ])
    expect(onConflictDoUpdate).toHaveBeenCalledOnce()
    const conflict = onConflictDoUpdate.mock.calls[0]?.[0]
    expect(conflict?.target).toEqual([
      roleAssignments.tenantId,
      roleAssignments.tenantUserId,
      roleAssignments.roleId,
    ])
    expect(conflict?.set.scope).toBeDefined()
    expect(conflict?.set.updatedAt).toBeDefined()
    expect(conflict?.setWhere).toBeDefined()
    expect(result).toEqual(['membership-1'])
  })

  it('does not issue an empty insert', async () => {
    const insert = vi.fn()
    const result = await upsertRoleAssignments({ insert } as unknown as Database, [])

    expect(insert).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('reports no changed member when the conflict scope is already identical', async () => {
    const returning = vi.fn().mockResolvedValue([])
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning })
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate })
    const tx = { insert: vi.fn().mockReturnValue({ values }) } as unknown as Database

    const result = await upsertRoleAssignments(tx, [
      {
        tenantId: 'tenant-1',
        tenantUserId: 'membership-1',
        roleId: 'role-1',
        scope: { type: 'self' },
      },
    ])

    expect(result).toEqual([])
  })
})
