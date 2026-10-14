'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Label,
  Select,
  Textarea,
  UrlDrawer,
} from '@beaconhs/ui'
import type { BriefWindowSpec } from '@beaconhs/db/schema'
import { RemoteMultiSelect } from '@/components/remote-multi-select'
import type { PickerOption } from '@/lib/picker-options'
import { GeneratedText, GeneratedValue, useGeneratedTranslations } from '@/i18n/generated'
import { saveBriefSchedule } from '@/lib/briefs/actions'

export type ScheduleDraft = {
  id: string | null
  name: string
  cadence: 'daily' | 'weekly' | 'monthly'
  repeatEvery: number
  weekdaysOnly: boolean
  dayOfWeek: number | null
  dayOfMonth: number | null
  hour: number
  minute: number
  timezone: string
  window: BriefWindowSpec
  split: 'none' | 'department'
  users: PickerOption[]
  groups: PickerOption[]
  emails: string[]
  emailSubject: string
  active: boolean
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function ScheduleDrawer({
  briefId,
  draft,
  closeHref,
}: {
  briefId: string
  draft: ScheduleDraft
  closeHref: string
}) {
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [value, setValue] = useState(draft)
  const [emailsText, setEmailsText] = useState(draft.emails.join('\n'))
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const set = (patch: Partial<ScheduleDraft>) => setValue((current) => ({ ...current, ...patch }))
  const time = `${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`

  function save() {
    setError(null)
    start(async () => {
      const result = await saveBriefSchedule({
        id: value.id,
        briefId,
        name: value.name,
        cadence: value.cadence,
        repeatEvery: value.repeatEvery,
        weekdaysOnly: value.weekdaysOnly,
        dayOfWeek: value.dayOfWeek,
        dayOfMonth: value.dayOfMonth,
        hour: value.hour,
        minute: value.minute,
        timezone: value.timezone,
        window: value.window,
        split: value.split,
        recipientUserIds: value.users.map((u) => u.value),
        recipientGroupIds: value.groups.map((g) => g.value),
        recipientEmails: emailsText
          .split(/[\s,;]+/)
          .map((e) => e.trim())
          .filter(Boolean),
        emailSubject: value.emailSubject,
        active: value.active,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(closeHref as never, { scroll: false })
      router.refresh()
    })
  }

  return (
    <UrlDrawer
      open
      closeHref={closeHref}
      size="lg"
      title={value.id ? tGenerated('m_00ec9d8b3bea44') : tGenerated('m_0f2dd0043302a1')}
      description={tGenerated('m_0449ac1c74dd01')}
      footer={
        <Button onClick={save} disabled={pending}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : null}
          <GeneratedText id="m_094591d6c7ec4e" />
        </Button>
      }
    >
      <div className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>
              <GeneratedValue value={error} />
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="schedule-name">
            <GeneratedText id="m_02b18d5c7f6f2d" />
          </Label>
          <Input
            id="schedule-name"
            value={value.name}
            maxLength={120}
            onChange={(e) => set({ name: e.currentTarget.value })}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="schedule-cadence">
              <GeneratedText id="m_1a02a86385b88b" />
            </Label>
            <Select
              id="schedule-cadence"
              value={value.cadence}
              onChange={(e) => set({ cadence: e.currentTarget.value as ScheduleDraft['cadence'] })}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="schedule-time">
              <GeneratedText id="m_1cf3bee1218779" />
            </Label>
            <Input
              id="schedule-time"
              type="time"
              value={time}
              onChange={(e) => {
                const [h, m] = e.currentTarget.value.split(':').map(Number)
                set({ hour: h ?? 0, minute: m ?? 0 })
              }}
            />
          </div>
          {value.cadence === 'daily' ? (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-teal-600"
                checked={value.weekdaysOnly}
                onChange={(e) => set({ weekdaysOnly: e.currentTarget.checked })}
              />
              <GeneratedText id="m_13d7139d6f5186" />
            </label>
          ) : null}
          {value.cadence === 'weekly' ? (
            <div className="space-y-1.5">
              <Label htmlFor="schedule-weekday">
                <GeneratedText id="m_0738c9c7544385" />
              </Label>
              <Select
                id="schedule-weekday"
                value={String(value.dayOfWeek ?? 1)}
                onChange={(e) => set({ dayOfWeek: Number(e.currentTarget.value) })}
              >
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={String(index)}>
                    {day}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {value.cadence === 'monthly' ? (
            <div className="space-y-1.5">
              <Label htmlFor="schedule-monthday">
                <GeneratedText id="m_01dbee2be05119" />
              </Label>
              <Input
                id="schedule-monthday"
                type="number"
                min={1}
                max={28}
                value={value.dayOfMonth ?? 1}
                onChange={(e) =>
                  set({ dayOfMonth: Math.min(28, Math.max(1, Number(e.currentTarget.value) || 1)) })
                }
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="schedule-timezone">
              <GeneratedText id="m_14c7a1feb33b17" />
            </Label>
            <Input
              id="schedule-timezone"
              value={value.timezone}
              onChange={(e) => set({ timezone: e.currentTarget.value })}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="schedule-window">
              <GeneratedText id="m_13a097460d6c85" />
            </Label>
            <Select
              id="schedule-window"
              value={value.window.mode}
              onChange={(e) => {
                const mode = e.currentTarget.value as BriefWindowSpec['mode']
                set({
                  window:
                    mode === 'last_n_days' ? { mode, days: 7 } : ({ mode } as BriefWindowSpec),
                })
              }}
            >
              <option value="previous_business_day">The previous business day</option>
              <option value="previous_day">The previous day</option>
              <option value="last_n_days">The last number of days</option>
              <option value="since_last_run">Everything since the last brief</option>
            </Select>
          </div>
          {value.window.mode === 'last_n_days' ? (
            <div className="space-y-1.5">
              <Label htmlFor="schedule-days">
                <GeneratedText id="m_050b821cd4a945" />
              </Label>
              <Input
                id="schedule-days"
                type="number"
                min={1}
                max={92}
                value={value.window.days}
                onChange={(e) =>
                  set({
                    window: {
                      mode: 'last_n_days',
                      days: Math.min(92, Math.max(1, Number(e.currentTarget.value) || 1)),
                    },
                  })
                }
              />
            </div>
          ) : null}
        </div>
        {value.window.mode === 'previous_business_day' ? (
          <p className="text-xs text-slate-500">
            <GeneratedText id="m_02f1237a71bfba" />
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_0ef3898622f868" />
          </Label>
          <RemoteMultiSelect
            lookup="brief-recipient-users"
            value={value.users}
            onChange={(users) => set({ users })}
            placeholder={tGenerated('m_1792ef096e2128')}
            max={200}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_00a9926beb1db6" />
          </Label>
          <RemoteMultiSelect
            lookup="brief-recipient-groups"
            value={value.groups}
            onChange={(groups) => set({ groups })}
            placeholder={tGenerated('m_059b16f0ac25bf')}
            max={50}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="schedule-emails">
            <GeneratedText id="m_07ea9ed5fec2cc" />
          </Label>
          <Textarea
            id="schedule-emails"
            rows={2}
            value={emailsText}
            disabled={value.split === 'department'}
            placeholder={tGenerated('m_1d0b98bac8dd53')}
            onChange={(e) => setEmailsText(e.currentTarget.value)}
          />
        </div>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600"
            checked={value.split === 'department'}
            onChange={(e) => set({ split: e.currentTarget.checked ? 'department' : 'none' })}
          />
          <span>
            <span className="block font-medium text-slate-800 dark:text-slate-200">
              <GeneratedText id="m_0132cd57cbec30" />
            </span>
            <span className="block text-xs text-slate-500">
              <GeneratedText id="m_1816e85468fa3d" />
            </span>
          </span>
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="schedule-subject">
            <GeneratedText id="m_1068a3e3bdba33" />
          </Label>
          <Input
            id="schedule-subject"
            value={value.emailSubject}
            maxLength={200}
            placeholder={tGenerated('m_0be141b93e9fe6')}
            onChange={(e) => set({ emailSubject: e.currentTarget.value })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-teal-600"
            checked={value.active}
            onChange={(e) => set({ active: e.currentTarget.checked })}
          />
          <GeneratedText id="m_1e1b1fdb7dd78e" />
        </label>
        <p className="text-xs text-slate-500">
          <GeneratedText id="m_08e7e6f8abfb5d" />
        </p>
      </div>
    </UrlDrawer>
  )
}
