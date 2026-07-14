// Central catalogue of every widget that can live on a dashboard.
//
// Each widget has:
//   • id            — stable string key (persisted into user_dashboard_layouts.layout.widgets[].id)
//   • category      — used to group items in the customize palette
//   • label/desc    — palette display strings
//   • defaultSize   — w/h on a 12-col grid (h is in row units)
//   • min/max sizes — react-grid-layout constraints
//
// Rendering is done in `_render-widgets.tsx` (keeps registry serialisable so
// we can ship it to the client without dragging the whole RSC tree).

import type { RoleTier } from './_role-tier'

export type WidgetCategory =
  | 'kpi'
  | 'incidents'
  | 'capa'
  | 'training'
  | 'documents'
  | 'equipment'
  | 'people'
  | 'operations'
  | 'personal'
  | 'admin'

export type WidgetMeta = {
  id: string
  category: WidgetCategory
  label: string
  description: string
  /** Default position size when added to the grid. */
  defaultSize: { w: number; h: number }
  /** Minimum size the user can shrink to. */
  minSize: { w: number; h: number }
  /** Maximum size; undefined sides = no max. */
  maxSize?: { w?: number; h?: number }
  /** Which roles see this widget in the palette by default. */
  rolesShown?: readonly RoleTier[]
}

export const WIDGETS: Record<string, WidgetMeta> = {
  // ---- Headline rates -----------------------------------------------------
  'kpi-trir': {
    id: 'kpi-trir',
    category: 'kpi',
    label: 'TRIR',
    description:
      'Total recordable incident rate — recordable incidents per 200,000 hours worked, rolling 12 months.',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 6, h: 4 },
    rolesShown: ['super_admin', 'tenant_admin', 'safety_manager'],
  },
  'kpi-dart': {
    id: 'kpi-dart',
    category: 'kpi',
    label: 'DART',
    description:
      'Days-away/restricted/transferred rate per 200,000 hours worked, rolling 12 months.',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 6, h: 4 },
    rolesShown: ['super_admin', 'tenant_admin', 'safety_manager'],
  },
  'kpi-training-compliance': {
    id: 'kpi-training-compliance',
    category: 'kpi',
    label: 'Training compliance',
    description: 'Share of training and certification requirements currently completed.',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 6, h: 4 },
  },
  'kpi-document-compliance': {
    id: 'kpi-document-compliance',
    category: 'kpi',
    label: 'Document compliance',
    description: 'Share of expected document acknowledgments completed.',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 6, h: 4 },
  },
  'kpi-days-since-recordable': {
    id: 'kpi-days-since-recordable',
    category: 'kpi',
    label: 'Days since last recordable',
    description: 'A big number — the classic safety-board scoreboard.',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    maxSize: { w: 6, h: 4 },
  },

  // ---- Operational status -------------------------------------------------
  'op-lone-worker-active': {
    id: 'op-lone-worker-active',
    category: 'operations',
    label: 'Active monitored sessions',
    description: 'Live count of in-progress monitored sessions across every app.',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
  },
  'op-submissions-today': {
    id: 'op-submissions-today',
    category: 'operations',
    label: 'Submissions today',
    description: 'Forms submitted since midnight.',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
  },
  'op-inspections-mtd': {
    id: 'op-inspections-mtd',
    category: 'operations',
    label: 'Inspections this month',
    description: 'Inspection records submitted or closed this calendar month.',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
  },

  // ---- Incidents ----------------------------------------------------------
  'list-recent-incidents': {
    id: 'list-recent-incidents',
    category: 'incidents',
    label: 'Recent incidents',
    description: 'Last 5 reported incidents with severity badges.',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 4 },
  },
  'chart-severity-pyramid': {
    id: 'chart-severity-pyramid',
    category: 'incidents',
    label: 'Severity pyramid',
    description:
      '12-month Heinrich-style distribution: fatality → lost time → medical aid → first aid → near miss.',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 4 },
    rolesShown: ['super_admin', 'tenant_admin', 'safety_manager'],
  },
  'chart-top-sites': {
    id: 'chart-top-sites',
    category: 'incidents',
    label: 'Top sites by incidents',
    description: 'Bar chart of sites with most incidents in the last 90 days.',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 4 },
  },

  // ---- Corrective actions -------------------------------------------------
  'kpi-open-cas': {
    id: 'kpi-open-cas',
    category: 'capa',
    label: 'Open CAs',
    description: 'Open corrective-action count with overdue flag.',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
  },
  'kpi-overdue-cas': {
    id: 'kpi-overdue-cas',
    category: 'capa',
    label: 'Overdue CAs',
    description: 'Corrective actions past their due date.',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
  },
  'chart-capa-aging': {
    id: 'chart-capa-aging',
    category: 'capa',
    label: 'CAPA aging buckets',
    description: 'Open CAs grouped by age: <7d, <30d, <60d, ≥60d.',
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  'list-due-cas': {
    id: 'list-due-cas',
    category: 'capa',
    label: 'Due corrective actions',
    description: 'Next 5 CAs by due date with aging indicators.',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 4 },
  },
  'list-overdue-cas': {
    id: 'list-overdue-cas',
    category: 'capa',
    label: 'Most-overdue corrective actions',
    description: 'Top CAs by days past due.',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 4 },
  },

  // ---- Training -----------------------------------------------------------
  'kpi-expiring-certs': {
    id: 'kpi-expiring-certs',
    category: 'training',
    label: 'Certs expiring (90d)',
    description: 'Training certificates set to expire in the next 90 days.',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
  },
  'list-expiring-training': {
    id: 'list-expiring-training',
    category: 'training',
    label: 'Expiring training (30d)',
    description: 'Person × course pairs with certs lapsing in 30 days.',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 4 },
  },

  // ---- PPE / Equipment ----------------------------------------------------
  'kpi-ppe-open-issues': {
    id: 'kpi-ppe-open-issues',
    category: 'equipment',
    label: 'Open PPE issues',
    description: 'PPE issue-reports still awaiting resolution.',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
  },
  'kpi-ppe-overdue': {
    id: 'kpi-ppe-overdue',
    category: 'equipment',
    label: 'PPE inspections overdue',
    description: 'PPE items past their annual inspection-due date.',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
  },
  'equipment-vehicle-log-status': {
    id: 'equipment-vehicle-log-status',
    category: 'equipment',
    label: 'Vehicle log status',
    description: 'Month-to-date vehicle-log entries, imported days and unresolved conflicts.',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 3, h: 2 },
    maxSize: { w: 6, h: 4 },
    rolesShown: ['super_admin', 'tenant_admin', 'safety_manager', 'foreman'],
  },

  // ---- Personal -----------------------------------------------------------
  'personal-in-progress': {
    id: 'personal-in-progress',
    category: 'personal',
    label: 'In progress',
    description:
      'Your unfinished entries — draft journals, hazard assessments, incidents, and inspections — newest first, to pick up where you left off.',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 4 },
  },
  'personal-my-ppe': {
    id: 'personal-my-ppe',
    category: 'personal',
    label: 'My PPE',
    description: 'PPE issued to you, each with a one-tap pre-use inspection.',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 4 },
  },
  'personal-my-equipment': {
    id: 'personal-my-equipment',
    category: 'personal',
    label: 'My equipment',
    description: 'Equipment checked out to you, each with a one-tap inspection.',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 4 },
  },
  'personal-my-compliance': {
    id: 'personal-my-compliance',
    category: 'personal',
    label: 'My compliance',
    description: 'Your completion rate and outstanding obligations at a glance.',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 4 },
  },
  'personal-inbox': {
    id: 'personal-inbox',
    category: 'personal',
    label: 'My inbox',
    description: "User's most recent unread notifications.",
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 4 },
  },
  'personal-actions': {
    id: 'personal-actions',
    category: 'personal',
    label: 'Quick actions',
    description: 'Common "start something" CTAs — report incident, new permit, etc.',
    // Resizable in both axes like every other card. The grid of tiles reflows
    // to the card's width and stretches to its height, so any size works.
    defaultSize: { w: 12, h: 2 },
    minSize: { w: 3, h: 2 },
  },

  // ---- Admin --------------------------------------------------------------
  'kpi-people-active': {
    id: 'kpi-people-active',
    category: 'people',
    label: 'Active people',
    description: 'Headcount of currently-active people in this tenant.',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
  },
  'kpi-incidents-30d': {
    id: 'kpi-incidents-30d',
    category: 'incidents',
    label: 'Incidents (30d)',
    description: 'Incidents in the last 30 days with prior-period delta.',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
  },
}

export const CATEGORY_LABELS: Record<WidgetCategory, string> = {
  kpi: 'Headline rates',
  incidents: 'Incidents',
  capa: 'Corrective actions',
  training: 'Training',
  documents: 'Documents',
  equipment: 'Equipment & PPE',
  people: 'People',
  operations: 'Operations',
  personal: 'Personal',
  admin: 'Admin',
}

/** Filter the registry by which widgets a role should see in the palette. */
export function widgetsForRole(role: RoleTier): WidgetMeta[] {
  return Object.values(WIDGETS).filter((w) => !w.rolesShown || w.rolesShown.includes(role))
}

/** Homepage analytics tiles now backed by the SAME Insights system cards (real
 *  BHQL over real tables — no bespoke or estimated computation). Maps the
 *  homepage widget key → the Insights built-in card key, so these tiles render
 *  through the shared engine + viz and stay consistent with /insights. Widgets
 *  not listed here (lists, personal/action tiles) have no card equivalent and
 *  keep rendering as bespoke widgets. */
export const WIDGET_CARD_KEY: Record<string, string> = {
  'kpi-trir': 'chart-trir',
  'kpi-dart': 'chart-dart',
  'kpi-training-compliance': 'kpi-training-compliance',
  'kpi-document-compliance': 'kpi-doc-compliance',
  'kpi-days-since-recordable': 'kpi-days-recordable',
  'kpi-incidents-30d': 'kpi-incidents',
  'kpi-open-cas': 'kpi-open-cas',
  'kpi-overdue-cas': 'kpi-overdue-cas',
  'chart-severity-pyramid': 'chart-severity',
  'chart-capa-aging': 'chart-ca-aging',
  'chart-top-sites': 'chart-top-sites',
  'op-submissions-today': 'kpi-submissions',
  'op-inspections-mtd': 'kpi-inspections',
  'op-lone-worker-active': 'kpi-lw-active',
  'kpi-ppe-open-issues': 'kpi-ppe-issues',
  'kpi-people-active': 'kpi-people',
}
