// Registry of entities the export hub can dispatch to. Each entry maps a
// human-friendly label to the CSV route already shipped by the owning module
// (so we never re-implement export logic in this utility — we just send the
// user to the canonical endpoint with the audit row written by the route
// handler itself).
//
// `jsonHref` is optional — only populated for entities where the underlying
// module has a JSON variant. The export hub renders a "JSON" button only when
// it is set, keeping the UI honest about what's actually available.

export type ExportEntity = {
  key: string
  label: string
  description: string
  csvHref: string
  jsonHref?: string
  groupLabel: string
}

export const EXPORTABLE_ENTITIES: ExportEntity[] = [
  {
    key: 'incidents',
    label: 'Incidents',
    description: 'All incident records with classifications and severity.',
    csvHref: '/incidents/export.csv',
    groupLabel: 'Frontline',
  },
  {
    key: 'inspections',
    label: 'Inspections',
    description:
      'Inspection records with reference, type, status, occurrence date, and pass/fail/N-A tallies.',
    csvHref: '/inspections/export.csv',
    groupLabel: 'Frontline',
  },
  {
    key: 'corrective-actions',
    label: 'Corrective actions',
    description:
      'Open and closed corrective actions with assignment metadata, due dates, and resolution timestamps.',
    csvHref: '/corrective-actions/export.csv',
    groupLabel: 'Frontline',
  },
  {
    key: 'toolbox',
    label: 'Toolbox talks',
    description: 'Submitted toolbox-talk form responses — topic, attendees, status.',
    csvHref: '/forms/responses/export.csv',
    groupLabel: 'Programs',
  },
  {
    key: 'documents',
    label: 'Documents',
    description: 'Published and draft documents with category, version, and review due dates.',
    csvHref: '/documents/export.csv',
    groupLabel: 'Programs',
  },
  {
    key: 'people',
    label: 'People',
    description: 'Active and archived people with trade, department, and contact info.',
    csvHref: '/people/export.csv',
    groupLabel: 'People & assets',
  },
  {
    key: 'equipment',
    label: 'Equipment',
    description: 'Equipment items with current location, type, and status.',
    csvHref: '/equipment/export.csv',
    groupLabel: 'People & assets',
  },
  {
    key: 'ppe',
    label: 'PPE',
    description: 'PPE items, types, and outstanding inspections.',
    csvHref: '/ppe/export.csv',
    groupLabel: 'People & assets',
  },
  {
    key: 'locations',
    label: 'Locations',
    description: 'Org-unit hierarchy (customers, projects, sites, areas).',
    csvHref: '/locations/export.csv',
    groupLabel: 'People & assets',
  },
  {
    key: 'lone-worker',
    label: 'Lone-worker sessions',
    description: 'Lone-worker session log including check-ins and escalations.',
    csvHref: '/lone-worker/export.csv',
    groupLabel: 'Programs',
  },
  {
    key: 'safe-distance',
    label: 'Safe-distance assessments',
    description: 'Pressure-test stand-off records — method, test pressure, volume, results.',
    csvHref: '/tools/safe-distance/export.csv',
    groupLabel: 'Tools',
  },
]
