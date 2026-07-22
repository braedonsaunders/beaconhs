const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_MULTI_FILTER_VALUES = 50

export const OPERATIONAL_FILTER_REPORT_SLUGS = [
  'compliance_by_entity',
  'compliance_by_person',
  'hazid_signatures',
  'skills_matrix',
  'skills_expired_upcoming',
  'skills_missing',
  'skills_cwb',
  'corrective_actions_list',
  'ppe_list',
  'ppe_expired_upcoming',
] as const

export type OperationalFilterReportSlug = (typeof OPERATIONAL_FILTER_REPORT_SLUGS)[number]

export const REPORT_COMPLIANCE_SOURCE_MODULES = [
  'inspection',
  'document',
  'training',
  'form',
  'journal',
  'cert_requirement',
  'equipment_inspection',
  'ppe_inspection',
  'job_title_signoff',
  'corrective_action',
  'hazard_assessment',
] as const

export const REPORT_COMPLIANCE_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'overdue',
  'expiring',
  'waived',
  'not_applicable',
] as const

export const REPORT_CORRECTIVE_STATUSES = [
  'open',
  'in_progress',
  'pending_verification',
  'closed',
  'cancelled',
] as const

export const REPORT_EXPIRY_WINDOWS = [30, 60, 90, 180, 365] as const

export type OperationalReportGroupBy =
  'employee' | 'skill' | 'authority' | 'status' | 'site' | 'type'

export type OperationalReportFilters = {
  personIds: string[]
  departmentIds: string[]
  groupIds: string[]
  obligationIds: string[]
  sourceModules: (typeof REPORT_COMPLIANCE_SOURCE_MODULES)[number][]
  complianceStatuses: (typeof REPORT_COMPLIANCE_STATUSES)[number][]
  skillTypeIds: string[]
  authorityIds: string[]
  siteIds: string[]
  correctiveStatuses: (typeof REPORT_CORRECTIVE_STATUSES)[number][]
  ppeTypeIds: string[]
  groupBy: OperationalReportGroupBy
  expiryWindowDays: number
  cwbStandard: string
  fromDate: string
  toDate: string
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return value.split(',')
  return []
}

function uuidList(value: unknown): string[] {
  return [
    ...new Set(
      list(value)
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().toLowerCase())
        .filter((item) => UUID_PATTERN.test(item)),
    ),
  ].slice(0, MAX_MULTI_FILTER_VALUES)
}

function enumList<const T extends readonly string[]>(value: unknown, allowed: T): T[number][] {
  const selected = new Set(
    list(value)
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim()),
  )
  return allowed.filter((item) => selected.has(item))
}

function dateValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return ISO_DATE_PATTERN.test(trimmed) && !Number.isNaN(Date.parse(`${trimmed}T00:00:00Z`))
    ? trimmed
    : ''
}

function defaultGroupBy(slug: OperationalFilterReportSlug): OperationalReportGroupBy {
  if (slug === 'skills_matrix') return 'authority'
  if (slug === 'skills_expired_upcoming') return 'skill'
  if (slug === 'corrective_actions_list') return 'status'
  if (slug === 'ppe_list' || slug === 'ppe_expired_upcoming') return 'type'
  return 'employee'
}

function allowedGroupBy(slug: OperationalFilterReportSlug): readonly OperationalReportGroupBy[] {
  if (slug === 'skills_matrix') return ['employee', 'skill', 'authority']
  if (slug === 'skills_expired_upcoming' || slug === 'skills_missing' || slug === 'skills_cwb') {
    return ['employee', 'skill']
  }
  if (slug === 'corrective_actions_list') return ['status', 'site', 'employee']
  if (slug === 'ppe_list' || slug === 'ppe_expired_upcoming') return ['type', 'employee']
  return ['employee']
}

export function isOperationalFilterReportSlug(value: string): value is OperationalFilterReportSlug {
  return (OPERATIONAL_FILTER_REPORT_SLUGS as readonly string[]).includes(value)
}

export function normalizeOperationalReportFilters(
  slug: OperationalFilterReportSlug,
  value: Record<string, unknown>,
): OperationalReportFilters {
  const requestedGroupBy = typeof value.groupBy === 'string' ? value.groupBy : ''
  const groupBy = allowedGroupBy(slug).includes(requestedGroupBy as OperationalReportGroupBy)
    ? (requestedGroupBy as OperationalReportGroupBy)
    : defaultGroupBy(slug)
  const requestedWindow = Number(value.expiryWindowDays)
  const fromDate = dateValue(value.fromDate)
  const toDate = dateValue(value.toDate)

  return {
    personIds: uuidList(value.personIds),
    departmentIds: uuidList(value.departmentIds),
    groupIds: uuidList(value.groupIds),
    obligationIds: uuidList(value.obligationIds),
    sourceModules: enumList(value.sourceModules, REPORT_COMPLIANCE_SOURCE_MODULES),
    complianceStatuses: enumList(value.complianceStatuses, REPORT_COMPLIANCE_STATUSES),
    skillTypeIds: uuidList(value.skillTypeIds),
    authorityIds: uuidList(value.authorityIds),
    siteIds: uuidList(value.siteIds),
    correctiveStatuses: enumList(value.correctiveStatuses, REPORT_CORRECTIVE_STATUSES),
    ppeTypeIds: uuidList(value.ppeTypeIds),
    groupBy,
    expiryWindowDays: (REPORT_EXPIRY_WINDOWS as readonly number[]).includes(requestedWindow)
      ? requestedWindow
      : 90,
    cwbStandard:
      typeof value.cwbStandard === 'string' ? value.cwbStandard.trim().slice(0, 120) : '',
    fromDate: fromDate && toDate && fromDate > toDate ? toDate : fromDate,
    toDate: fromDate && toDate && fromDate > toDate ? fromDate : toDate,
  }
}

export function operationalReportFiltersToRecord(
  slug: OperationalFilterReportSlug,
  filters: OperationalReportFilters,
): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  const add = (key: string, values: readonly string[]) => {
    if (values.length) record[key] = [...values]
  }

  if (
    slug === 'compliance_by_entity' ||
    slug === 'compliance_by_person' ||
    slug === 'hazid_signatures'
  ) {
    add('personIds', filters.personIds)
    add('departmentIds', filters.departmentIds)
    add('groupIds', filters.groupIds)
    add('complianceStatuses', filters.complianceStatuses)
    if (slug !== 'hazid_signatures') {
      add('obligationIds', filters.obligationIds)
      add('sourceModules', filters.sourceModules)
    }
    if (filters.fromDate) record.fromDate = filters.fromDate
    if (filters.toDate) record.toDate = filters.toDate
    return record
  }

  if (slug.startsWith('skills_')) {
    add('personIds', filters.personIds)
    add('departmentIds', filters.departmentIds)
    add('groupIds', filters.groupIds)
    add('skillTypeIds', filters.skillTypeIds)
    add('authorityIds', filters.authorityIds)
    record.groupBy = filters.groupBy
    if (slug === 'skills_expired_upcoming') record.expiryWindowDays = filters.expiryWindowDays
    if (slug === 'skills_cwb' && filters.cwbStandard) record.cwbStandard = filters.cwbStandard
    return record
  }

  if (slug === 'corrective_actions_list') {
    add('personIds', filters.personIds)
    add('departmentIds', filters.departmentIds)
    add('groupIds', filters.groupIds)
    add('siteIds', filters.siteIds)
    add('correctiveStatuses', filters.correctiveStatuses)
    record.groupBy = filters.groupBy
    return record
  }

  add('personIds', filters.personIds)
  add('departmentIds', filters.departmentIds)
  add('groupIds', filters.groupIds)
  add('ppeTypeIds', filters.ppeTypeIds)
  record.groupBy = filters.groupBy
  if (slug === 'ppe_expired_upcoming') record.expiryWindowDays = filters.expiryWindowDays
  return record
}
