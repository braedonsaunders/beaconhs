import { describe, expect, it } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'
import { canEditIncidentReporting } from './_reporting-access'

const reporter = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
function ctx(permissions: string[], membershipId: string | null = reporter) {
  return {
    isSuperAdmin: false,
    membership: membershipId ? { id: membershipId } : null,
    permissions: new Set(permissions),
  } as RequestContext
}

describe('incident reporting edit access', () => {
  it('lets incidents.update edit any visible report', () => {
    expect(canEditIncidentReporting(ctx(['incidents.update']), other)).toBe(true)
  })

  it('keeps incidents.update.own to the reports the caller made', () => {
    const viewAllEditOwn = ctx(['incidents.read.all', 'incidents.update.own'])
    expect(canEditIncidentReporting(viewAllEditOwn, reporter)).toBe(true)
    expect(canEditIncidentReporting(viewAllEditOwn, other)).toBe(false)
  })

  it('still lets a reporting employee complete their own account', () => {
    expect(canEditIncidentReporting(ctx(['incidents.create']), reporter)).toBe(true)
    expect(canEditIncidentReporting(ctx(['incidents.create']), other)).toBe(false)
    expect(canEditIncidentReporting(ctx(['incidents.read.all']), reporter)).toBe(false)
  })
})
