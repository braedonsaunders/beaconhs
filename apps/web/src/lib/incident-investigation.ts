export const INCIDENT_FACTOR_CATEGORIES = [
  'equipment',
  'procedure',
  'training',
  'environment',
  'human',
  'other',
] as const

export type IncidentFactorCategory = (typeof INCIDENT_FACTOR_CATEGORIES)[number]

export const INCIDENT_PREVENTATIVE_STEP_STATUSES = ['planned', 'in_progress', 'completed'] as const

export type IncidentPreventativeStepStatus = (typeof INCIDENT_PREVENTATIVE_STEP_STATUSES)[number]

export function isIncidentFactorCategory(value: unknown): value is IncidentFactorCategory {
  return (
    typeof value === 'string' &&
    INCIDENT_FACTOR_CATEGORIES.includes(value as IncidentFactorCategory)
  )
}

export function isIncidentPreventativeStepStatus(
  value: unknown,
): value is IncidentPreventativeStepStatus {
  return (
    typeof value === 'string' &&
    INCIDENT_PREVENTATIVE_STEP_STATUSES.includes(value as IncidentPreventativeStepStatus)
  )
}
