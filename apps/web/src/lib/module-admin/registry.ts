// Declarative registry of per-module ADMINISTRATION surfaces (config, taxonomies,
// records, settings). One entry per module. Pure data — no server imports — so
// both server pages and client nav can import it. Mirrors lib/nav/registry.ts.
//
// The admin CRUD pages themselves already live under each module; this registry
// only DESCRIBES them so a shared shell (the per-module Manage hub, the global
// /admin rollup, and the shared sub-nav) can render them consistently. Adding a
// module's administration = one entry here — nothing is hand-built per module.
//
// Cross-cutting concerns stay where they belong: assignment/compliance lives in
// the global /compliance hub, and form building lives in the global Builder —
// module sections may LINK to those, never re-own them.

export type AdminSection = {
  /** Stable key; also the sub-nav `active` value for this section's page. */
  key: string
  label: string
  /** Existing route the section already lives at. */
  href: string
  /** Key into the ICONS map (components/sidebar-nav.tsx). */
  iconKey: string
  desc: string
  /** Optional finer-grained gate; defaults to the module's `permission`. */
  permission?: string
}

export type ModuleAdminTab = { key: string; label: string; href: string; permission?: string }

export type ModuleAdmin = {
  /** Matches a NAV_MODULES key (lib/nav/registry.ts): 'journals', 'incidents', … */
  moduleKey: string
  label: string
  /** Module home. */
  href: string
  /** Manage-hub route. */
  managePath: string
  iconKey: string
  /** Gates the Manage hub, the /admin rollup tile, and the manager-only nav pill. */
  permission: string
  /** Operational tab(s) everyone with module access sees (e.g. the workspace). */
  tabs: ModuleAdminTab[]
  /** Admin/config tiles surfaced in the Manage hub + /admin rollup. */
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
    tabs: [{ key: 'workspace', label: 'Journals', href: '/journals' }],
    sections: [
      {
        key: 'records',
        label: 'Records',
        href: '/journals/records',
        iconKey: 'library',
        desc: 'Browse, filter and read every journal you have access to.',
      },
      {
        key: 'tags',
        label: 'Tags',
        href: '/journals/tags',
        iconKey: 'tag',
        desc: 'Govern the tag vocabulary — colours, rename, merge, prune.',
      },
      {
        key: 'flows',
        label: 'Automations',
        href: '/journals/flows',
        iconKey: 'workflow',
        desc: 'On submit, send emails, notify roles, raise CAPAs or require approval.',
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
        key: 'classifications',
        label: 'Classifications',
        href: '/incidents/classifications',
        iconKey: 'layers',
        desc: 'Tenant-defined taxonomy used to bucket and trend incidents.',
      },
      {
        key: 'injury-types',
        label: 'Injury types',
        href: '/incidents/injury-types',
        iconKey: 'alert',
        desc: 'The list of injury labels (laceration, strain, …) for reporting.',
      },
      {
        key: 'hours',
        label: 'Hours worked',
        href: '/incidents/hours',
        iconKey: 'timer',
        desc: 'Periodic hours-worked tallies that drive every frequency rate.',
      },
      {
        key: 'flows',
        label: 'Automations',
        href: '/incidents/flows',
        iconKey: 'workflow',
        desc: 'On status change, send emails, notify roles, raise CAPAs or require approval.',
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
        key: 'flows',
        label: 'Automations',
        href: '/corrective-actions/flows',
        iconKey: 'workflow',
        desc: 'On create or status change, send emails, notify roles or require approval.',
      },
    ],
  },
  {
    moduleKey: 'inspections',
    label: 'Inspections',
    href: '/inspections',
    managePath: '/inspections/manage',
    iconKey: 'clipboard',
    // TODO: native module still gated on a forms permission — no inspections.*
    // permission exists yet. Define one and switch this when RBAC is extended.
    permission: 'forms.template.read',
    tabs: [{ key: 'records', label: 'Inspections', href: '/inspections/records' }],
    sections: [
      {
        key: 'types',
        label: 'Types',
        href: '/inspections/types',
        iconKey: 'layers',
        desc: 'Define the kinds of inspection your teams carry out.',
      },
      {
        key: 'banks',
        label: 'Criteria banks',
        href: '/inspections/banks',
        iconKey: 'library',
        desc: 'Reusable criteria question banks shared across inspection types.',
      },
      {
        key: 'flows',
        label: 'Automations',
        href: '/inspections/flows',
        iconKey: 'workflow',
        desc: 'On submit or status change, send emails, notify roles, raise CAPAs or require approval.',
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
        key: 'hazards',
        label: 'Hazard library',
        href: '/hazard-assessments/hazards',
        iconKey: 'library',
        desc: 'Reusable hazard records with default controls and risk prompts.',
      },
      {
        key: 'tasks',
        label: 'Task library',
        href: '/hazard-assessments/tasks',
        iconKey: 'clipboard',
        desc: 'Reusable task templates that preload hazards and controls.',
      },
      {
        key: 'hazard-types',
        label: 'Hazard types',
        href: '/hazard-assessments/hazards/types',
        iconKey: 'radiation',
        desc: 'The master taxonomy of hazard categories.',
      },
      {
        key: 'hazard-sets',
        label: 'Hazard sets',
        href: '/hazard-assessments/hazards/sets',
        iconKey: 'layers',
        desc: 'Reusable bundles of hazards to seed new assessments.',
      },
      {
        key: 'assessment-types',
        label: 'Assessment types',
        href: '/hazard-assessments/types',
        iconKey: 'clipboard',
        desc: 'Templates that define each kind of hazard assessment.',
      },
      {
        key: 'risk-matrix',
        label: 'Risk matrix',
        href: '/hazard-assessments/risk-matrix',
        iconKey: 'grid',
        desc: 'The severity × likelihood scale, risk bands and colours used to score every assessment.',
      },
      {
        key: 'flows',
        label: 'Automations',
        href: '/hazard-assessments/flows',
        iconKey: 'workflow',
        desc: 'On sign or lock, send emails, notify roles, raise CAPAs or require approval.',
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
      { key: 'equipment', label: 'Equipment', href: '/equipment' },
      { key: 'work-orders', label: 'Work orders', href: '/equipment/work-orders' },
      { key: 'truck-log', label: 'Truck log', href: '/equipment/truck-log' },
      { key: 'inspections', label: 'Inspections', href: '/equipment/inspections' },
      { key: 'check-out', label: 'Check in / out', href: '/equipment/check-out' },
      { key: 'rates', label: 'Rates', href: '/equipment/rates' },
      { key: 'expenses', label: 'Expenses', href: '/equipment/expenses' },
      { key: 'log', label: 'Log', href: '/equipment/log' },
    ],
    sections: [
      {
        key: 'types',
        label: 'Types',
        href: '/equipment/types',
        iconKey: 'layers',
        desc: 'The make/model catalogue every asset is classified against.',
      },
      {
        key: 'categories',
        label: 'Categories',
        href: '/equipment/categories',
        iconKey: 'library',
        desc: 'Top-level groupings used to organise the asset register.',
      },
      {
        key: 'inspection-types',
        label: 'Inspection types',
        href: '/equipment/inspection-types',
        iconKey: 'clipboard',
        desc: 'Define the recurring inspections each asset class requires.',
      },
      {
        key: 'flows',
        label: 'Automations',
        href: '/equipment/flows',
        iconKey: 'workflow',
        desc: 'On work-order create or status change, send emails, notify roles or require approval.',
      },
    ],
  },
  {
    moduleKey: 'ppe',
    label: 'PPE',
    href: '/ppe',
    managePath: '/ppe/manage',
    iconKey: 'hard-hat',
    permission: 'ppe.read.all',
    tabs: [{ key: 'records', label: 'Records', href: '/ppe' }],
    sections: [
      {
        key: 'types',
        label: 'Types',
        href: '/ppe/types',
        iconKey: 'layers',
        desc: 'Catalogue of PPE kinds — build each type’s inspection checklist with sections and banks.',
      },
      {
        key: 'banks',
        label: 'Criteria banks',
        href: '/ppe/banks',
        iconKey: 'library',
        desc: 'Reusable criteria question banks shared across PPE types.',
      },
      {
        key: 'inspection-criteria',
        label: 'Inspection criteria',
        href: '/ppe/inspection-criteria',
        iconKey: 'check',
        desc: 'Cross-type overview of the checks each PPE kind requires.',
      },
    ],
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
        key: 'types',
        label: 'Types',
        href: '/documents/types',
        iconKey: 'layers',
        desc: 'Classify controlled documents (policy, procedure, form, …).',
      },
      {
        key: 'categories',
        label: 'Categories',
        href: '/documents/categories',
        iconKey: 'library',
        desc: 'Top-level groupings for the document library.',
      },
      {
        key: 'flows',
        label: 'Automations',
        href: '/documents/flows',
        iconKey: 'workflow',
        desc: 'On management review created, send emails, notify roles or require approval.',
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
      // builder (incl. the seeded "CWB welder roster" custom definition).
      // Library, Card studio, Matrix and Transcripts live under Manage below.
    ],
    sections: [
      {
        key: 'library',
        label: 'Library',
        href: '/training/library',
        iconKey: 'library',
        desc: 'Reusable lessons, videos, files and embeds for your courses.',
      },
      {
        key: 'credential-designs',
        label: 'Card studio',
        href: '/training/credential-designs',
        iconKey: 'award',
        desc: 'Design the certificate and wallet-card layouts issued from training.',
      },
      {
        key: 'matrix',
        label: 'Matrix',
        href: '/training/matrix',
        iconKey: 'grid',
        desc: 'Workforce coverage grid — who holds which course, and what is expiring.',
      },
      {
        key: 'transcripts',
        label: 'Transcripts',
        href: '/training/transcripts',
        iconKey: 'file',
        desc: 'Per-person training history — records, assessments and skills.',
      },
      {
        key: 'skill-types',
        label: 'Skill types',
        href: '/training/skills/types',
        iconKey: 'star',
        desc: 'The catalogue of competencies tracked across the workforce.',
      },
      {
        key: 'authorities',
        label: 'Authorities',
        href: '/training/authorities',
        iconKey: 'shield',
        desc: 'Issuing bodies that certify skills and qualifications.',
      },
      {
        key: 'assessment-types',
        label: 'Assessment types',
        href: '/training/assessments/types',
        iconKey: 'clipboard',
        desc: 'Reusable question sets backing competency assessments.',
      },
      {
        key: 'flows',
        label: 'Automations',
        href: '/training/flows',
        iconKey: 'workflow',
        desc: 'On assessment submit, send emails, notify roles or require approval.',
      },
    ],
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
        key: 'departments',
        label: 'Departments',
        href: '/people/departments',
        iconKey: 'layers',
        desc: 'The departments people belong to — one per person.',
      },
      {
        key: 'groups',
        label: 'Groups',
        href: '/people/groups',
        iconKey: 'users',
        desc: 'Cross-cutting groupings used for audiences and reporting.',
      },
      {
        key: 'titles',
        label: 'Job titles',
        href: '/people/titles',
        iconKey: 'label',
        desc: 'Job titles, with their task lists and acknowledgements.',
      },
      {
        key: 'org-chart',
        label: 'Org chart',
        href: '/people/org-chart',
        iconKey: 'users',
        desc: 'Reporting lines across the organisation, built from each person’s manager.',
      },
    ],
  },
]

export function moduleAdminByKey(key: string): ModuleAdmin | undefined {
  return MODULE_ADMIN.find((m) => m.moduleKey === key)
}
