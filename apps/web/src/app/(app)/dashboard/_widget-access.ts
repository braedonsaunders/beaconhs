// Render-time permission gate for dashboard widgets — the security guarantee
// behind "a self-tier user sees only their own". A widget's data is either
// PERSONAL (scoped to the viewer; everyone may see it) or an ORG aggregate
// (incident counts, CA aging, safety rates, expiring certs, headcount, any
// Insights card). Org widgets list the permissions (ANY-of) whose holder may
// see them; a self-only user holds none, so every org card is dropped from BOTH
// the rendered layout (dashboard/page.tsx) AND the customize palette. Kept out
// of _widget-registry.ts so that registry stays serialisable for the client.

import { can, type RequestContext } from '@beaconhs/tenant'
import { canViewInsights } from '../insights/_access'
import { WIDGETS } from './_widget-registry'

// Module broad-read sets ("not self-tier"): read.all OR read.site. `…ANALYTICS`
// also lets anyone with analytics access see the rate/chart KPIs.
const INCIDENTS = ['incidents.read.all', 'incidents.read.site']
const CA = ['ca.read.all', 'ca.read.site']
const TRAINING = ['training.read.all']
const PPE = ['ppe.read.all']
const EQUIPMENT = ['equipment.read.all', 'equipment.read.site', 'equipment.manage']
const FORMS = ['forms.response.read.all', 'forms.response.read.site']
const INSPECT = ['inspections.read.all', 'inspections.read.site']
const ANALYTICS = ['insights.read', 'reports.read', 'dashboards.read']

// Per-widget required permissions (ANY-of). Widgets ABSENT here are PERSONAL —
// shown to everyone (personal-* + anything scoped to the viewer).
const WIDGET_PERMISSIONS: Record<string, readonly string[]> = {
  // Headline rates — org safety analytics
  'kpi-trir': [...INCIDENTS, ...ANALYTICS],
  'kpi-dart': [...INCIDENTS, ...ANALYTICS],
  'kpi-days-since-recordable': [...INCIDENTS, ...ANALYTICS],
  'kpi-training-compliance': [...TRAINING, ...ANALYTICS],
  'kpi-document-compliance': ['documents.manage', ...ANALYTICS],
  // Operations
  'op-lone-worker-active': [...INCIDENTS, ...ANALYTICS],
  'op-submissions-today': [...FORMS, ...ANALYTICS],
  'op-inspections-mtd': [...INSPECT, ...ANALYTICS],
  // Incidents
  'list-recent-incidents': INCIDENTS,
  'chart-severity-pyramid': [...INCIDENTS, ...ANALYTICS],
  'chart-top-sites': [...INCIDENTS, ...ANALYTICS],
  'kpi-incidents-30d': [...INCIDENTS, ...ANALYTICS],
  // Corrective actions
  'kpi-open-cas': [...CA, ...ANALYTICS],
  'kpi-overdue-cas': [...CA, ...ANALYTICS],
  'chart-capa-aging': [...CA, ...ANALYTICS],
  'list-due-cas': CA,
  'list-overdue-cas': CA,
  // Training
  'kpi-expiring-certs': TRAINING,
  'list-expiring-training': TRAINING,
  // PPE
  'kpi-ppe-open-issues': PPE,
  'kpi-ppe-overdue': PPE,
  'equipment-vehicle-log-status': [...EQUIPMENT, ...ANALYTICS],
  // People headcount
  'kpi-people-active': ['admin.org.manage', ...ANALYTICS],
}

function hasAnyPermission(permissions: ReadonlySet<string>, required: readonly string[]): boolean {
  return required.some((p) => permissions.has(p))
}

export function canPermissionSetViewInsights(permissions: Iterable<string>): boolean {
  const set = permissions instanceof Set ? permissions : new Set(permissions)
  return hasAnyPermission(set, ['insights.read', 'reports.read', 'dashboards.read'])
}

export function canPermissionSetPublishInsights(permissions: Iterable<string>): boolean {
  const set = permissions instanceof Set ? permissions : new Set(permissions)
  return hasAnyPermission(set, ['insights.publish', 'reports.builder'])
}

export function canPermissionSetSeeWidget(permissions: Iterable<string>, id: string): boolean {
  const set = permissions instanceof Set ? permissions : new Set(permissions)
  const required = WIDGET_PERMISSIONS[id]
  if (required) return hasAnyPermission(set, required)
  if (id in WIDGETS) return true
  return canPermissionSetViewInsights(set)
}

/**
 * Can the viewer see this dashboard widget? Personal → always; org → ANY-of its
 * required permissions; a library-card UUID (a placed Insights card that isn't a
 * registry widget) → analytics access (`canViewInsights`).
 */
export function canSeeWidget(ctx: RequestContext, id: string): boolean {
  const required = WIDGET_PERMISSIONS[id]
  if (required) return ctx.isSuperAdmin || required.some((p) => can(ctx, p))
  if (id in WIDGETS) return true // known personal widget → everyone
  return canViewInsights(ctx) // unknown id = placed Insights library card
}

/** Does the viewer see ANY org aggregate? Drives the header tenant summary. */
export function canSeeOrgAggregates(ctx: RequestContext): boolean {
  if (ctx.isSuperAdmin || canViewInsights(ctx)) return true
  return [
    ...INCIDENTS,
    ...CA,
    ...TRAINING,
    ...PPE,
    ...EQUIPMENT,
    ...FORMS,
    ...INSPECT,
    'admin.org.manage',
    'documents.manage',
  ].some((p) => can(ctx, p))
}
