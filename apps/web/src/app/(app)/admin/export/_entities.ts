import { exportColumns, type ExportColumn } from '@/lib/export-columns'

// Registry of entities the export hub can dispatch to. Each entry maps a
// human-friendly dataset to the CSV route already shipped by the owning module,
// so this utility stays a high-quality control center instead of duplicating
// export logic.

export type ExportEntity = {
  key: string
  label: string
  description: string
  csvHref: string
  sourceHref: string
  groupLabel: string
  ownerLabel: string
  permissionAny: string[]
  sensitivity: 'Standard' | 'Sensitive' | 'Restricted'
  defaultScope: string
  rowLimit: string
  defaultSort: string
  filterSummary: string[]
  filters: ExportFilterControl[]
  sortOptions: ExportSelectOption[]
  columns: ExportColumn[]
  fixedParams?: Record<string, string>
  formActionHref?: string
}

type ExportSelectOption = {
  value: string
  label: string
}

export type ExportFilterControl =
  | {
      kind: 'text'
      name: string
      label: string
      placeholder: string
    }
  | {
      kind: 'select'
      name: string
      label: string
      options: ExportSelectOption[]
      emptyLabel?: string
    }
  | {
      kind: 'date'
      name: string
      label: string
    }
  | {
      kind: 'year'
      name: string
      label: string
      defaultValue: string
    }

type ExportGroupSummary = {
  label: string
  description: string
}

const SORT_DIRS: ExportSelectOption[] = [
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
]

export const EXPORT_SORT_DIRECTIONS = SORT_DIRS

const INCIDENT_TYPES: ExportSelectOption[] = [
  { value: 'injury', label: 'Injury' },
  { value: 'illness', label: 'Illness' },
  { value: 'near_miss', label: 'Near-miss' },
  { value: 'property_damage', label: 'Property damage' },
  { value: 'environmental', label: 'Environmental' },
  { value: 'security', label: 'Security' },
]

const INCIDENT_STATUSES: ExportSelectOption[] = [
  { value: 'reported', label: 'Reported' },
  { value: 'under_investigation', label: 'Investigating' },
  { value: 'pending_review', label: 'Pending review' },
  { value: 'closed', label: 'Closed' },
  { value: 'reopened', label: 'Reopened' },
]

const INSPECTION_STATUSES: ExportSelectOption[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'locked', label: 'Locked' },
]

const CA_STATUSES: ExportSelectOption[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'pending_verification', label: 'Pending verification' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All statuses' },
]

const SEVERITIES: ExportSelectOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

const DOCUMENT_STATUSES: ExportSelectOption[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
  { value: 'under_review', label: 'Under review' },
]

const JOURNAL_STATUSES: ExportSelectOption[] = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
]

const JOURNAL_TYPES: ExportSelectOption[] = [
  { value: 'worker', label: 'Worker' },
  { value: 'supervisor', label: 'Supervisor' },
]

const TRAINING_DELIVERY_TYPES: ExportSelectOption[] = [
  { value: 'classroom', label: 'Classroom' },
  { value: 'self_paced', label: 'Self-paced' },
  { value: 'online', label: 'Online' },
  { value: 'on_the_job', label: 'On-the-job' },
  { value: 'external_certificate', label: 'External certificate' },
]

const EQUIPMENT_STATUSES: ExportSelectOption[] = [
  { value: 'in_service', label: 'In service' },
  { value: 'out_of_service', label: 'Out of service' },
  { value: 'in_repair', label: 'In repair' },
  { value: 'lost', label: 'Lost' },
  { value: 'retired', label: 'Retired' },
]

const PPE_STATUSES: ExportSelectOption[] = [
  { value: 'in_stock', label: 'In stock' },
  { value: 'issued', label: 'Issued' },
  { value: 'returned', label: 'Returned' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'discarded', label: 'Discarded' },
  { value: 'expired', label: 'Expired' },
]

const LOCATION_STATUSES: ExportSelectOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
]

const SAFE_DISTANCE_METHODS: ExportSelectOption[] = [
  { value: 'nasa', label: 'NASA Glenn' },
  { value: 'asme', label: 'ASME PCC-2' },
  { value: 'lloyds', label: "Lloyd's Register" },
]

export const EXPORT_GROUPS: ExportGroupSummary[] = [
  {
    label: 'Frontline',
    description: 'Operational records used for assurance, investigations, and closeout reviews.',
  },
  {
    label: 'Programs',
    description: 'Program documents, submitted app records, journals, and training catalogue data.',
  },
  {
    label: 'Builder apps',
    description: 'One exportable source per Builder app, including that app-specific field data.',
  },
  {
    label: 'People & assets',
    description: 'Directory, organization, equipment, PPE, and fleet inventory datasets.',
  },
  {
    label: 'Tools',
    description: 'Specialized calculator and engineering tool output.',
  },
]

function groupEntities(entities: ExportEntity[] = EXPORTABLE_ENTITIES) {
  const groups = new Map<string, ExportEntity[]>()
  for (const entity of entities) {
    const entries = groups.get(entity.groupLabel) ?? []
    entries.push(entity)
    groups.set(entity.groupLabel, entries)
  }
  return EXPORT_GROUPS.map((group) => ({
    ...group,
    entities: groups.get(group.label) ?? [],
  })).filter((group) => group.entities.length > 0)
}

export const EXPORTABLE_ENTITIES: ExportEntity[] = [
  {
    key: 'incidents',
    label: 'Incidents',
    description: 'Incident reports with occurrence details, classification, severity, and status.',
    csvHref: '/incidents/export.csv',
    sourceHref: '/incidents',
    groupLabel: 'Frontline',
    ownerLabel: 'Incidents',
    permissionAny: ['incidents.read.self'],
    sensitivity: 'Restricted',
    defaultScope: 'Visible incidents for the caller',
    rowLimit: '10,000 rows',
    defaultSort: 'Occurred date, newest first',
    filterSummary: ['Search', 'Type', 'Status', 'Sort'],
    filters: [
      { kind: 'text', name: 'q', label: 'Search', placeholder: 'Reference, title, description' },
      { kind: 'select', name: 'type', label: 'Type', options: INCIDENT_TYPES },
      { kind: 'select', name: 'status', label: 'Status', options: INCIDENT_STATUSES },
    ],
    sortOptions: [
      { value: 'occurred_at', label: 'Occurred date' },
      { value: 'reference', label: 'Reference' },
      { value: 'severity', label: 'Severity' },
      { value: 'status', label: 'Status' },
      { value: 'type', label: 'Type' },
    ],
    columns: exportColumns([
      'Reference',
      'Occurred',
      'Type',
      'Severity',
      'Status',
      'Title',
      'Site',
      'Description',
      'Location',
    ]),
  },
  {
    key: 'inspections',
    label: 'Inspections',
    description: 'Inspection records with status, inspector, site, signature, and result tallies.',
    csvHref: '/inspections/export.csv',
    sourceHref: '/inspections/records',
    groupLabel: 'Frontline',
    ownerLabel: 'Inspections',
    permissionAny: ['inspections.read.self'],
    sensitivity: 'Sensitive',
    defaultScope: 'Visible inspection records for the caller',
    rowLimit: '10,000 rows',
    defaultSort: 'Occurred date, newest first',
    filterSummary: ['Search', 'Status', 'Type', 'Site', 'Inspector', 'Signed', 'Date range'],
    filters: [
      { kind: 'text', name: 'q', label: 'Search', placeholder: 'Reference, type, foreman' },
      { kind: 'select', name: 'status', label: 'Status', options: INSPECTION_STATUSES },
      {
        kind: 'select',
        name: 'signed',
        label: 'Signed',
        options: [
          { value: 'yes', label: 'Signed' },
          { value: 'no', label: 'Unsigned' },
        ],
      },
      { kind: 'date', name: 'dateFrom', label: 'Occurred from' },
      { kind: 'date', name: 'dateTo', label: 'Occurred to' },
    ],
    sortOptions: [
      { value: 'occurred_at', label: 'Occurred date' },
      { value: 'reference', label: 'Reference' },
      { value: 'type', label: 'Type' },
      { value: 'status', label: 'Status' },
    ],
    columns: exportColumns([
      'Reference',
      'Type',
      'Status',
      'Occurred',
      'Site',
      'Inspector',
      'Pass',
      'Fail',
      'N/A',
      'Signed',
    ]),
  },
  {
    key: 'corrective-actions',
    label: 'Corrective actions',
    description:
      'Corrective action register with severity, assignment, due dates, and closure data.',
    csvHref: '/corrective-actions/export.csv',
    sourceHref: '/corrective-actions',
    groupLabel: 'Frontline',
    ownerLabel: 'Corrective actions',
    permissionAny: ['ca.read.self'],
    sensitivity: 'Sensitive',
    defaultScope: 'Visible corrective actions for the caller',
    rowLimit: '10,000 rows',
    defaultSort: 'Created date, newest first',
    filterSummary: ['Search', 'Status', 'Severity', 'Sort'],
    filters: [
      { kind: 'text', name: 'q', label: 'Search', placeholder: 'Reference, title, description' },
      { kind: 'select', name: 'status', label: 'Status', options: CA_STATUSES },
      { kind: 'select', name: 'severity', label: 'Severity', options: SEVERITIES },
    ],
    sortOptions: [
      { value: 'created_at', label: 'Created date' },
      { value: 'reference', label: 'Reference' },
      { value: 'title', label: 'Title' },
      { value: 'severity', label: 'Severity' },
      { value: 'status', label: 'Status' },
      { value: 'due_on', label: 'Due date' },
      { value: 'assigned_on', label: 'Assigned date' },
      { value: 'site', label: 'Site' },
    ],
    columns: exportColumns([
      'Reference',
      'Title',
      'Severity',
      'Status',
      'Assigned on',
      'Due on',
      'Closed on',
      'Site',
      'Description',
    ]),
  },
  {
    key: 'documents',
    label: 'Documents',
    description:
      'Document library metadata including status, category, review cycle, and description.',
    csvHref: '/documents/export.csv',
    sourceHref: '/documents',
    groupLabel: 'Programs',
    ownerLabel: 'Documents',
    permissionAny: ['documents.manage'],
    sensitivity: 'Standard',
    defaultScope: 'Documents visible to the caller',
    rowLimit: '10,000 rows',
    defaultSort: 'Title, A-Z',
    filterSummary: ['Search', 'Status', 'Sort'],
    filters: [
      { kind: 'text', name: 'q', label: 'Search', placeholder: 'Title or description' },
      { kind: 'select', name: 'status', label: 'Status', options: DOCUMENT_STATUSES },
    ],
    sortOptions: [
      { value: 'title', label: 'Title' },
      { value: 'category', label: 'Category' },
      { value: 'status', label: 'Status' },
      { value: 'next_review_on', label: 'Next review' },
    ],
    columns: exportColumns([
      'Title',
      'Key',
      'Category',
      'Status',
      'Next review',
      'Review frequency (months)',
      'Description',
    ]),
  },
  {
    key: 'journals',
    label: 'Journals',
    description: 'Journal entries with author, site, type, status, tags, photo count, and summary.',
    csvHref: '/journals/export.csv',
    sourceHref: '/journals/records',
    groupLabel: 'Programs',
    ownerLabel: 'Journals',
    permissionAny: ['journals.read.self'],
    sensitivity: 'Sensitive',
    defaultScope: 'Visible journal entries for the caller',
    rowLimit: '5,000 rows',
    defaultSort: 'Entry date, newest first',
    filterSummary: ['Search', 'Site', 'Person', 'Tag', 'Status', 'Type', 'Date range'],
    filters: [
      { kind: 'text', name: 'q', label: 'Search', placeholder: 'Title or body text' },
      { kind: 'text', name: 'tag', label: 'Tag', placeholder: 'Exact tag' },
      { kind: 'select', name: 'status', label: 'Status', options: JOURNAL_STATUSES },
      { kind: 'select', name: 'definition', label: 'Type', options: JOURNAL_TYPES },
      { kind: 'date', name: 'from', label: 'From' },
      { kind: 'date', name: 'to', label: 'To' },
    ],
    sortOptions: [],
    columns: exportColumns([
      'Reference',
      'Date',
      'Title',
      'Author',
      'Site',
      'Type',
      'Status',
      'Tags',
      'Photos',
      'Summary',
    ]),
  },
  {
    key: 'training-courses',
    label: 'Training courses',
    description:
      'Course catalogue metadata with delivery type, duration, validity, and evaluator requirements.',
    csvHref: '/training/courses/export.csv',
    sourceHref: '/training/courses',
    groupLabel: 'Programs',
    ownerLabel: 'Training',
    permissionAny: ['training.read.all', 'training.course.manage'],
    sensitivity: 'Standard',
    defaultScope: 'Tenant course catalogue',
    rowLimit: '10,000 rows',
    defaultSort: 'Name, A-Z',
    filterSummary: ['Search', 'Delivery type', 'Sort'],
    filters: [
      { kind: 'text', name: 'q', label: 'Search', placeholder: 'Name or code' },
      {
        kind: 'select',
        name: 'delivery',
        label: 'Delivery type',
        options: TRAINING_DELIVERY_TYPES,
      },
    ],
    sortOptions: [
      { value: 'name', label: 'Name' },
      { value: 'code', label: 'Code' },
      { value: 'delivery_type', label: 'Delivery type' },
      { value: 'valid_for_months', label: 'Validity' },
    ],
    columns: exportColumns([
      'Name',
      'Code',
      'Delivery type',
      'Duration (min)',
      'Validity (months)',
      'Requires evaluator',
      'Description',
    ]),
  },
  {
    key: 'people',
    label: 'People',
    description: 'People directory with employee number, department, trade, contact, and status.',
    csvHref: '/people/export.csv',
    sourceHref: '/people',
    groupLabel: 'People & assets',
    ownerLabel: 'People',
    permissionAny: ['admin.users.manage'],
    sensitivity: 'Restricted',
    defaultScope: 'Tenant people directory',
    rowLimit: '10,000 rows',
    defaultSort: 'Name, A-Z',
    filterSummary: ['Search', 'Sort'],
    filters: [{ kind: 'text', name: 'q', label: 'Search', placeholder: 'Name or employee number' }],
    sortOptions: [
      { value: 'name', label: 'Name' },
      { value: 'employee_no', label: 'Employee number' },
      { value: 'hire_date', label: 'Hire date' },
      { value: 'department', label: 'Department' },
      { value: 'trade', label: 'Trade' },
    ],
    columns: exportColumns([
      'Last name',
      'First name',
      'Employee #',
      'Department',
      'Trade',
      'Hire date',
      'Email',
      'Phone',
      'Status',
    ]),
  },
  {
    key: 'equipment',
    label: 'Equipment',
    description:
      'Equipment register with asset tag, type, serial number, status, site, and holder.',
    csvHref: '/equipment/export.csv',
    sourceHref: '/equipment',
    groupLabel: 'People & assets',
    ownerLabel: 'Equipment',
    permissionAny: ['equipment.read.site'],
    sensitivity: 'Sensitive',
    defaultScope: 'Visible equipment for the caller',
    rowLimit: '10,000 rows',
    defaultSort: 'Asset tag, A-Z',
    filterSummary: ['Search', 'Status', 'Sort'],
    filters: [
      { kind: 'text', name: 'q', label: 'Search', placeholder: 'Asset tag, name, serial' },
      { kind: 'select', name: 'status', label: 'Status', options: EQUIPMENT_STATUSES },
    ],
    sortOptions: [
      { value: 'asset_tag', label: 'Asset tag' },
      { value: 'name', label: 'Name' },
      { value: 'status', label: 'Status' },
      { value: 'site', label: 'Site' },
      { value: 'holder', label: 'Holder' },
      { value: 'purchase_date', label: 'Purchase date' },
    ],
    columns: exportColumns([
      'Asset tag',
      'Name',
      'Type',
      'Serial #',
      'Status',
      'Missing',
      'Site',
      'Holder',
      'Purchase date',
    ]),
  },
  {
    key: 'vehicle-log',
    label: 'Vehicle log summary',
    description: 'Annual fleet monthly rollup for kilometers, hours, and crew count.',
    csvHref: '/equipment/vehicle-log/export.csv',
    sourceHref: '/equipment/vehicle-log/summary',
    groupLabel: 'People & assets',
    ownerLabel: 'Equipment',
    permissionAny: ['equipment.read.all'],
    sensitivity: 'Sensitive',
    defaultScope: 'Tenant-wide fleet summary',
    rowLimit: '1,000 vehicles',
    defaultSort: 'Asset tag, A-Z',
    filterSummary: ['Year'],
    filters: [
      { kind: 'year', name: 'year', label: 'Year', defaultValue: String(new Date().getFullYear()) },
    ],
    sortOptions: [],
    columns: exportColumns([
      'Asset tag',
      'Name',
      'Jan km',
      'Jan hours',
      'Jan crew count',
      'Feb km',
      'Feb hours',
      'Feb crew count',
      'Mar km',
      'Mar hours',
      'Mar crew count',
      'Apr km',
      'Apr hours',
      'Apr crew count',
      'May km',
      'May hours',
      'May crew count',
      'Jun km',
      'Jun hours',
      'Jun crew count',
      'Jul km',
      'Jul hours',
      'Jul crew count',
      'Aug km',
      'Aug hours',
      'Aug crew count',
      'Sep km',
      'Sep hours',
      'Sep crew count',
      'Oct km',
      'Oct hours',
      'Oct crew count',
      'Nov km',
      'Nov hours',
      'Nov crew count',
      'Dec km',
      'Dec hours',
      'Dec crew count',
      'Total km',
      'Total hours',
      'Total crew count',
    ]),
  },
  {
    key: 'ppe',
    label: 'PPE',
    description:
      'PPE register with item type, serial number, holder, expiry, and inspection due dates.',
    csvHref: '/ppe/export.csv',
    sourceHref: '/ppe',
    groupLabel: 'People & assets',
    ownerLabel: 'PPE',
    permissionAny: ['ppe.read.all'],
    sensitivity: 'Sensitive',
    defaultScope: 'Tenant PPE inventory',
    rowLimit: '10,000 rows',
    defaultSort: 'Type, A-Z',
    filterSummary: ['Search', 'Status', 'Sort'],
    filters: [
      { kind: 'text', name: 'q', label: 'Search', placeholder: 'Type or serial number' },
      { kind: 'select', name: 'status', label: 'Status', options: PPE_STATUSES },
    ],
    sortOptions: [
      { value: 'type', label: 'Type' },
      { value: 'serial', label: 'Serial number' },
      { value: 'size', label: 'Size' },
      { value: 'status', label: 'Status' },
      { value: 'holder', label: 'Holder' },
    ],
    columns: exportColumns([
      'Type',
      'Serial #',
      'Size',
      'Status',
      'Holder',
      'Purchase date',
      'Expires on',
      'Next inspection',
    ]),
  },
  {
    key: 'locations',
    label: 'Locations',
    description: 'Customer-level location export with codes and address fields.',
    csvHref: '/locations/export.csv',
    sourceHref: '/locations',
    groupLabel: 'People & assets',
    ownerLabel: 'Locations',
    permissionAny: ['admin.org.manage'],
    sensitivity: 'Standard',
    defaultScope: 'Tenant customer locations',
    rowLimit: '10,000 rows',
    defaultSort: 'Name, A-Z',
    filterSummary: ['Search', 'Status', 'Sort'],
    filters: [
      { kind: 'text', name: 'q', label: 'Search', placeholder: 'Name or code' },
      { kind: 'select', name: 'status', label: 'Status', options: LOCATION_STATUSES },
    ],
    sortOptions: [
      { value: 'name', label: 'Name' },
      { value: 'code', label: 'Code' },
    ],
    columns: exportColumns([
      'Name',
      'Code',
      'Level',
      'Address line 1',
      'City',
      'Region',
      'Postal code',
      'Country',
    ]),
  },
  {
    key: 'safe-distance',
    label: 'Safe-distance assessments',
    description:
      'Pressure-test stand-off records with method, pressure, volume, results, site, and notes.',
    csvHref: '/tools/safe-distance/export.csv',
    sourceHref: '/tools/safe-distance',
    groupLabel: 'Tools',
    ownerLabel: 'Safe-distance tool',
    permissionAny: ['tools.safe-distance.use'],
    sensitivity: 'Sensitive',
    defaultScope: 'Tenant safe-distance records',
    rowLimit: '10,000 rows',
    defaultSort: 'Occurred date, newest first',
    filterSummary: ['Search', 'Method', 'Sort'],
    filters: [
      { kind: 'text', name: 'q', label: 'Search', placeholder: 'Reference, name, notes' },
      { kind: 'select', name: 'method', label: 'Method', options: SAFE_DISTANCE_METHODS },
    ],
    sortOptions: [
      { value: 'occurred_at', label: 'Occurred date' },
      { value: 'reference', label: 'Reference' },
      { value: 'name', label: 'Name' },
      { value: 'method', label: 'Method' },
    ],
    columns: exportColumns([
      'Reference',
      'Date',
      'Name',
      'Method',
      'Unit',
      'Test pressure',
      'Pressure unit',
      'Total volume',
      'NASA (dist)',
      'ASME (dist)',
      "Lloyd's (dist)",
      'Site',
      'Locked',
      'Notes',
    ]),
  },
]
