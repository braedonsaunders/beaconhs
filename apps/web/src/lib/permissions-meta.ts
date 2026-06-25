// Human-facing labels + grouping for the permission catalogue, so the role
// editor and the per-user permission tab read as plain English instead of dumping
// raw `module.action.qualifier` keys. The catalogue in @beaconhs/db/schema stays
// the source of truth — anything not labelled here falls back to a humanised key,
// so a newly-added permission still renders sensibly until it gets a label.

import { PERMISSION_CATALOGUE, type CataloguePermission } from '@beaconhs/db/schema'

// Group label per leading segment, in the order groups should render.
const GROUP_LABELS: Record<string, string> = {
  forms: 'Builder',
  incidents: 'Incidents',
  inspections: 'Inspections',
  hazid: 'Hazard assessments',
  training: 'Training',
  equipment: 'Equipment',
  ppe: 'PPE',
  documents: 'Documents',
  journals: 'Journals',
  ca: 'Corrective actions',
  compliance: 'Compliance',
  reports: 'Reports',
  dashboards: 'Dashboards',
  insights: 'Insights',
  admin: 'Administration',
}

// Short, professional label per permission key. Keys absent here humanise from
// the key itself (see `humanize`).
const PERMISSION_LABELS: Record<string, string> = {
  'forms.template.read': 'View templates',
  'forms.template.create': 'Create templates',
  'forms.template.publish': 'Publish templates',
  'forms.template.delete': 'Delete templates',
  'forms.ai.generate': 'Generate with AI',
  'forms.response.read.all': 'View all responses',
  'forms.response.read.site': 'View site responses',
  'forms.response.read.self': 'View own responses',
  'forms.response.create': 'Submit responses',
  'forms.response.update.own': 'Edit own responses',
  'forms.response.delete': 'Delete responses',

  'incidents.read.all': 'View all incidents',
  'incidents.read.site': 'View site incidents',
  'incidents.read.self': 'View own incidents',
  'incidents.create': 'Report incidents',
  'incidents.update': 'Edit incidents',
  'incidents.investigate': 'Investigate incidents',
  'incidents.close': 'Close incidents',

  'inspections.read.all': 'View all inspections',
  'inspections.read.site': 'View site inspections',
  'inspections.read.self': 'View own inspections',

  'hazid.read.all': 'View all hazard assessments',
  'hazid.read.site': 'View site hazard assessments',
  'hazid.read.self': 'View own hazard assessments',

  'training.read.all': 'View all training',
  'training.read.self': 'View own training',
  'training.course.manage': 'Manage courses',
  'training.class.manage': 'Manage classes',
  'training.record.create': 'Record training',
  'training.matrix.manage': 'Manage training matrix',

  'equipment.read.all': 'View all equipment',
  'equipment.read.site': 'View site equipment',
  'equipment.manage': 'Manage equipment',
  'equipment.inspect': 'Inspect equipment',
  'equipment.workorder.create': 'Open work orders',
  'equipment.workorder.close': 'Close work orders',

  'ppe.read.all': 'View all PPE',
  'ppe.issue': 'Issue PPE',
  'ppe.return': 'Return PPE',
  'ppe.inspect': 'Inspect PPE',

  'documents.read': 'View documents',
  'documents.manage': 'Manage documents',
  'documents.acknowledge': 'Acknowledge documents',
  'documents.review': 'Review documents',

  'journals.read.all': 'View all journals',
  'journals.read.site': 'View site journals',
  'journals.read.self': 'View own journals',
  'journals.create': 'Create journals',
  'journals.update.own': 'Edit own journals',
  'journals.submit': 'Submit journals',
  'journals.assign': 'Assign journals',

  'ca.read.all': 'View all corrective actions',
  'ca.read.site': 'View site corrective actions',
  'ca.read.self': 'View own corrective actions',
  'ca.create': 'Create corrective actions',
  'ca.update': 'Edit corrective actions',
  'ca.verify': 'Verify corrective actions',

  'compliance.read': 'View compliance hub',
  'compliance.manage': 'Manage obligations',
  'compliance.assign': 'Assign obligations',

  'reports.read': 'View reports',
  'reports.builder': 'Build reports',
  'reports.schedule': 'Schedule reports',

  'dashboards.read': 'View dashboards',
  'dashboards.edit': 'Edit dashboards',

  'insights.read': 'View insights',
  'insights.create': 'Build insights',
  'insights.publish': 'Publish to library',
  'insights.manage': "Manage others' insights",

  'admin.users.manage': 'Manage users',
  'admin.users.impersonate': 'Impersonate users',
  'admin.roles.manage': 'Manage roles',
  'admin.org.manage': 'Manage org hierarchy',
  'admin.plugins.manage': 'Manage plugins',
  'admin.api-keys.manage': 'Manage API keys',
  'admin.settings.manage': 'Manage settings',
  'admin.audit.read': 'View audit log',
  'admin.nav.manage': 'Edit navigation',
  'admin.integrations.manage': 'Manage integrations',
}

/** Title-cased, de-dotted fallback for keys without an explicit label. */
function humanize(key: string): string {
  const cleaned = key.replace(/[._-]+/g, ' ').trim()
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

export function permissionLabel(key: string): string {
  return PERMISSION_LABELS[key] ?? humanize(key)
}

export function permissionGroupKey(key: string): string {
  return key.split('.')[0] ?? 'other'
}

export function permissionGroupLabel(key: string): string {
  const g = permissionGroupKey(key)
  return GROUP_LABELS[g] ?? humanize(g)
}

export type PermissionItem = { key: CataloguePermission; label: string }
export type PermissionGroup = { key: string; label: string; permissions: PermissionItem[] }

/**
 * The full catalogue bucketed into labelled groups, preserving the catalogue's
 * order both within and across groups. Drives the permission matrix + the
 * per-user override list.
 */
export const PERMISSION_GROUPS: PermissionGroup[] = (() => {
  const order: string[] = []
  const byGroup = new Map<string, PermissionItem[]>()
  for (const key of PERMISSION_CATALOGUE) {
    const g = permissionGroupKey(key)
    if (!byGroup.has(g)) {
      byGroup.set(g, [])
      order.push(g)
    }
    byGroup.get(g)!.push({ key, label: permissionLabel(key) })
  }
  return order.map((g) => ({
    key: g,
    label: GROUP_LABELS[g] ?? humanize(g),
    permissions: byGroup.get(g)!,
  }))
})()
