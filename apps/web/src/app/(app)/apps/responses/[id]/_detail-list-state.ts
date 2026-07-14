import { parsePrefixedListParams, pickString } from '../../../../../lib/list-params'

type Search = Record<string, string | string[] | undefined>

const ORDER_VALUES = ['recent', 'oldest'] as const

export const CORRECTIVE_ACTION_STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'pending_verification', label: 'Pending verification' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

export const INCIDENT_STATUS_OPTIONS = [
  { value: 'reported', label: 'Reported' },
  { value: 'under_investigation', label: 'Investigating' },
  { value: 'pending_review', label: 'Pending review' },
  { value: 'closed', label: 'Closed' },
  { value: 'reopened', label: 'Reopened' },
] as const

export const CHECKIN_KIND_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'auto_prompted', label: 'Auto prompted' },
  { value: 'missed', label: 'Missed' },
  { value: 'escalation_acknowledged', label: 'Escalation acknowledged' },
] as const

function optionValue<const T extends readonly { value: string }[]>(
  value: string | undefined,
  options: T,
): T[number]['value'] | undefined {
  return options.some((option) => option.value === value)
    ? (value as T[number]['value'])
    : undefined
}

/**
 * Parse the independent growing lists embedded in a response detail route.
 * Each prefix owns its search/order/page state so changing one panel never
 * resets or corrupts another panel's shared URL state.
 */
export function parseResponseDetailListState(searchParams: Search) {
  const comments = parsePrefixedListParams(searchParams, 'comment', {
    sort: 'recent',
    perPage: 15,
    allowedSorts: ORDER_VALUES,
  })
  const correctiveActions = parsePrefixedListParams(searchParams, 'ca', {
    sort: 'recent',
    perPage: 8,
    allowedSorts: ORDER_VALUES,
  })
  const incidents = parsePrefixedListParams(searchParams, 'incident', {
    sort: 'recent',
    perPage: 8,
    allowedSorts: ORDER_VALUES,
  })
  const checkins = parsePrefixedListParams(searchParams, 'checkin', {
    sort: 'recent',
    perPage: 8,
    allowedSorts: ORDER_VALUES,
  })
  const activity = parsePrefixedListParams(searchParams, 'activity', {
    sort: 'recent',
    perPage: 15,
    allowedSorts: ORDER_VALUES,
  })

  return {
    comments: { ...comments, q: comments.q?.trim().slice(0, 200) || undefined },
    correctiveActions: {
      ...correctiveActions,
      q: correctiveActions.q?.trim().slice(0, 200) || undefined,
      status: optionValue(pickString(searchParams.caStatus), CORRECTIVE_ACTION_STATUS_OPTIONS),
    },
    incidents: {
      ...incidents,
      q: incidents.q?.trim().slice(0, 200) || undefined,
      status: optionValue(pickString(searchParams.incidentStatus), INCIDENT_STATUS_OPTIONS),
    },
    checkins: {
      ...checkins,
      q: checkins.q?.trim().slice(0, 200) || undefined,
      kind: optionValue(pickString(searchParams.checkinKind), CHECKIN_KIND_OPTIONS),
    },
    activity: {
      ...activity,
      q: activity.q?.trim().slice(0, 200) || undefined,
      action: pickString(searchParams.activityAction)?.trim().slice(0, 100) || undefined,
    },
  }
}

export type ResponseDetailListState = ReturnType<typeof parseResponseDetailListState>
