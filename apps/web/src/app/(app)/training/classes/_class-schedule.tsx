'use client'

// The class Start / End pair. Both times save together as one `schedule` edit
// (see ./_record-edits.ts), so a manager can move a class to another day
// without passing through an end-before-start state. The range is checked
// here as they type for immediate feedback; the saver enforces the same rule
// and refuses an unordered range (which also holds back Email class until
// the schedule is fixed).

import { Input, Label } from '@beaconhs/ui'
import { SaveDot } from '@/components/live-field'
import { useRecordField } from '@/lib/offline-drafts/offline-record'
import { GeneratedValue } from '@/i18n/generated'

type ScheduleRange = { startsAt: string; endsAt: string }

export function ClassSchedule({
  startsAt,
  endsAt,
  disabled,
}: {
  /** `YYYY-MM-DDTHH:mm` in the worker's timezone. */
  startsAt: string
  endsAt: string
  disabled?: boolean
}) {
  const f = useRecordField<ScheduleRange>('schedule', { startsAt, endsAt })
  const off = disabled || f.paused
  const range = f.value
  const invalid = !range.startsAt || !range.endsAt || range.endsAt <= range.startsAt
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(['startsAt', 'endsAt'] as const).map((field) => (
          <div key={field} className="space-y-1">
            <Label htmlFor={`class-${field}`}>
              <GeneratedValue value={field === 'startsAt' ? 'Starts' : 'Ends'} />
            </Label>
            <Input
              id={`class-${field}`}
              type="datetime-local"
              value={range[field]}
              disabled={off}
              onChange={(event) => f.change({ ...range, [field]: event.target.value })}
              onBlur={() => f.commit()}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <SaveDot state={f.saveState} error={f.error} onRetry={f.retry} />
        <GeneratedValue value="Start and end times save together." />
      </div>
      {invalid && !off ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          <GeneratedValue value="Enter both times. End must be after Start before the schedule can save." />
        </p>
      ) : null}
    </div>
  )
}
