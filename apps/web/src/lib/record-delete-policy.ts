import { can, type RequestContext } from '@beaconhs/tenant'

/** Module administration and deleting your own evidence are distinct rights. */
export function canDeleteOwnRecord(
  ctx: RequestContext,
  permission: string,
  ownerTenantUserId: string | null | undefined,
): boolean {
  return Boolean(
    ctx.membership?.id && ownerTenantUserId === ctx.membership.id && can(ctx, permission),
  )
}
