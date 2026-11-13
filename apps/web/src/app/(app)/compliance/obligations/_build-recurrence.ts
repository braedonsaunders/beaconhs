// Form schedule value → stored ComplianceRecurrence, per obligation kind.
// Pure so every kind's output can be validated against the engine in tests.

import type { ComplianceAfterEvent, ComplianceRecurrence } from '@beaconhs/db/schema'
import {
  type RecurrenceValue,
  defaultCompletionDeadline,
  frequencyToCron,
} from '@/components/recurrence'
import { KIND_META, type ObligationKind } from './_meta'

/** Keep only the fields the chosen event uses. */
function normalizeAfterEvent(afterEvent: ComplianceAfterEvent): ComplianceAfterEvent {
  return {
    event: afterEvent.event,
    days: afterEvent.days,
    countPrior: afterEvent.countPrior,
    ...(afterEvent.event === 'job_title' ? { titleId: afterEvent.titleId } : {}),
    ...(afterEvent.event === 'group_join' ? { groupId: afterEvent.groupId } : {}),
  }
}

/** The stored recurrence for a kind, from the form's schedule value. */
export function buildRecurrence(kind: ObligationKind, r: RecurrenceValue): ComplianceRecurrence {
  const cronFor = () => r.cron?.trim() || frequencyToCron(r.frequency ?? 'week')
  // "Every N" is stored only when it is more than one unit.
  const interval = r.interval && r.interval > 1 ? r.interval : undefined
  if (kind === 'cert_requirement' || kind === 'skill_requirement' || kind === 'ppe_inspection')
    return { kind: 'expiry', remindBeforeDays: r.remindBeforeDays ?? 30 }
  if (kind === 'job_title_signoff') return { kind: 'one_time' }
  if (kind === 'form')
    return {
      kind: 'cron',
      frequency: r.frequency ?? 'week',
      cron: cronFor(),
      dueOffsetMinutes: r.dueOffsetMinutes,
      activeMonths: r.activeMonths,
    }
  if ((kind === 'training' || kind === 'document') && r.kind === 'after_event' && r.afterEvent)
    return {
      kind: 'one_time',
      afterEvent: normalizeAfterEvent(r.afterEvent),
      remindBeforeDays: r.remindBeforeDays ?? 7,
    }
  if (kind === 'training' || kind === 'document')
    return r.kind === 'one_time'
      ? { kind: 'one_time', dueOn: r.dueOn, remindBeforeDays: r.remindBeforeDays ?? 7 }
      : kind === 'document' && r.reacknowledgeOnEdition
        ? {
            kind: 'event',
            newEditionDueDays: r.newEditionDueDays ?? 30,
            remindBeforeDays: r.remindBeforeDays ?? 7,
            activeMonths: r.activeMonths,
          }
        : {
            kind: 'frequency',
            frequency: r.frequency ?? 'week',
            interval,
            // Completion cadences are a rolling window or a calendar deadline;
            // neither runs on a cron fire, so they never carry a cron or offset.
            deadline:
              r.evidenceWindow === 'calendar'
                ? (r.deadline ?? defaultCompletionDeadline(r.frequency ?? 'week'))
                : undefined,
            evidenceWindow: r.evidenceWindow ?? 'rolling',
            remindBeforeDays: r.remindBeforeDays ?? 7,
            newEditionDueDays: kind === 'document' ? r.newEditionDueDays : undefined,
            activeMonths: r.activeMonths,
          }
  // Inspection / journal / hazard assessment → frequency.
  return {
    kind: 'frequency',
    journalDays: kind === 'journal' ? r.journalDays : undefined,
    frequency: r.frequency ?? 'week',
    interval: kind === 'journal' && r.journalDays ? undefined : interval,
    cron: KIND_META[kind].recurrence.calendar ? undefined : cronFor(),
    evidenceWindow: KIND_META[kind].recurrence.calendar ? 'calendar' : undefined,
    deadline: KIND_META[kind].recurrence.calendar
      ? (r.deadline ?? defaultCompletionDeadline(r.frequency ?? 'week'))
      : undefined,
    quantity: Math.max(1, r.quantity ?? 1),
    compliantPercentage: Math.max(0, Math.min(100, r.compliantPercentage ?? 100)),
    dueOffsetMinutes: KIND_META[kind].recurrence.calendar ? undefined : r.dueOffsetMinutes,
    activeMonths: r.activeMonths,
  }
}
