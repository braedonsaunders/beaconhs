'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Shared subscribe/edit schedule form. Posts the exact field contract the
// existing create/update server actions read (definitionId, cadence parts,
// recipientUserIds, recipientEmails, filters-as-JSON) — but composes those
// from humane controls: member checkboxes instead of UUID textareas, a days
// window instead of raw JSON (still available under "Advanced").

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Button, Input, Label, SearchSelect, Select, Textarea } from '@beaconhs/ui'
import { REPORT_SCHEDULE_LIMITS } from '@beaconhs/reports/schedule-policy'

export type ScheduleFormDefinition = {
  id: string
  name: string
  category: string | null
  kind: 'built_in' | 'custom'
  description: string | null
}

export type ScheduleFormMember = { userId: string; name: string; email: string }

type ScheduleFormInitial = {
  definitionId?: string
  name?: string
  cadence?: 'daily' | 'weekly' | 'monthly'
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  hour?: number
  minute?: number
  timezone?: string
  recipientUserIds?: string[]
  recipientEmails?: string[]
  filters?: Record<string, unknown>
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function ScheduleForm({
  definitions,
  members,
  initial,
  submitLabel,
  action,
  extraFooter,
}: {
  definitions: ScheduleFormDefinition[]
  members: ScheduleFormMember[]
  initial?: ScheduleFormInitial
  submitLabel: string
  action: (formData: FormData) => Promise<void>
  extraFooter?: React.ReactNode
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [definitionId, setDefinitionId] = useState(
    initial?.definitionId ?? definitions[0]?.id ?? '',
  )
  const definition = definitions.find((d) => d.id === definitionId)
  const [name, setName] = useState(initial?.name ?? '')
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly'>(
    initial?.cadence ?? 'weekly',
  )
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(
    () => new Set(initial?.recipientUserIds ?? []),
  )

  // The stored filters minus the `days` key we manage with a dedicated input.
  const { days: initialDays, ...initialAdvanced } = (initial?.filters ?? {}) as Record<
    string,
    unknown
  >
  const [days, setDays] = useState<string>(
    typeof initialDays === 'number' ? String(initialDays) : '',
  )
  const [advanced, setAdvanced] = useState<string>(
    Object.keys(initialAdvanced).length ? JSON.stringify(initialAdvanced, null, 2) : '',
  )

  const { filtersJson, advancedError } = useMemo(() => {
    let base: Record<string, unknown> = {}
    let err: string | null = null
    if (advanced.trim()) {
      try {
        const parsed = JSON.parse(advanced)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          base = parsed as Record<string, unknown>
        } else {
          err = 'Advanced filters must be a JSON object'
        }
      } catch (e) {
        err = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    const n = Number(days)
    if (days.trim() && Number.isFinite(n) && n > 0) base = { ...base, days: n }
    return { filtersJson: JSON.stringify(base), advancedError: err }
  }, [advanced, days])

  function toggleUser(id: string) {
    setSelectedUsers((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="recipientUserIds" value={Array.from(selectedUsers).join(',')} />
      <input type="hidden" name="filters" value={filtersJson} />

      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_0ab5a972fc80fd" /> <span className="text-red-600">*</span>
        </Label>
        <Select
          name="definitionId"
          value={definitionId}
          onChange={(e) => setDefinitionId(e.target.value)}
        >
          {definitions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.kind === 'custom' ? '(custom)' : ''}
            </option>
          ))}
        </Select>
        <GeneratedValue
          value={
            definition?.description ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <GeneratedValue value={definition.description} />
              </p>
            ) : null
          }
        />
      </div>

      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_0fcdcb15bd7604" /> <span className="text-red-600">*</span>
        </Label>
        <Input
          name="name"
          required
          maxLength={REPORT_SCHEDULE_LIMITS.nameChars}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={tGeneratedValue(
            definition ? `${definition.name} — ${cadence}` : tGenerated('m_0e6260addabf9b'),
          )}
        />
      </div>

      <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <GeneratedText id="m_03db87cb2e7846" />
        </legend>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_1151ed0308b6d1" />
            </Label>
            <Select
              name="cadence"
              value={cadence}
              onChange={(e) => setCadence(e.target.value as typeof cadence)}
            >
              <option value="daily">{'Daily'}</option>
              <option value="weekly">{'Weekly'}</option>
              <option value="monthly">{'Monthly'}</option>
            </Select>
          </div>
          <GeneratedValue
            value={
              cadence === 'weekly' ? (
                <div className="space-y-1.5">
                  <Label>
                    <GeneratedText id="m_0738c9c7544385" />
                  </Label>
                  <Select name="dayOfWeek" defaultValue={String(initial?.dayOfWeek ?? 1)}>
                    {DOW.map((d, i) => (
                      <option key={d} value={String(i)}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null
            }
          />
          <GeneratedValue
            value={
              cadence === 'monthly' ? (
                <div className="space-y-1.5">
                  <Label>
                    <GeneratedText id="m_1f8ef50bb3fd8d" />
                  </Label>
                  <Input
                    name="dayOfMonth"
                    type="number"
                    min={1}
                    max={31}
                    defaultValue={initial?.dayOfMonth ?? 1}
                  />
                </div>
              ) : null
            }
          />
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_1cf3bee1218779" />
            </Label>
            <div className="flex items-center gap-1">
              <Input
                name="hour"
                type="number"
                min={0}
                max={23}
                defaultValue={initial?.hour ?? 7}
                required
                className="w-18"
                aria-label={tGenerated('m_1cdd126cee80c8')}
              />
              <span className="text-slate-400">:</span>
              <Input
                name="minute"
                type="number"
                min={0}
                max={59}
                defaultValue={initial?.minute ?? 0}
                required
                className="w-18"
                aria-label={tGenerated('m_13b09b05ab2247')}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_14c7a1feb33b17" />
            </Label>
            <Input
              name="timezone"
              required
              maxLength={REPORT_SCHEDULE_LIMITS.timezoneChars}
              defaultValue={initial?.timezone ?? 'America/Toronto'}
              list="report-tz-options"
            />
            <datalist id="report-tz-options">
              <option value="America/Toronto" />
              <option value="America/Vancouver" />
              <option value="America/Edmonton" />
              <option value="America/Winnipeg" />
              <option value="America/Halifax" />
              <option value="America/St_Johns" />
              <option value="UTC" />
            </datalist>
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <GeneratedText id="m_0d99b2b56f8b5d" />
        </legend>
        <div className="space-y-2">
          <Label>
            <GeneratedText id="m_0ef3898622f868" />
          </Label>
          <GeneratedValue
            value={
              selectedUsers.size > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  <GeneratedValue
                    value={Array.from(selectedUsers).map((id) => {
                      const m = members.find((x) => x.userId === id)
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 py-0.5 pr-1 pl-2.5 text-xs text-teal-900 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200"
                        >
                          <GeneratedValue
                            value={m?.name ?? <GeneratedText id="m_0d19396d98306c" />}
                          />
                          <button
                            type="button"
                            onClick={() => toggleUser(id)}
                            aria-label={tGenerated('m_101f98a70352fa', {
                              value0: m?.name ?? 'recipient',
                            })}
                            className="rounded-full p-0.5 text-teal-600 hover:bg-teal-100 hover:text-teal-900 dark:text-teal-400 dark:hover:bg-teal-900"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      )
                    })}
                  />
                </div>
              ) : null
            }
          />
          <SearchSelect
            value=""
            onChange={(id) => {
              if (id) toggleUser(id)
            }}
            options={members
              .filter((m) => !selectedUsers.has(m.userId))
              .map((m) => ({ value: m.userId, label: m.name, hint: m.email }))}
            placeholder={tGenerated('m_080c3856ee74d5')}
            searchPlaceholder={tGenerated('m_0f2fe29f21ee57')}
            sheetTitle="Add recipient"
            ariaLabel="Add member recipient"
            className="max-w-sm"
          />
        </div>
        <div className="mt-3 space-y-1.5">
          <Label>
            <GeneratedText id="m_0bfee91aa5fe88" />
          </Label>
          <Textarea
            name="recipientEmails"
            rows={2}
            maxLength={REPORT_SCHEDULE_LIMITS.recipientEmailListChars}
            defaultValue={(initial?.recipientEmails ?? []).join(', ')}
            placeholder={tGenerated('m_1eef4d230cc634')}
          />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            <GeneratedText id="m_08778f6f4d177b" />
          </p>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <GeneratedText id="m_1b6d30e8a7b8f2" />
        </legend>
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_0d7a3c5db73e70" />
            </Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder={tGenerated('m_063b869c773315')}
              className="w-36"
            />
          </div>
          <p className="pb-2 text-xs text-slate-400 dark:text-slate-500">
            <GeneratedText id="m_038258667df019" />
          </p>
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-teal-700 dark:text-slate-400">
            <GeneratedText id="m_1c766f2981b51f" />
          </summary>
          <Textarea
            rows={3}
            maxLength={REPORT_SCHEDULE_LIMITS.filtersChars}
            value={advanced}
            onChange={(e) => setAdvanced(e.target.value)}
            placeholder={tGenerated('m_03573b6be12a60')}
            className="mt-2 font-mono text-xs"
          />
          <GeneratedValue
            value={
              advancedError ? (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  <GeneratedValue value={advancedError} />
                </p>
              ) : null
            }
          />
        </details>
      </fieldset>

      <div className="flex items-center justify-between gap-2">
        <div>
          <GeneratedValue value={extraFooter} />
        </div>
        <Button type="submit" disabled={Boolean(advancedError)}>
          <GeneratedValue value={submitLabel} />
        </Button>
      </div>
    </form>
  )
}
