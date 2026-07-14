import type { ComplianceRecurrence } from '@beaconhs/db/schema'
import {
  complianceDate,
  type ComplianceClock,
  resolveCronWindow,
  resolveFrequencyWindow,
} from './schedule'

type TrainingEvaluationWindow = {
  kind: ComplianceRecurrence['kind']
  evidenceStartAt: Date | null
  evidenceEndAt: Date | null
  evidenceStartOn: string | null
  evidenceEndOn: string | null
  periodStart: string | null
  periodEnd: string | null
  dueOn: string | null
  deadlinePassed: boolean
  nextDueAt: Date | null
}

export type TrainingEvidence = {
  completedOn: string
  expiresOn: string | null
}

type TrainingEvidenceOutcome = {
  status: 'completed' | 'overdue' | 'pending' | 'in_progress' | 'expiring'
  dueOn: string | null
  completedOn: string | null
}

/**
 * Resolve the evidence boundary for a training requirement.
 *
 * One-time and expiry requirements intentionally accept an existing credential:
 * assigning a course does not make a still-valid certificate disappear. A
 * recurring requirement is different — only evidence from its active schedule
 * interval may satisfy it.
 */
export function resolveTrainingEvaluationWindow(
  recurrence: ComplianceRecurrence,
  clock: ComplianceClock,
  activeFrom: Date,
): TrainingEvaluationWindow {
  if (recurrence.kind === 'one_time' || recurrence.kind === 'expiry') {
    const today = complianceDate(clock)
    const dueOn = recurrence.kind === 'one_time' ? (recurrence.dueOn ?? null) : null
    return {
      kind: recurrence.kind,
      evidenceStartAt: null,
      evidenceEndAt: null,
      evidenceStartOn: null,
      evidenceEndOn: null,
      periodStart: null,
      periodEnd: null,
      dueOn,
      deadlinePassed: Boolean(dueOn && dueOn < today),
      nextDueAt: null,
    }
  }

  if (recurrence.kind === 'frequency') {
    const window = resolveFrequencyWindow(recurrence, clock, activeFrom)
    return {
      kind: recurrence.kind,
      evidenceStartAt: window.evidenceStartAt,
      evidenceEndAt: window.periodEndAt,
      evidenceStartOn: complianceDate({
        now: window.evidenceStartAt,
        timezone: clock.timezone,
      }),
      evidenceEndOn: window.periodEnd,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      dueOn: window.dueOn,
      deadlinePassed:
        window.scheduledAt.getTime() <= clock.now.getTime() &&
        clock.now.getTime() > window.dueAt.getTime(),
      nextDueAt: window.nextDueAt,
    }
  }

  if (recurrence.kind === 'cron') {
    const window = resolveCronWindow(recurrence, clock, activeFrom)
    return {
      kind: recurrence.kind,
      evidenceStartAt: window.evidenceStartAt,
      evidenceEndAt: window.periodEndAt,
      evidenceStartOn: complianceDate({
        now: window.evidenceStartAt,
        timezone: clock.timezone,
      }),
      evidenceEndOn: window.periodEnd,
      periodStart: window.started ? window.periodStart : null,
      periodEnd: window.started ? window.periodEnd : null,
      dueOn: window.dueOn,
      deadlinePassed: window.started && clock.now.getTime() > window.dueAt.getTime(),
      nextDueAt: window.nextDueAt,
    }
  }

  throw new Error(`Training obligations do not support ${recurrence.kind} recurrence`)
}

/** True when a completion/start belongs to the active recurring interval. */
export function trainingEvidenceInWindow(
  value: string | Date,
  window: TrainingEvaluationWindow,
): boolean {
  if (!window.evidenceStartAt || !window.evidenceEndAt) return true
  if (value instanceof Date) {
    const time = value.getTime()
    if (Number.isNaN(time)) return false
    return time >= window.evidenceStartAt.getTime() && time < window.evidenceEndAt.getTime()
  }
  if (!window.evidenceStartOn || !window.evidenceEndOn) return false
  return value >= window.evidenceStartOn && value <= window.evidenceEndOn
}

/**
 * Convert the best evidence plus live progress into the canonical scoreboard
 * state. Expiry requirements use the credential's own expiry as their due date;
 * recurring and one-time requirements use the obligation schedule.
 */
export function trainingEvidenceOutcome(args: {
  recurrence: ComplianceRecurrence
  window: TrainingEvaluationWindow
  today: string
  evidence: TrainingEvidence | null
  hasProgress: boolean
}): TrainingEvidenceOutcome {
  const { recurrence, window, today, evidence, hasProgress } = args

  if (recurrence.kind === 'expiry') {
    if (!evidence) {
      return {
        status: hasProgress ? 'in_progress' : 'pending',
        dueOn: null,
        completedOn: null,
      }
    }
    const dueOn = evidence.expiresOn
    if (!dueOn) return { status: 'completed', dueOn: null, completedOn: evidence.completedOn }
    if (dueOn < today) return { status: 'overdue', dueOn, completedOn: null }

    const horizon = new Date(`${today}T00:00:00Z`)
    horizon.setUTCDate(horizon.getUTCDate() + (recurrence.remindBeforeDays ?? 30))
    const status = dueOn <= horizon.toISOString().slice(0, 10) ? 'expiring' : 'completed'
    return {
      status,
      dueOn,
      completedOn: status === 'completed' || status === 'expiring' ? evidence.completedOn : null,
    }
  }

  const currentEvidence = evidence && (!evidence.expiresOn || evidence.expiresOn >= today)
  if (currentEvidence) {
    return {
      status: 'completed',
      dueOn: window.dueOn,
      completedOn: evidence.completedOn,
    }
  }
  return {
    status: window.deadlinePassed ? 'overdue' : hasProgress ? 'in_progress' : 'pending',
    dueOn: window.dueOn,
    completedOn: null,
  }
}
