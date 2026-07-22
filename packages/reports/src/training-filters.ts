const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const TRAINING_REPORT_QUERY_KINDS = [
  'training_certificates',
  'training_expired_upcoming',
  'training_missing',
] as const

export type TrainingReportQueryKind = (typeof TRAINING_REPORT_QUERY_KINDS)[number]
export type TrainingReportGroupBy = 'employee' | 'course'

export const TRAINING_REPORT_DELIVERY_TYPES = [
  'classroom',
  'self_paced',
  'on_the_job',
  'external_certificate',
  'online',
] as const

export type TrainingReportDeliveryType = (typeof TRAINING_REPORT_DELIVERY_TYPES)[number]

export const TRAINING_REPORT_EXPIRY_WINDOWS = [30, 60, 90, 180, 365] as const

export type TrainingReportFilters = {
  personIds: string[]
  departmentIds: string[]
  groupIds: string[]
  courseIds: string[]
  courseTypes: string[]
  deliveryTypes: TrainingReportDeliveryType[]
  groupBy: TrainingReportGroupBy
  expiryWindowDays: number
  includeExpired: boolean
}

const MAX_MULTI_FILTER_VALUES = 50

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

export function isTrainingReportQueryKind(value: string): value is TrainingReportQueryKind {
  return (TRAINING_REPORT_QUERY_KINDS as readonly string[]).includes(value)
}

export function normalizeTrainingReportFilters(
  value: Record<string, unknown>,
): TrainingReportFilters {
  const rawDeliveryTypes = new Set(
    list(value.deliveryTypes).filter((item): item is string => typeof item === 'string'),
  )
  const expiryWindow = Number(value.expiryWindowDays)
  return {
    personIds: uuidList(value.personIds),
    departmentIds: uuidList(value.departmentIds),
    groupIds: uuidList(value.groupIds),
    courseIds: uuidList(value.courseIds),
    courseTypes: [
      ...new Set(
        list(value.courseTypes)
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ].slice(0, MAX_MULTI_FILTER_VALUES),
    deliveryTypes: TRAINING_REPORT_DELIVERY_TYPES.filter((type) => rawDeliveryTypes.has(type)),
    groupBy: value.groupBy === 'employee' ? 'employee' : 'course',
    expiryWindowDays: (TRAINING_REPORT_EXPIRY_WINDOWS as readonly number[]).includes(expiryWindow)
      ? expiryWindow
      : 90,
    includeExpired:
      value.includeExpired === false || value.includeExpired === 'false' ? false : true,
  }
}

export function trainingReportFiltersToRecord(
  filters: TrainingReportFilters,
): Record<string, unknown> {
  return {
    ...(filters.personIds.length ? { personIds: filters.personIds } : {}),
    ...(filters.departmentIds.length ? { departmentIds: filters.departmentIds } : {}),
    ...(filters.groupIds.length ? { groupIds: filters.groupIds } : {}),
    ...(filters.courseIds.length ? { courseIds: filters.courseIds } : {}),
    ...(filters.courseTypes.length ? { courseTypes: filters.courseTypes } : {}),
    ...(filters.deliveryTypes.length ? { deliveryTypes: filters.deliveryTypes } : {}),
    groupBy: filters.groupBy,
    expiryWindowDays: filters.expiryWindowDays,
    includeExpired: filters.includeExpired,
  }
}
