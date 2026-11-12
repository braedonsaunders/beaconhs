import { can, type RequestContext } from '@beaconhs/tenant'
import { canUpdateRecord, ownsRecord } from '@/lib/own-record-policy'

/**
 * Edit the reporting sections of one incident. `incidents.update` edits any
 * visible incident and `incidents.update.own` the caller's own reports; a
 * reporting employee (`incidents.create`) can always complete their own account
 * without investigator access.
 */
export function canEditIncidentReporting(
  ctx: RequestContext,
  reportedByTenantUserId: string | null,
) {
  return (
    canUpdateRecord(ctx, 'incidents', [reportedByTenantUserId]) ||
    (can(ctx, 'incidents.create') && ownsRecord(ctx, [reportedByTenantUserId]))
  )
}
