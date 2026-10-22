// Declarative registry of per-module ADMINISTRATION surfaces (config, taxonomies,
// records, settings). One entry per module. Pure data — no server imports — so
// both server pages and client nav can import it. Mirrors lib/nav/registry.ts.
//
// The admin CRUD pages themselves already live under each module; this registry
// describes them so the management sidebar, /admin rollup, and operational
// navigation can render them consistently. Adding a
// module's administration = one entry here — nothing is hand-built per module.
//
// Cross-cutting concerns stay where they belong: assignment/compliance lives in
// the global /compliance hub, and form building lives in the global Builder —
// module sections may LINK to those, never re-own them.

import type { AppMessages } from '@beaconhs/i18n/messages'

type AdminSection = {
  /** Group heading in the management sidebar. */
  group: keyof AppMessages['ManageWorkspace']['groups']
  /** Stable key; also the navigation `active` value for this section’s page. */
  key: string
  label: keyof AppMessages['ManageWorkspace']['pages']
  /** Existing route the section already lives at. */
  href: string
  /** Key into the ICONS map (components/sidebar-nav.tsx). */
  iconKey: string
  /** Optional finer-grained gate; defaults to the module's `permission`. */
  permission?: string
}

export type ModuleAdminTab = {
  key: string
  label: string
  href: string
  permission?: string
  requiredAnyPermission?: string[]
}

export type ModuleAdmin = {
  /** Matches a NAV_MODULES key (lib/nav/registry.ts): 'journals', 'incidents', … */
  moduleKey: string
  label: string
  /** Module home. */
  href: string
  /** Manage-hub route. */
  managePath: string
  iconKey: string
  /** Default permission for the module’s management pages and navigation. */
  permission: string
  /** Operational tab(s) everyone with module access sees (e.g. the workspace). */
  tabs: ModuleAdminTab[]
  /** Admin/config pages in the management sidebar and /admin rollup. */
  sections: AdminSection[]
}

export const MODULE_ADMIN: ModuleAdmin[] = [
  {
    moduleKey: 'journals',
    label: 'Journals',
    href: '/journals',
    managePath: '/journals/manage',
    iconKey: 'journal',
    permission: 'journals.assign',
    tabs: [
      { key: 'workspace', label: 'Journals', href: '/journals' },
      {
        key: 'records',
        label: 'Records',
        href: '/journals/records',
        requiredAnyPermission: ['journals.read.site', 'journals.read.all'],
      },
    ],
    sections: [
      {
        group: 'Configuration',
        key: 'tags',
        label: 'Tags',
        href: '/journals/tags',
        iconKey: 'tag',
      },
      {
        group: 'Automations',
        key: 'flows',
        label: 'Journals',
        href: '/journals/flows',
        iconKey: 'workflow',
      },
    ],
  },
  {
    moduleKey: 'incidents',
    label: 'Incidents',
    href: '/incidents',
    managePath: '/incidents/manage',
    iconKey: 'alert',
    permission: 'incidents.read.all',
    tabs: [
      { key: 'records', label: 'Records', href: '/incidents' },
      // No Reports tab — incident reporting lives in the global engines: TRIR /
      // DART / severity trends are Insights widgets, and the "OSHA 300
      // Recordable Log" + "Incidents Trend" are built-ins in the global /reports
      // engine.
    ],
    sections: [
      {
        group: 'Classification',
        key: 'classifications',
        label: 'Classifications',
        href: '/incidents/classifications',
        iconKey: 'layers',
      },
      {
        group: 'Classification',
        key: 'injury-types',
        label: 'Injury types',
        href: '/incidents/injury-types',
        iconKey: 'alert',
      },
      {
        group: 'Reporting',
        key: 'hours',
        label: 'Hours worked',
        href: '/incidents/hours',
        iconKey: 'timer',
      },
      {
        group: 'Automations',
        key: 'flows',
        label: 'Incidents',
        href: '/incidents/flows',
        iconKey: 'workflow',
      },
    ],
  },
  {
    moduleKey: 'corrective-actions',
    label: 'Corrective Actions',
    href: '/corrective-actions',
    managePath: '/corrective-actions/manage',
    iconKey: 'list-checks',
    permission: 'ca.update',
    tabs: [{ key: 'records', label: 'Corrective Actions', href: '/corrective-actions' }],
    sections: [
      {
        group: 'Automations',
        key: 'flows',
        label: 'Corrective actions',
        href: '/corrective-actions/flows',
        iconKey: 'workflow',
      },
    ],
  },
  {
    moduleKey: 'inspections',
    label: 'Site Inspections',
    href: '/inspections',
    managePath: '/inspections/manage',
    iconKey: 'clipboard',
    permission: 'inspections.manage',
    tabs: [{ key: 'records', label: 'Site Inspections', href: '/inspections/records' }],
    sections: [
      {
        group: 'Inspections',
        key: 'types',
        label: 'Types',
        href: '/inspections/types',
        iconKey: 'layers',
      },
      {
        group: 'Inspections',
        key: 'banks',
        label: 'Criteria banks',
        href: '/inspections/banks',
        iconKey: 'library',
      },
      {
        group: 'Automations',
        key: 'flows',
        label: 'Site inspections',
        href: '/inspections/flows',
        iconKey: 'workflow',
      },
    ],
  },
  {
    moduleKey: 'hazid',
    label: 'Hazard Assessments',
    href: '/hazard-assessments',
    managePath: '/hazard-assessments/manage',
    iconKey: 'radiation',
    permission: 'admin.settings.manage',
    tabs: [{ key: 'assessments', label: 'Assessments', href: '/hazard-assessments' }],
    sections: [
      {
        group: 'Libraries',
        key: 'hazards',
        label: 'Hazard library',
        href: '/hazard-assessments/hazards',
        iconKey: 'library',
      },
      {
        group: 'Libraries',
        key: 'tasks',
        label: 'Task library',
        href: '/hazard-assessments/tasks',
        iconKey: 'clipboard',
      },
      {
        group: 'Libraries',
        key: 'hazard-types',
        label: 'Hazard types',
        href: '/hazard-assessments/hazards/types',
        iconKey: 'radiation',
      },
      {
        group: 'Libraries',
        key: 'hazard-sets',
        label: 'Hazard sets',
        href: '/hazard-assessments/hazards/sets',
        iconKey: 'layers',
      },
      {
        group: 'Assessments',
        key: 'assessment-types',
        label: 'Assessment types',
        href: '/hazard-assessments/types',
        iconKey: 'clipboard',
      },
      {
        group: 'Assessments',
        key: 'risk-matrix',
        label: 'Risk matrix',
        href: '/hazard-assessments/risk-matrix',
        iconKey: 'grid',
      },
      {
        group: 'Automations',
        key: 'flows',
        label: 'Hazard assessments',
        href: '/hazard-assessments/flows',
        iconKey: 'workflow',
      },
    ],
  },
  {
    moduleKey: 'equipment',
    label: 'Equipment',
    href: '/equipment',
    managePath: '/equipment/manage',
    iconKey: 'wrench',
    permission: 'equipment.manage',
    tabs: [
      {
        key: 'equipment',
        label: 'Equipment',
        href: '/equipment',
        permission: 'equipment.read.self',
      },
      {
        key: 'maintenance',
        label: 'Maintenance',
        href: '/equipment/maintenance',
        permission: 'equipment.read.self',
      },
      {
        key: 'map',
        label: 'Map',
        href: '/equipment/map',
        permission: 'equipment.read.self',
      },
      {
        key: 'station',
        label: 'Check in / out',
        href: '/equipment/station',
        permission: 'equipment.manage',
      },
      {
        key: 'work-orders',
        label: 'Work orders',
        href: '/equipment/work-orders',
        permission: 'equipment.read.self',
      },
      {
        key: 'vehicle-log',
        label: 'Vehicle log',
        href: '/equipment/vehicle-log',
        requiredAnyPermission: ['equipment.read.self', 'equipment.vehicle-log.update.own'],
      },
      {
        key: 'inspections',
        label: 'Inspections',
        href: '/equipment/inspections',
        permission: 'equipment.read.self',
      },
    ],
    sections: [
      {
        group: 'Assets',
        key: 'types',
        label: 'Types',
        href: '/equipment/types',
        iconKey: 'layers',
      },
      {
        group: 'Assets',
        key: 'categories',
        label: 'Categories',
        href: '/equipment/categories',
        iconKey: 'library',
      },
      {
        group: 'Inspections',
        key: 'inspection-types',
        label: 'Inspection types',
        href: '/equipment/inspection-types',
        iconKey: 'clipboard',
      },
      {
        group: 'Operations',
        key: 'station-settings',
        label: 'Station settings',
        href: '/equipment/station/settings',
        iconKey: 'settings',
      },
      {
        group: 'Assets',
        key: 'custom-fields',
        label: 'Custom fields',
        href: '/equipment/custom-fields',
        iconKey: 'settings',
        permission: 'equipment.manage',
      },
      {
        group: 'Printing',
        key: 'label-design',
        label: 'QR label design',
        href: '/equipment/labels/design',
        iconKey: 'tag',
        permission: 'equipment.manage',
      },
      {
        group: 'Automations',
        key: 'asset-flows',
        label: 'Assets',
        href: '/equipment/assets/flows',
        iconKey: 'workflow',
      },
      {
        group: 'Automations',
        key: 'flows',
        label: 'Work orders',
        href: '/equipment/flows',
        iconKey: 'workflow',
      },
      {
        group: 'Automations',
        key: 'inspection-flows',
        label: 'Inspections',
        href: '/equipment/inspections/flows',
        iconKey: 'workflow',
      },
      {
        group: 'Operations',
        key: 'vehicle-log-settings',
        label: 'Vehicle log modes',
        href: '/equipment/vehicle-log/settings',
        iconKey: 'gauge',
      },
      {
        group: 'Automations',
        key: 'vehicle-log-flows',
        label: 'Vehicle log',
        href: '/equipment/vehicle-log/flows',
        iconKey: 'workflow',
      },
    ],
  },
  // GUARD-ONLY entries (no admin tiles of their own — sections: []). Vehicle
  // log, the equipment register, and equipment inspections are their own
  // FLOW/PDF subjects, and the guards (canManageModule, gate approvals,
  // ModuleFlowsPage) resolve modules by subject key — but all their admin
  // surfaces live under /equipment/manage above, so these contribute no tiles
  // (the /admin rollup skips section-less modules).
  {
    moduleKey: 'vehicle-log',
    label: 'Vehicle log',
    href: '/equipment/vehicle-log',
    managePath: '/equipment/manage',
    iconKey: 'gauge',
    permission: 'equipment.manage',
    tabs: [{ key: 'workspace', label: 'Vehicle log', href: '/equipment/vehicle-log' }],
    sections: [],
  },
  {
    moduleKey: 'equipment-assets',
    label: 'Equipment assets',
    href: '/equipment',
    managePath: '/equipment/manage',
    iconKey: 'wrench',
    permission: 'equipment.manage',
    tabs: [{ key: 'equipment', label: 'Equipment', href: '/equipment' }],
    sections: [],
  },
  {
    moduleKey: 'equipment-inspections',
    label: 'Inspections',
    href: '/equipment/inspections',
    managePath: '/equipment/manage',
    iconKey: 'clipboard',
    permission: 'equipment.manage',
    tabs: [{ key: 'inspections', label: 'Inspections', href: '/equipment/inspections' }],
    sections: [],
  },
  {
    moduleKey: 'ppe',
    label: 'PPE',
    href: '/ppe',
    managePath: '/ppe/manage',
    iconKey: 'hard-hat',
    permission: 'ppe.manage',
    tabs: [
      { key: 'records', label: 'Records', href: '/ppe' },
      {
        key: 'inspections',
        label: 'Inspections',
        href: '/ppe/inspections',
        permission: 'ppe.manage',
      },
    ],
    sections: [
      {
        group: 'Inspections',
        key: 'types',
        label: 'Types',
        href: '/ppe/types',
        iconKey: 'layers',
      },
      {
        group: 'Inspections',
        key: 'banks',
        label: 'Criteria banks',
        href: '/ppe/banks',
        iconKey: 'library',
      },
      {
        group: 'Configuration',
        key: 'custom-fields',
        label: 'Custom fields',
        href: '/ppe/custom-fields',
        iconKey: 'settings',
        permission: 'ppe.manage',
      },
      {
        group: 'Automations',
        key: 'flows',
        label: 'Inspections',
        href: '/ppe/flows',
        iconKey: 'workflow',
      },
    ],
  },
  // GUARD-ONLY entry (no admin tiles — sections: []). PPE issue reports are
  // their own flow/PDF subject ('ppe-issues'); all admin surfaces live under
  // /ppe/manage above.
  {
    moduleKey: 'ppe-issues',
    label: 'PPE issue reports',
    href: '/ppe',
    managePath: '/ppe/manage',
    iconKey: 'hard-hat',
    permission: 'ppe.manage',
    tabs: [{ key: 'records', label: 'Records', href: '/ppe' }],
    sections: [],
  },
  {
    moduleKey: 'documents',
    label: 'Documents',
    href: '/documents',
    managePath: '/documents/manage',
    iconKey: 'book',
    permission: 'documents.manage',
    tabs: [
      { key: 'documents', label: 'Documents', href: '/documents' },
      { key: 'books', label: 'Books', href: '/documents/books' },
      {
        key: 'management-reviews',
        label: 'Management reviews',
        href: '/documents/management-reviews',
      },
    ],
    sections: [
      {
        group: 'Library',
        key: 'types',
        label: 'Types',
        href: '/documents/types',
        iconKey: 'layers',
      },
      {
        group: 'Library',
        key: 'categories',
        label: 'Categories',
        href: '/documents/categories',
        iconKey: 'library',
      },
      {
        group: 'Automations',
        key: 'flows',
        label: 'Sign-offs',
        href: '/documents/flows',
        iconKey: 'workflow',
      },
      {
        group: 'Automations',
        key: 'management-review-flows',
        label: 'Management reviews',
        href: '/documents/management-reviews/flows',
        iconKey: 'workflow',
      },
    ],
  },
  {
    moduleKey: 'training',
    label: 'Training',
    href: '/training',
    managePath: '/training/manage',
    iconKey: 'grad',
    permission: 'training.course.manage',
    tabs: [
      // Two credential lists: Certificates = training records (completed or
      // uploaded); Skills = held competencies tied to an issuing authority.
      { key: 'records', label: 'Certificates', href: '/training/records' },
      { key: 'skills', label: 'Skills', href: '/training/skills' },
      { key: 'courses', label: 'Courses', href: '/training/courses' },
      { key: 'classes', label: 'Classes', href: '/training/classes' },
      { key: 'assessments', label: 'Assessments', href: '/training/assessments' },
      // No Reports tab — training reporting lives in the global /reports
      // builder (including saved tenant qualification rosters). The
      // coverage matrix lives in Insights (seeded "Training — Certificate
      // Matrix" card). Library and Card studio live under Manage below.
      // Per-person training history lives on each person's page (/people/[id]).
    ],
    sections: [
      {
        group: 'Learning resources',
        key: 'library',
        label: 'Library',
        href: '/training/library',
        iconKey: 'library',
      },
      {
        group: 'Learning resources',
        key: 'credential-designs',
        label: 'Card studio',
        href: '/training/credential-designs',
        iconKey: 'award',
      },
      {
        group: 'Qualifications',
        key: 'skill-types',
        label: 'Skill types',
        href: '/training/skills/types',
        iconKey: 'star',
      },
      {
        group: 'Qualifications',
        key: 'authorities',
        label: 'Authorities',
        href: '/training/authorities',
        iconKey: 'shield',
      },
      {
        group: 'Qualifications',
        key: 'assessment-types',
        label: 'Assessment types',
        href: '/training/assessments/types',
        iconKey: 'clipboard',
      },
      {
        group: 'Automations',
        key: 'flows',
        label: 'Assessments',
        href: '/training/flows',
        iconKey: 'workflow',
      },
      {
        group: 'Automations',
        key: 'class-flows',
        label: 'Classes',
        href: '/training/classes/flows',
        permission: 'training.class.manage',
        iconKey: 'workflow',
      },
    ],
  },
  // GUARD-ONLY entry (sections: []) — training classes are their own FLOW
  // subject ('training-classes'), but all their admin surfaces live under
  // /training/manage above, so this contributes no tiles.
  {
    moduleKey: 'training-classes',
    label: 'Training classes',
    href: '/training/classes',
    managePath: '/training/manage',
    iconKey: 'grad',
    permission: 'training.class.manage',
    tabs: [{ key: 'classes', label: 'Classes', href: '/training/classes' }],
    sections: [],
  },
  {
    moduleKey: 'people',
    label: 'People',
    href: '/people',
    managePath: '/people/manage',
    iconKey: 'users',
    permission: 'admin.org.manage',
    tabs: [{ key: 'directory', label: 'Directory', href: '/people' }],
    sections: [
      {
        group: 'Organisation',
        key: 'departments',
        label: 'Departments',
        href: '/people/departments',
        iconKey: 'layers',
      },
      {
        group: 'Organisation',
        key: 'groups',
        label: 'Groups',
        href: '/people/groups',
        iconKey: 'users',
      },
      {
        group: 'Organisation',
        key: 'titles',
        label: 'Job titles',
        href: '/people/titles',
        iconKey: 'label',
      },
      {
        group: 'Organisation',
        key: 'trades',
        label: 'Trades',
        href: '/people/trades',
        iconKey: 'wrench',
      },
      {
        group: 'Organisation',
        key: 'crews',
        label: 'Crews',
        href: '/people/crews',
        iconKey: 'users',
      },
      {
        group: 'Organisation',
        key: 'org-chart',
        label: 'Org chart',
        href: '/people/org-chart',
        iconKey: 'users',
      },
      {
        group: 'Printing',
        key: 'badge-design',
        label: 'ID badge design',
        href: '/people/badges/design',
        iconKey: 'label',
      },
      {
        group: 'Configuration',
        key: 'custom-fields',
        label: 'Custom fields',
        href: '/people/custom-fields',
        iconKey: 'settings',
        permission: 'admin.org.manage',
      },
    ],
  },
  {
    moduleKey: 'locations',
    label: 'Locations',
    href: '/locations',
    managePath: '/locations/manage',
    iconKey: 'pin',
    permission: 'admin.org.manage',
    tabs: [{ key: 'locations', label: 'Locations', href: '/locations' }],
    sections: [
      {
        group: 'Organisation',
        key: 'units',
        label: 'Org units',
        href: '/locations/units',
        iconKey: 'layers',
      },
      {
        group: 'Configuration',
        key: 'custom-fields',
        label: 'Custom fields',
        href: '/locations/custom-fields',
        iconKey: 'settings',
      },
    ],
  },
]

export function moduleAdminByKey(key: string): ModuleAdmin | undefined {
  return MODULE_ADMIN.find((m) => m.moduleKey === key)
}
