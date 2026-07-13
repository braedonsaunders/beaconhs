// Canonical Insights permission gates. Built-in roles are converged by the
// migration-time permission backfill; custom roles opt into these capabilities
// explicitly.

import { can, type RequestContext } from '@beaconhs/tenant'

export function canViewInsights(ctx: RequestContext): boolean {
  return ctx.isSuperAdmin || can(ctx, 'insights.read')
}

export function canCreateInsights(ctx: RequestContext): boolean {
  return ctx.isSuperAdmin || can(ctx, 'insights.create')
}

export function canPublishInsights(ctx: RequestContext): boolean {
  return ctx.isSuperAdmin || can(ctx, 'insights.publish')
}
