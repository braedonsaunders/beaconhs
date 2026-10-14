import { can, type RequestContext } from '@beaconhs/tenant'

export const BRIEF_READ_PERMISSION = 'briefs.read'
export const BRIEF_MANAGE_PERMISSION = 'briefs.manage'

/** View briefs, their runs, and brief widgets. */
export function canReadBriefs(ctx: RequestContext): boolean {
  return ctx.isSuperAdmin || can(ctx, BRIEF_READ_PERMISSION) || can(ctx, BRIEF_MANAGE_PERMISSION)
}

/** Create and edit briefs and schedules, preview, and run on demand. */
export function canManageBriefs(ctx: RequestContext): boolean {
  return ctx.isSuperAdmin || can(ctx, BRIEF_MANAGE_PERMISSION)
}
