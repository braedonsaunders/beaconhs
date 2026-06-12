// Pure recurrence model + helpers shared by the RecurrencePicker (client), the
// obligation server actions, and the obligation edit page (server). Keep this
// module free of 'use client' — server components must be able to CALL these.

export type Frequency = 'day' | 'week' | 'month' | 'quarter' | 'year'

export type RecurrenceKind = 'one_time' | 'frequency' | 'cron'

export type RecurrenceValue = {
  kind: RecurrenceKind
  frequency?: Frequency
  cron?: string
  quantity?: number
  compliantPercentage?: number
  dueOn?: string
  remindBeforeDays?: number
  dueOffsetMinutes?: number
}

export const FREQUENCIES: Array<{ value: Frequency; label: string; cron: string }> = [
  { value: 'day', label: 'Daily', cron: '0 8 * * *' },
  { value: 'week', label: 'Weekly', cron: '0 8 * * 1' },
  { value: 'month', label: 'Monthly', cron: '0 8 1 * *' },
  { value: 'quarter', label: 'Quarterly', cron: '0 8 1 */3 *' },
  { value: 'year', label: 'Yearly', cron: '0 8 1 1 *' },
]

export function frequencyToCron(f: Frequency): string {
  return FREQUENCIES.find((x) => x.value === f)?.cron ?? '0 8 * * 1'
}

export type RecurrenceFields = {
  /** Allow a one-time (single due date) cadence. */
  oneTime?: boolean
  /** Allow a recurring (frequency/cron) cadence. */
  recurring?: boolean
  /** Show quantity-per-period (inspection / journal). */
  quantity?: boolean
  /** Show the compliant-threshold % (inspection / journal). */
  threshold?: boolean
  /** Show the reminder lead-days (training). */
  remind?: boolean
  /** Show the due-offset minutes (inspection / form). */
  dueOffset?: boolean
}

/**
 * Inverse of the obligation action's `buildRecurrence`: map a stored
 * `ComplianceRecurrence` jsonb back to the form's `RecurrenceValue` so the edit
 * page can seed the picker. Stored `cron` recurrences surface as a frequency
 * when the cron matches a preset, otherwise as a cron override; `expiry`/`event`
 * kinds have no schedule knobs in the form and just get the defaults.
 */
export function recurrenceValueFromStored(rec: {
  kind: string
  frequency?: Frequency
  cron?: string
  quantity?: number
  compliantPercentage?: number
  dueOn?: string
  remindBeforeDays?: number
  dueOffsetMinutes?: number
}): RecurrenceValue {
  if (rec.kind === 'one_time') {
    return { kind: 'one_time', dueOn: rec.dueOn, remindBeforeDays: rec.remindBeforeDays ?? 7 }
  }
  if (rec.kind === 'frequency' || rec.kind === 'cron') {
    const preset = rec.cron ? FREQUENCIES.find((f) => f.cron === rec.cron) : undefined
    const frequency = rec.frequency ?? preset?.value ?? 'week'
    const isPresetCron = Boolean(rec.cron) && rec.cron === frequencyToCron(frequency)
    return {
      kind: 'frequency',
      frequency,
      cron: isPresetCron ? undefined : rec.cron,
      quantity: rec.quantity ?? 1,
      compliantPercentage: rec.compliantPercentage ?? 100,
      remindBeforeDays: rec.remindBeforeDays ?? 7,
      dueOffsetMinutes: rec.dueOffsetMinutes,
    }
  }
  // expiry / event — the form shows no schedule knobs for these kinds.
  return {
    kind: 'one_time',
    frequency: 'week',
    quantity: 1,
    compliantPercentage: 100,
    remindBeforeDays: rec.remindBeforeDays ?? 7,
  }
}
