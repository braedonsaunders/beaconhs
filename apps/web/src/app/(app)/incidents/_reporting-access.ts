import { can, type RequestContext } from '@beaconhs/tenant'

/** A reporting employee can complete their own account without investigator access. */
export function canEditIncidentReporting(
  ctx: RequestContext,
  reportedByTenantUserId: string | null,
) {
  return (
    can(ctx, 'incidents.update') ||
    (can(ctx, 'incidents.create') &&
      ctx.membership != null &&
      ctx.membership.id === reportedByTenantUserId)
  )
}
