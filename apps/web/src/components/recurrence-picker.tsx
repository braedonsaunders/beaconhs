'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  useGeneratedValueTranslations,
  GeneratedValue,
} from '@/i18n/generated'

// Shared recurrence / schedule builder for compliance obligations.
//
// Generalised from the inspection assignment drawer's cadence→cron presets. The
// `RecurrenceValue` shape mirrors the unified `ComplianceRecurrence` (M3) so the
// obligation form's payload survives the engine swap unchanged.
//
// Controlled. The `fields` prop selects which knobs render — each obligation
// kind exposes a different subset (e.g. inspections/journals show quantity +
// threshold; documents/training show a one-time due date; training shows a
// reminder lead). Hidden entirely for one-off kinds (corrective actions).
//
// The pure model (types, FREQUENCIES, frequencyToCron, recurrenceValueFromStored)
// lives in `./recurrence` so server code can use it too.

import { Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import {
  AFTER_EVENT_OPTIONS,
  FREQUENCIES,
  frequencyUnit,
  CALENDAR_MONTHS,
  CALENDAR_WEEKDAYS,
  defaultCompletionDeadline,
  type Frequency,
  type RecurrenceFields,
  type RecurrenceKind,
  type RecurrenceValue,
} from './recurrence'

type PickedOption = { id: string; label: string }

export function RecurrencePicker({
  value,
  onChange,
  fields,
  title = 'Schedule',
  afterEventTitle,
  afterEventGroup,
}: {
  value: RecurrenceValue
  onChange: (next: RecurrenceValue) => void
  fields: RecurrenceFields
  title?: string
  /** Label of the stored after-event job title, so the picker opens filled in. */
  afterEventTitle?: PickedOption
  /** Label of the stored after-event people group. */
  afterEventGroup?: PickedOption
}) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const frequency = value.frequency ?? 'week'
  const calendar = fields.calendar || (fields.rolling && value.evidenceWindow === 'calendar')
  const deadline = value.deadline ?? defaultCompletionDeadline(frequency)
  const set = (patch: Partial<RecurrenceValue>) => onChange({ ...value, ...patch })
  const setDeadline = (patch: Partial<typeof deadline>) =>
    set({ deadline: { ...deadline, ...patch } })

  const afterEvent = value.afterEvent ?? { event: 'hire' as const, days: 30, countPrior: false }
  const setAfterEvent = (patch: Partial<typeof afterEvent>) =>
    set({ afterEvent: { ...afterEvent, ...patch } })
  // Custom cron schedules set their own spacing, so only preset cadences repeat every N.
  const showInterval = fields.recurring && (fields.rolling || fields.calendar)
  const interval = value.interval ?? 1

  const kinds: { value: RecurrenceKind; label: string }[] = []
  if (fields.oneTime) kinds.push({ value: 'one_time', label: 'One-time (single due date)' })
  if (fields.oneTime) kinds.push({ value: 'after_event', label: 'One-time (after an event)' })
  if (fields.recurring) kinds.push({ value: 'frequency', label: 'Recurring (cadence)' })

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <GeneratedValue value={title} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <GeneratedValue
          value={
            kinds.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor="rec-kind">
                  <GeneratedText id="m_0c71ccdfab354c" />
                </Label>
                <Select
                  id="rec-kind"
                  value={value.kind}
                  onChange={(e) =>
                    set({
                      kind: e.target.value as RecurrenceKind,
                      evidenceWindow:
                        e.target.value === 'frequency' && fields.rolling ? 'rolling' : undefined,
                      deadline: undefined,
                      cron: undefined,
                      dueOffsetMinutes: undefined,
                      afterEvent: e.target.value === 'after_event' ? afterEvent : undefined,
                    })
                  }
                >
                  {kinds.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null
          }
        />

        {fields.rolling && value.kind === 'frequency' ? (
          <div className="space-y-1.5">
            <Label htmlFor="rec-window">
              <GeneratedValue value="Completion window" />
            </Label>
            <Select
              id="rec-window"
              value={value.evidenceWindow ?? 'rolling'}
              onChange={(event) =>
                set({
                  evidenceWindow: event.target.value as 'calendar' | 'rolling',
                  deadline:
                    event.target.value === 'calendar'
                      ? defaultCompletionDeadline(frequency)
                      : undefined,
                  cron: undefined,
                  dueOffsetMinutes: undefined,
                })
              }
            >
              <option value="rolling">
                <GeneratedValue value="Rolling period since completion" />
              </option>
              <option value="calendar">
                <GeneratedValue value="Calendar schedule" />
              </option>
            </Select>
            {value.evidenceWindow !== 'calendar' ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <GeneratedValue value="Rolling training looks back from today. Monthly validity lasts one calendar month after completion; yearly validity lasts 12 months. Each person's due date follows their last successful completion." />
              </p>
            ) : null}
          </div>
        ) : null}
        {fields.oneTime && value.kind === 'after_event' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rec-event">
                <GeneratedValue value="Starts from" />
              </Label>
              <Select
                id="rec-event"
                value={afterEvent.event}
                onChange={(e) =>
                  setAfterEvent({
                    event: e.target.value as typeof afterEvent.event,
                    titleId: undefined,
                    groupId: undefined,
                  })
                }
              >
                {AFTER_EVENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-event-days">
                <GeneratedValue value="Due within (days)" />
              </Label>
              <Input
                id="rec-event-days"
                type="number"
                min={0}
                max={3650}
                step={1}
                value={afterEvent.days}
                onChange={(e) => {
                  const next = Number(e.target.value)
                  setAfterEvent({
                    days: Number.isFinite(next) ? Math.max(0, Math.min(3650, Math.trunc(next))) : 0,
                  })
                }}
              />
            </div>
            {afterEvent.event === 'job_title' ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>
                  <GeneratedValue value="Job title" />
                </Label>
                <RemoteSearchSelect
                  lookup="compliance-obligation-job-titles"
                  value={afterEvent.titleId ?? ''}
                  onChange={(id) => setAfterEvent({ titleId: id || undefined })}
                  initialOption={
                    afterEventTitle
                      ? { value: afterEventTitle.id, label: afterEventTitle.label }
                      : undefined
                  }
                  placeholder={tGeneratedValue('Pick a job title')}
                  searchPlaceholder={tGeneratedValue('Search job titles')}
                  sheetTitle={tGeneratedValue('Pick a job title')}
                  ariaLabel={tGeneratedValue('Job title')}
                />
              </div>
            ) : null}
            {afterEvent.event === 'group_join' ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>
                  <GeneratedValue value="People group" />
                </Label>
                <RemoteSearchSelect
                  lookup="compliance-obligation-audience-groups"
                  value={afterEvent.groupId ?? ''}
                  onChange={(id) => setAfterEvent({ groupId: id || undefined })}
                  initialOption={
                    afterEventGroup
                      ? { value: afterEventGroup.id, label: afterEventGroup.label }
                      : undefined
                  }
                  placeholder={tGeneratedValue('Pick a people group')}
                  searchPlaceholder={tGeneratedValue('Search people groups')}
                  sheetTitle={tGeneratedValue('Pick a people group')}
                  ariaLabel={tGeneratedValue('People group')}
                />
              </div>
            ) : null}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rec-event-prior">
                <GeneratedValue value="Earlier completions" />
              </Label>
              <Select
                id="rec-event-prior"
                value={afterEvent.countPrior ? 'count' : 'after'}
                onChange={(e) => setAfterEvent({ countPrior: e.target.value === 'count' })}
              >
                <option value="after">
                  <GeneratedValue value="Must be done again after the event" />
                </option>
                <option value="count">
                  <GeneratedValue value="Any completion counts, even from before" />
                </option>
              </Select>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <GeneratedValue
                  value={
                    afterEvent.event === 'hire'
                      ? 'Each person is due this many days after their hire date. People without a hire date stay required with no due date.'
                      : afterEvent.event === 'audience_join'
                        ? 'Each person is due this many days after they first fall under this requirement. Someone who leaves and comes back starts again.'
                        : afterEvent.event === 'job_title'
                          ? 'Only people holding this title are required, each due this many days after it was assigned.'
                          : 'Only members of this group are required, each due this many days after they were added.'
                  }
                />
              </p>
            </div>
          </div>
        ) : null}
        <GeneratedValue
          value={
            fields.oneTime && value.kind === 'one_time' ? (
              <div className="space-y-1.5">
                <Label htmlFor="rec-due">
                  <GeneratedText id="m_18244bb4488b03" />
                </Label>
                <Input
                  id="rec-due"
                  type="date"
                  value={value.dueOn ?? ''}
                  onChange={(e) => set({ dueOn: e.target.value || undefined })}
                />
              </div>
            ) : fields.recurring && value.kind !== 'after_event' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rec-freq">
                    <GeneratedText id="m_1151ed0308b6d1" />
                  </Label>
                  <Select
                    id="rec-freq"
                    value={value.frequency ?? 'week'}
                    onChange={(e) =>
                      set({
                        frequency: e.target.value as Frequency,
                        deadline: calendar
                          ? defaultCompletionDeadline(e.target.value as Frequency)
                          : undefined,
                      })
                    }
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                        {fields.rolling || fields.calendar ? '' : ` (${f.cron})`}
                      </option>
                    ))}
                  </Select>
                </div>
                {showInterval ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-interval">
                      <GeneratedValue value="Repeat every" />
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="rec-interval"
                        type="number"
                        min={1}
                        max={99}
                        step={1}
                        className="w-24"
                        value={interval}
                        disabled={Boolean(value.journalDays)}
                        onChange={(e) => {
                          const next = Number(e.target.value)
                          set({
                            interval: Number.isFinite(next)
                              ? Math.max(1, Math.min(99, Math.trunc(next)))
                              : 1,
                          })
                        }}
                      />
                      <span className="text-sm text-slate-600 dark:text-slate-300">
                        <GeneratedValue value={frequencyUnit(frequency, interval)} />
                      </span>
                    </div>
                  </div>
                ) : null}
                {!fields.rolling && !fields.calendar ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-cron">
                      <GeneratedText id="m_0f75fbe6acc6db" />
                    </Label>
                    <Input
                      id="rec-cron"
                      value={value.cron ?? ''}
                      onChange={(e) => set({ cron: e.target.value || undefined })}
                      placeholder={tGenerated('m_1509ce693ccc4f')}
                    />
                  </div>
                ) : null}
                <GeneratedValue
                  value={
                    fields.quantity ? (
                      <div className="space-y-1.5">
                        <Label htmlFor="rec-qty">
                          <GeneratedText id="m_13adfb08c5ed8b" />
                        </Label>
                        <Input
                          id="rec-qty"
                          type="number"
                          min={1}
                          step={1}
                          value={value.quantity ?? 1}
                          onChange={(e) => {
                            const next = Number(e.target.value)
                            set({
                              quantity: Number.isFinite(next) ? Math.max(1, Math.trunc(next)) : 1,
                            })
                          }}
                        />
                      </div>
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    fields.threshold ? (
                      <div className="space-y-1.5">
                        <Label htmlFor="rec-pct">
                          <GeneratedText id="m_11c19fc3db953d" />
                        </Label>
                        <Input
                          id="rec-pct"
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={value.compliantPercentage ?? 100}
                          onChange={(e) => {
                            const next = Number(e.target.value)
                            set({
                              compliantPercentage: Number.isFinite(next)
                                ? Math.max(0, Math.min(100, next))
                                : 100,
                            })
                          }}
                        />
                      </div>
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    fields.dueOffset && !calendar ? (
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="rec-off">
                          <GeneratedText id="m_11bc5b3e56eaa6" />
                        </Label>
                        <Input
                          id="rec-off"
                          type="number"
                          min={0}
                          step={1}
                          value={value.dueOffsetMinutes ?? ''}
                          onChange={(e) =>
                            set({
                              dueOffsetMinutes:
                                e.target.value === '' ? undefined : Number(e.target.value),
                            })
                          }
                          placeholder={tGenerated('m_0bfdd812b8d1e8')}
                        />
                      </div>
                    ) : null
                  }
                />
              </div>
            ) : null
          }
        />

        {calendar && value.kind === 'frequency' ? (
          <div className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-800">
            <p className="text-sm font-medium">
              <GeneratedValue value="Due by" />
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              <GeneratedValue
                value={
                  fields.quantity
                    ? 'Meet the submission target during this period. Weeks run Monday to Sunday. Work is overdue only after the deadline. Times follow the compliance timezone.'
                    : "Complete once in each calendar period by this deadline. Days beyond the end of a short month use that month's last day. Times follow the compliance timezone."
                }
              />
            </p>
            <div className="grid grid-cols-2 gap-3">
              {frequency === 'year' || frequency === 'quarter' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="rec-deadline-month">
                    <GeneratedValue value={frequency === 'year' ? 'Month' : 'Month of quarter'} />
                  </Label>
                  <Select
                    id="rec-deadline-month"
                    value={deadline.month ?? 1}
                    onChange={(event) => setDeadline({ month: Number(event.target.value) })}
                  >
                    {Array.from({ length: frequency === 'year' ? 12 : 3 }, (_, index) => (
                      <option key={index + 1} value={index + 1}>
                        {frequency === 'year' ? (
                          <GeneratedValue value={CALENDAR_MONTHS[index]} />
                        ) : (
                          index + 1
                        )}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              {frequency !== 'day' && frequency !== 'week' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="rec-deadline-day">
                    <GeneratedValue value="Day of month" />
                  </Label>
                  <Input
                    id="rec-deadline-day"
                    type="number"
                    min={1}
                    max={31}
                    step={1}
                    value={deadline.day ?? 31}
                    onChange={(event) => setDeadline({ day: Number(event.target.value) })}
                  />
                </div>
              ) : null}
              {frequency === 'week' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="rec-deadline-weekday">
                    <GeneratedValue value="Day of week" />
                  </Label>
                  <Select
                    id="rec-deadline-weekday"
                    value={deadline.weekday ?? 7}
                    onChange={(event) => setDeadline({ weekday: Number(event.target.value) })}
                  >
                    {CALENDAR_WEEKDAYS.map((day, index) => (
                      <option key={day} value={index + 1}>
                        <GeneratedValue value={day} />
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="rec-deadline-time">
                  <GeneratedValue value="Deadline time" />
                </Label>
                <Input
                  id="rec-deadline-time"
                  type="time"
                  value={deadline.time}
                  onChange={(event) => setDeadline({ time: event.target.value })}
                />
              </div>
            </div>
          </div>
        ) : null}
        <GeneratedValue
          value={
            fields.remind ? (
              <div className="space-y-1.5">
                <Label htmlFor="rec-remind">
                  <GeneratedText id="m_1c4240b068c336" />
                </Label>
                <Input
                  id="rec-remind"
                  type="number"
                  min={0}
                  value={value.remindBeforeDays ?? 7}
                  onChange={(e) =>
                    set({
                      remindBeforeDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)),
                    })
                  }
                />
              </div>
            ) : null
          }
        />
      </CardContent>
    </Card>
  )
}
