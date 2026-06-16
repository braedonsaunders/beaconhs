// Insights permission gates. View falls back to the legacy reports/dashboards
// permissions so existing roles aren't locked out; create/publish fall back to
// reports.builder so existing safety managers can build Cards with no role
// backfill. Super-admin bypasses everything.

import { can, type RequestContext } from '@beaconhs/tenant'

export function canViewInsights(ctx: RequestContext): boolean {
  return (
    ctx.isSuperAdmin ||
    can(ctx, 'insights.read') ||
    can(ctx, 'reports.read') ||
    can(ctx, 'dashboards.read')
  )
}

export function canCreateInsights(ctx: RequestContext): boolean {
  return ctx.isSuperAdmin || can(ctx, 'insights.create') || can(ctx, 'reports.builder')
}

export function canPublishInsights(ctx: RequestContext): boolean {
  return ctx.isSuperAdmin || can(ctx, 'insights.publish') || can(ctx, 'reports.builder')
}

export function canManageInsights(ctx: RequestContext): boolean {
  return ctx.isSuperAdmin || can(ctx, 'insights.manage')
}
