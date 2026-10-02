import { describe, expect, it } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'
import { canDeleteOwnRecord } from './record-delete-policy'
const owner = '00000000-0000-4000-8000-000000000001'
function ctx(permissions: string[], id: string | null = owner) {
  return {
    isSuperAdmin: false,
    membership: id ? { id } : null,
    permissions: new Set(permissions),
  } as RequestContext
}
describe('own record deletion', () => {
  it('requires both permission and matching authorship', () => {
    expect(
      canDeleteOwnRecord(ctx(['inspections.delete.own']), 'inspections.delete.own', owner),
    ).toBe(true)
    expect(canDeleteOwnRecord(ctx([]), 'inspections.delete.own', owner)).toBe(false)
    expect(
      canDeleteOwnRecord(ctx(['inspections.delete.own']), 'inspections.delete.own', 'another-user'),
    ).toBe(false)
    expect(
      canDeleteOwnRecord(ctx(['inspections.delete.own'], null), 'inspections.delete.own', null),
    ).toBe(false)
  })
})
