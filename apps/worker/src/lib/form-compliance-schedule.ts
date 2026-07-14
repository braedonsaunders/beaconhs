import type { ComplianceRecurrence } from '@beaconhs/db/schema'
import { cronOccursAt } from './cron'

/**
 * A form obligation needs evaluation at the fire (new period) and one minute
 * after its deadline (the first whole-minute tick that is actually overdue).
 */
export function formComplianceBoundaryDue(
  recurrence: ComplianceRecurrence,
  at: Date,
  timezone: string,
): boolean {
  if (recurrence.kind !== 'cron' || !recurrence.cron?.trim()) {
    throw new Error('Form compliance recurrence must be a cron schedule')
  }
  const offsetMinutes = recurrence.dueOffsetMinutes ?? 0
  const offsetDays = recurrence.dueOffsetDays ?? 0
  if (
    !Number.isSafeInteger(offsetMinutes) ||
    offsetMinutes < 0 ||
    !Number.isSafeInteger(offsetDays) ||
    offsetDays < 0
  ) {
    throw new Error('Form compliance due offset must use non-negative whole numbers')
  }
  const offset = offsetMinutes + offsetDays * 24 * 60
  if (!Number.isSafeInteger(offset)) throw new Error('Form compliance due offset is too large')
  if (cronOccursAt(recurrence.cron, at, timezone)) return true
  const sourceFire = new Date(at.getTime() - (offset + 1) * 60_000)
  return cronOccursAt(recurrence.cron, sourceFire, timezone)
}
