import { describe, expect, it } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'
import { canDeleteOwnRecord, canUpdateRecord, canUpdateSomeRecords } from './own-record-policy'
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

describe('own-scoped record updates', () => {
  it('lets update edit any record and update.own only the caller’s records', () => {
    expect(canUpdateRecord(ctx(['incidents.update']), 'incidents', ['another-user'])).toBe(true)
    expect(canUpdateRecord(ctx(['incidents.update.own']), 'incidents', [owner])).toBe(true)
    expect(canUpdateRecord(ctx(['incidents.update.own']), 'incidents', ['another-user'])).toBe(
      false,
    )
    expect(canUpdateRecord(ctx(['incidents.update.own'], null), 'incidents', [null])).toBe(false)
    expect(canUpdateRecord(ctx(['hazid.update.own']), 'incidents', [owner])).toBe(false)
  })

  it('does not let a read tier widen the edit right', () => {
    expect(
      canUpdateRecord(ctx(['hazid.read.all', 'hazid.update.own']), 'hazid', ['another-user']),
    ).toBe(false)
    expect(canUpdateRecord(ctx(['hazid.*']), 'hazid', ['another-user'])).toBe(true)
  })

  it('pre-checks either edit right', () => {
    expect(canUpdateSomeRecords(ctx(['hazid.update.own']), 'hazid')).toBe(true)
    expect(canUpdateSomeRecords(ctx(['hazid.read.all']), 'hazid')).toBe(false)
  })
})
