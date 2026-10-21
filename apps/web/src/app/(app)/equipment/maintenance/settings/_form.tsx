'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Label, Select } from '@beaconhs/ui'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { saveEquipmentReminderSettings } from './_actions'
import {
  compileCron,
  decompileCron,
  SCHEDULE_PRESETS,
  WEEKDAYS,
  type SchedulePreset,
} from '@/lib/reminder-schedule'
export function EquipmentReminderForm({
  enabled,
  cron,
  timezone,
}: {
  enabled: boolean
  cron: string
  timezone: string
}) {
  const t = useGeneratedValueTranslations(),
    router = useRouter(),
    [on, setOn] = useState(enabled),
    [schedule, setSchedule] = useState(() => decompileCron(cron)),
    [error, setError] = useState<string | null>(null),
    [pending, start] = useTransition()
  return (
    <form
      className="max-w-xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        start(async () => {
          try {
            const result = await saveEquipmentReminderSettings({
              enabled: on,
              cron: compileCron(schedule.preset, schedule.hour, schedule.weekday, schedule.custom),
            })
            if (!result.ok) {
              setError(result.error)
              return
            }
            router.push('/equipment/maintenance')
            router.refresh()
          } catch {
            setError('Could not save equipment reminder settings.')
          }
        })
      }}
    >
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <GeneratedValue value="Send equipment maintenance reminders" />
      </label>
      <div className="space-y-2">
        <Label htmlFor="equipment-reminder-schedule">
          <GeneratedValue value="Reminder schedule" />
        </Label>
        <Select
          id="equipment-reminder-schedule"
          value={schedule.preset}
          onChange={(e) => setSchedule({ ...schedule, preset: e.target.value as SchedulePreset })}
        >
          {SCHEDULE_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </Select>
        {['daily', 'twice_daily', 'weekly'].includes(schedule.preset) ? (
          <>
            <Label htmlFor="equipment-reminder-time">
              <GeneratedValue value="Reminder time" />
            </Label>
            <Input
              id="equipment-reminder-time"
              type="time"
              step={3600}
              value={`${String(schedule.hour).padStart(2, '0')}:00`}
              onChange={(e) => {
                const hour = Number(e.target.value.split(':')[0])
                if (Number.isFinite(hour)) setSchedule({ ...schedule, hour })
              }}
              required
            />
          </>
        ) : null}
        {schedule.preset === 'weekly' ? (
          <>
            <Label htmlFor="equipment-reminder-day">
              <GeneratedValue value="Day" />
            </Label>
            <Select
              id="equipment-reminder-day"
              value={String(schedule.weekday)}
              onChange={(e) => setSchedule({ ...schedule, weekday: Number(e.target.value) })}
            >
              {WEEKDAYS.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </Select>
          </>
        ) : null}
        {schedule.preset === 'custom' ? (
          <Input
            aria-label={t('Custom schedule')}
            value={schedule.custom}
            onChange={(e) => setSchedule({ ...schedule, custom: e.target.value })}
            placeholder="0 6 * * *"
            required
          />
        ) : null}
        <p className="text-xs text-slate-500">
          <GeneratedValue value="Timezone" />: <GeneratedValue value={timezone} />
        </p>
      </div>
      <p className="text-sm text-slate-500">
        <GeneratedValue value="Inspection schedules stay visible and current when reminders are off. These settings are independent of compliance reminders. Recipients and delivery channels use the Equipment category under Admin → Notifications." />
      </p>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          <GeneratedValue value={error} />
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {t(pending ? 'Saving…' : 'Save')}
      </Button>
    </form>
  )
}
