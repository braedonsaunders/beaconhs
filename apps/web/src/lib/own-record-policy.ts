import { can, ForbiddenError, type RequestContext } from '@beaconhs/tenant'

/** Whether the caller is the tenant user who owns (reported / authored) a record. */
export function ownsRecord(
  ctx: RequestContext,
  ownerTenantUserIds: readonly (string | null | undefined)[],
): boolean {
  const membershipId = ctx.membership?.id
  return Boolean(membershipId && ownerTenantUserIds.includes(membershipId))
}

/** Module administration and deleting your own evidence are distinct rights. */
export function canDeleteOwnRecord(
  ctx: RequestContext,
  permission: string,
  ownerTenantUserId: string | null | undefined,
): boolean {
  return ownsRecord(ctx, [ownerTenantUserId]) && can(ctx, permission)
}

/** Modules whose edit right is split into `<module>.update` and `<module>.update.own`. */
type OwnScopedUpdateModule = 'incidents' | 'hazid'

/**
 * Edit one record: `<module>.update` edits any record the caller can see;
 * `<module>.update.own` edits only records the caller owns. A read tier never
 * widens the write tier — "view all, edit own" is read.all + update.own.
 */
export function canUpdateRecord(
  ctx: RequestContext,
  module: OwnScopedUpdateModule,
  ownerTenantUserIds: readonly (string | null | undefined)[],
): boolean {
  return (
    can(ctx, `${module}.update`) ||
    (can(ctx, `${module}.update.own`) && ownsRecord(ctx, ownerTenantUserIds))
  )
}

/** Whether the caller may edit at least their own records (cheap pre-check before loading one). */
export function canUpdateSomeRecords(ctx: RequestContext, module: OwnScopedUpdateModule): boolean {
  return can(ctx, `${module}.update`) || can(ctx, `${module}.update.own`)
}

/** Reject a caller with neither edit right before any record is loaded. */
export function assertCanUpdateSomeRecords(
  ctx: RequestContext,
  module: OwnScopedUpdateModule,
): void {
  if (!canUpdateSomeRecords(ctx, module)) throw new ForbiddenError(`${module}.update`)
}

/** Reject an edit of one record the caller may see but not change. */
export function assertCanUpdateRecord(
  ctx: RequestContext,
  module: OwnScopedUpdateModule,
  ownerTenantUserIds: readonly (string | null | undefined)[],
): void {
  if (!canUpdateRecord(ctx, module, ownerTenantUserIds))
    throw new ForbiddenError(`${module}.update`)
}
