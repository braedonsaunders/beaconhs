export type PpeInspectionKind = 'pre_use' | 'annual'

export type PpeInspectionState =
  'overdue' | 'due_today' | 'due_soon' | 'current' | 'never_inspected' | 'required' | 'not_required'

type Schedule = { everyDays?: number; requiresCertificate?: boolean } | null | undefined

export type PpeInspectionDue = {
  kind: PpeInspectionKind | null
  dueOn: string | null
  state: PpeInspectionState
  actionable: boolean
}

function dateAtUtcMidnight(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (dateAtUtcMidnight(toIso).getTime() - dateAtUtcMidnight(fromIso).getTime()) / 86_400_000,
  )
}

/** Canonical next-date calculation used when PPE inspection evidence is submitted. */
export function nextPpeInspectionDue(
  kind: PpeInspectionKind,
  inspectedOn: string,
  schedule: Schedule,
): string | null {
  const date = dateAtUtcMidnight(inspectedOn)
  if (kind === 'annual') {
    date.setUTCFullYear(date.getUTCFullYear() + 1)
  } else {
    const everyDays = schedule?.everyDays
    if (!everyDays || !Number.isInteger(everyDays) || everyDays < 1) return null
    date.setUTCDate(date.getUTCDate() + everyDays)
  }
  return date.toISOString().slice(0, 10)
}

/**
 * Resolve one actionable inspection state across pre-use and annual programs.
 * A configured checklist with no next date is immediately actionable: either
 * it has never been completed or it is a before-use checklist with no cadence.
 */
export function resolvePpeInspectionDue(input: {
  todayIso: string
  isInspectable: boolean
  preUseCriteriaCount: number
  annualCriteriaCount: number
  lastInspectionOn: string | null
  nextInspectionDue: string | null
  lastAnnualInspectionOn: string | null
  nextAnnualInspectionDue: string | null
  dueSoonDays?: number
}): PpeInspectionDue {
  const requirements: Array<{
    kind: PpeInspectionKind
    dueOn: string | null
    lastOn: string | null
  }> = []
  if (input.isInspectable && input.preUseCriteriaCount > 0) {
    requirements.push({
      kind: 'pre_use',
      dueOn: input.nextInspectionDue,
      lastOn: input.lastInspectionOn,
    })
  }
  if (input.isInspectable && input.annualCriteriaCount > 0) {
    requirements.push({
      kind: 'annual',
      dueOn: input.nextAnnualInspectionDue,
      lastOn: input.lastAnnualInspectionOn,
    })
  }
  if (requirements.length === 0) {
    return { kind: null, dueOn: null, state: 'not_required', actionable: false }
  }

  const missing = requirements.find((requirement) => !requirement.dueOn)
  if (missing) {
    return {
      kind: missing.kind,
      dueOn: null,
      state: missing.lastOn ? 'required' : 'never_inspected',
      actionable: true,
    }
  }

  const next = requirements
    .filter((requirement): requirement is typeof requirement & { dueOn: string } =>
      Boolean(requirement.dueOn),
    )
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0]!
  const days = daysBetween(input.todayIso, next.dueOn)
  if (days < 0) return { kind: next.kind, dueOn: next.dueOn, state: 'overdue', actionable: true }
  if (days === 0)
    return { kind: next.kind, dueOn: next.dueOn, state: 'due_today', actionable: true }
  if (days <= (input.dueSoonDays ?? 7)) {
    return { kind: next.kind, dueOn: next.dueOn, state: 'due_soon', actionable: false }
  }
  return { kind: next.kind, dueOn: next.dueOn, state: 'current', actionable: false }
}

export function ppeInspectionStateLabel(state: PpeInspectionState): string {
  return {
    overdue: 'Overdue',
    due_today: 'Due today',
    due_soon: 'Due soon',
    current: 'Current',
    never_inspected: 'Never inspected',
    required: 'Inspection required',
    not_required: 'Not required',
  }[state]
}
