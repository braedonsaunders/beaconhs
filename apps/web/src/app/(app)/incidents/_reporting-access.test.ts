import { describe, expect, it } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'
import { canEditIncidentReporting, canUpdateIncident } from './_reporting-access'

const reporter = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
function ctx(permissions: string[], membershipId: string | null = reporter) {
  return {
    isSuperAdmin: false,
    membership: membershipId ? { id: membershipId } : null,
    permissions: new Set(permissions),
  } as RequestContext
}
const draft = (owner: string) => ({ reportedByTenantUserId: owner, isDraft: true })
const submitted = (owner: string) => ({ reportedByTenantUserId: owner, isDraft: false })

describe('incident edit access', () => {
  it('lets incidents.update (health & safety) edit any visible report, before and after submit', () => {
    const safety = ctx(['incidents.update'], other)
    expect(canUpdateIncident(safety, draft(reporter))).toBe(true)
    expect(canUpdateIncident(safety, submitted(reporter))).toBe(true)
    expect(canEditIncidentReporting(safety, submitted(reporter))).toBe(true)
  })

  it('keeps incidents.update.own to the caller’s own drafts', () => {
    const viewAllEditOwn = ctx(['incidents.read.all', 'incidents.update.own'])
    expect(canUpdateIncident(viewAllEditOwn, draft(reporter))).toBe(true)
    expect(canUpdateIncident(viewAllEditOwn, draft(other))).toBe(false)
    expect(canUpdateIncident(viewAllEditOwn, submitted(reporter))).toBe(false)
  })

  it('lets a reporting employee finish their own draft, then locks it for them on submit', () => {
    const worker = ctx(['incidents.create'])
    expect(canEditIncidentReporting(worker, draft(reporter))).toBe(true)
    expect(canEditIncidentReporting(worker, submitted(reporter))).toBe(false)
    expect(canEditIncidentReporting(worker, draft(other))).toBe(false)
    expect(canUpdateIncident(worker, draft(reporter))).toBe(false)
    expect(canEditIncidentReporting(ctx(['incidents.read.all']), draft(reporter))).toBe(false)
  })
})
