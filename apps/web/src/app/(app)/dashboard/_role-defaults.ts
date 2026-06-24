// Default dashboard layouts shipped per role. Used when a user has not
// customised their layout. 12-column grid; widget `h` is in row-units (≈40px).
//
// Tier intents:
//   • super_admin    — cross-tenant exec view: rates, severity, capa aging, top sites
//   • tenant_admin   — exec view: rates + ops headcount + recent activity
//   • safety_manager — operational deep view: pyramid, capa funnel, expiring, top sites
//   • foreman        — crew-level: today's ops + my crew CAs + expiring training
//   • worker         — personal: my tasks, my training, inbox

import type { DashboardLayoutData } from '@beaconhs/db/schema'
import type { RoleTier } from './_role-tier'

export const DEFAULT_LAYOUTS: Record<RoleTier, DashboardLayoutData> = {
  super_admin: {
    widgets: [
      // Row 1 — four headline rates
      { id: 'kpi-trir', x: 0, y: 0, w: 3, h: 3 },
      { id: 'kpi-dart', x: 3, y: 0, w: 3, h: 3 },
      { id: 'kpi-training-compliance', x: 6, y: 0, w: 3, h: 3 },
      { id: 'kpi-document-compliance', x: 9, y: 0, w: 3, h: 3 },
      // Row 2 — days-since + capa kpis
      { id: 'kpi-days-since-recordable', x: 0, y: 3, w: 3, h: 3 },
      { id: 'kpi-open-cas', x: 3, y: 3, w: 3, h: 2 },
      { id: 'kpi-overdue-cas', x: 6, y: 3, w: 3, h: 2 },
      { id: 'kpi-incidents-30d', x: 9, y: 3, w: 3, h: 2 },
      // Row 3 — quick actions
      { id: 'personal-actions', x: 0, y: 6, w: 12, h: 2 },
      // Row 4 — charts (3-wide)
      { id: 'chart-severity-pyramid', x: 0, y: 8, w: 6, h: 5 },
      { id: 'chart-capa-aging', x: 6, y: 8, w: 6, h: 4 },
      // Row 5 — lists
      { id: 'list-recent-incidents', x: 0, y: 13, w: 6, h: 5 },
      { id: 'chart-top-sites', x: 6, y: 13, w: 6, h: 5 },
      // Row 6 — overdue + inbox
      { id: 'list-overdue-cas', x: 0, y: 18, w: 6, h: 5 },
      { id: 'personal-inbox', x: 6, y: 18, w: 6, h: 5 },
    ],
  },

  tenant_admin: {
    widgets: [
      // Row 1 — four headline rates
      { id: 'kpi-trir', x: 0, y: 0, w: 3, h: 3 },
      { id: 'kpi-dart', x: 3, y: 0, w: 3, h: 3 },
      { id: 'kpi-training-compliance', x: 6, y: 0, w: 3, h: 3 },
      { id: 'kpi-document-compliance', x: 9, y: 0, w: 3, h: 3 },
      // Row 2 — ops kpis
      { id: 'kpi-days-since-recordable', x: 0, y: 3, w: 3, h: 3 },
      { id: 'kpi-people-active', x: 3, y: 3, w: 3, h: 2 },
      { id: 'kpi-open-cas', x: 6, y: 3, w: 3, h: 2 },
      { id: 'kpi-overdue-cas', x: 9, y: 3, w: 3, h: 2 },
      // Row 3 — quick actions
      { id: 'personal-actions', x: 0, y: 6, w: 12, h: 2 },
      // Row 4 — incident charts
      { id: 'chart-severity-pyramid', x: 0, y: 8, w: 6, h: 5 },
      { id: 'chart-top-sites', x: 6, y: 8, w: 6, h: 5 },
      // Row 5 — lists
      { id: 'list-recent-incidents', x: 0, y: 13, w: 6, h: 5 },
      { id: 'chart-capa-aging', x: 6, y: 13, w: 6, h: 4 },
      // Row 6 — inbox
      { id: 'personal-inbox', x: 0, y: 18, w: 12, h: 5 },
    ],
  },

  safety_manager: {
    widgets: [
      // Row 1 — operational kpis
      { id: 'kpi-days-since-recordable', x: 0, y: 0, w: 3, h: 3 },
      { id: 'kpi-open-cas', x: 3, y: 0, w: 3, h: 2 },
      { id: 'kpi-overdue-cas', x: 6, y: 0, w: 3, h: 2 },
      { id: 'kpi-incidents-30d', x: 9, y: 0, w: 3, h: 2 },
      // Row 2 — rates
      { id: 'kpi-trir', x: 3, y: 2, w: 3, h: 3 },
      { id: 'kpi-dart', x: 6, y: 2, w: 3, h: 3 },
      { id: 'kpi-expiring-certs', x: 9, y: 2, w: 3, h: 3 },
      // Row 3 — quick actions
      { id: 'personal-actions', x: 0, y: 5, w: 12, h: 2 },
      // Row 4 — top problems
      { id: 'list-overdue-cas', x: 0, y: 7, w: 6, h: 5 },
      { id: 'list-due-cas', x: 6, y: 7, w: 6, h: 5 },
      // Row 5 — charts
      { id: 'chart-severity-pyramid', x: 0, y: 12, w: 6, h: 5 },
      { id: 'chart-capa-aging', x: 6, y: 12, w: 6, h: 4 },
      // Row 6 — operational lists
      { id: 'list-recent-incidents', x: 0, y: 17, w: 6, h: 5 },
      { id: 'list-expiring-training', x: 6, y: 16, w: 6, h: 5 },
      // Row 7 — top sites
      { id: 'chart-top-sites', x: 0, y: 22, w: 12, h: 5 },
    ],
  },

  foreman: {
    widgets: [
      // Row 1 — today's operational status
      { id: 'op-lone-worker-active', x: 0, y: 0, w: 3, h: 2 },
      { id: 'op-submissions-today', x: 3, y: 0, w: 3, h: 2 },
      { id: 'op-inspections-mtd', x: 6, y: 0, w: 3, h: 2 },
      // Row 2 — quick actions
      { id: 'personal-actions', x: 0, y: 2, w: 12, h: 2 },
      // Row 3 — my crew's compliance
      { id: 'kpi-open-cas', x: 0, y: 4, w: 3, h: 2 },
      { id: 'kpi-overdue-cas', x: 3, y: 4, w: 3, h: 2 },
      { id: 'kpi-expiring-certs', x: 6, y: 4, w: 3, h: 2 },
      { id: 'kpi-ppe-overdue', x: 9, y: 4, w: 3, h: 2 },
      // Row 4 — actionable lists
      { id: 'list-due-cas', x: 0, y: 6, w: 6, h: 5 },
      { id: 'list-expiring-training', x: 6, y: 6, w: 6, h: 5 },
      // Row 5 — recent incidents on my site
      { id: 'list-recent-incidents', x: 0, y: 11, w: 6, h: 5 },
      { id: 'personal-inbox', x: 6, y: 11, w: 6, h: 5 },
      // Row 6 — my personal compliance + gear
      { id: 'personal-my-compliance', x: 0, y: 16, w: 6, h: 5 },
      { id: 'personal-my-ppe', x: 6, y: 16, w: 6, h: 5 },
    ],
  },

  worker: {
    widgets: [
      // Row 1 — quick actions only (no exec rates)
      { id: 'personal-actions', x: 0, y: 0, w: 12, h: 2 },
      // Row 2 — my compliance + my PPE (the field worker's daily view)
      { id: 'personal-my-compliance', x: 0, y: 2, w: 6, h: 5 },
      { id: 'personal-my-ppe', x: 6, y: 2, w: 6, h: 5 },
      // Row 3 — my equipment + inbox
      { id: 'personal-my-equipment', x: 0, y: 7, w: 6, h: 5 },
      { id: 'personal-inbox', x: 6, y: 7, w: 6, h: 5 },
      // Row 4 — personal status
      { id: 'kpi-days-since-recordable', x: 0, y: 12, w: 4, h: 3 },
      { id: 'kpi-expiring-certs', x: 4, y: 12, w: 4, h: 3 },
      { id: 'kpi-ppe-overdue', x: 8, y: 12, w: 4, h: 3 },
      // Row 5 — my training (we re-use expiring-training as "my")
      { id: 'list-expiring-training', x: 0, y: 15, w: 12, h: 5 },
    ],
  },
}
