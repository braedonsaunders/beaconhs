'use client'

// Shared subscribe/edit schedule form. Posts the exact field contract the
// existing create/update server actions read (definitionId, cadence parts,
// recipientUserIds, recipientEmails, filters-as-JSON) — but composes those
// from humane controls: member checkboxes instead of UUID textareas, a days
// window instead of raw JSON (still available under "Advanced").

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Button, Input, Label, SearchSelect, Select, Textarea } from '@beaconhs/ui'

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
          Report <span className="text-red-600">*</span>
        </Label>
        <Select
          name="definitionId"
          value={definitionId}
          onChange={(e) => setDefinitionId(e.target.value)}
        >
          {definitions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.kind === 'custom' ? ' (custom)' : ''}
            </option>
          ))}
        </Select>
        {definition?.description ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{definition.description}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label>
          Schedule name <span className="text-red-600">*</span>
        </Label>
        <Input
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={
            definition ? `${definition.name} — ${cadence}` : 'e.g. Monday morning incidents'
          }
        />
      </div>

      <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          Delivery
        </legend>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Cadence</Label>
            <Select
              name="cadence"
              value={cadence}
              onChange={(e) => setCadence(e.target.value as typeof cadence)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </Select>
          </div>
          {cadence === 'weekly' ? (
            <div className="space-y-1.5">
              <Label>On</Label>
              <Select name="dayOfWeek" defaultValue={String(initial?.dayOfWeek ?? 1)}>
                {DOW.map((d, i) => (
                  <option key={d} value={String(i)}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {cadence === 'monthly' ? (
            <div className="space-y-1.5">
              <Label>Day of month</Label>
              <Input
                name="dayOfMonth"
                type="number"
                min={1}
                max={31}
                defaultValue={initial?.dayOfMonth ?? 1}
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label>At</Label>
            <div className="flex items-center gap-1">
              <Input
                name="hour"
                type="number"
                min={0}
                max={23}
                defaultValue={initial?.hour ?? 7}
                required
                className="w-18"
                aria-label="Hour (0-23)"
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
                aria-label="Minute (0-59)"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Timezone</Label>
            <Input
              name="timezone"
              required
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
          Recipients
        </legend>
        <div className="space-y-2">
          <Label>Members</Label>
          {selectedUsers.size > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {Array.from(selectedUsers).map((id) => {
                const m = members.find((x) => x.userId === id)
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 py-0.5 pr-1 pl-2.5 text-xs text-teal-900 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200"
                  >
                    {m?.name ?? 'Former member'}
                    <button
                      type="button"
                      onClick={() => toggleUser(id)}
                      aria-label={`Remove ${m?.name ?? 'recipient'}`}
                      className="rounded-full p-0.5 text-teal-600 hover:bg-teal-100 hover:text-teal-900 dark:text-teal-400 dark:hover:bg-teal-900"
                    >
                      <X size={12} />
                    </button>
                  </span>
                )
              })}
            </div>
          ) : null}
          <SearchSelect
            value=""
            onChange={(id) => {
              if (id) toggleUser(id)
            }}
            options={members
              .filter((m) => !selectedUsers.has(m.userId))
              .map((m) => ({ value: m.userId, label: m.name, hint: m.email }))}
            placeholder="Add member…"
            searchPlaceholder="Search members…"
            sheetTitle="Add recipient"
            ariaLabel="Add member recipient"
            className="max-w-sm"
          />
        </div>
        <div className="mt-3 space-y-1.5">
          <Label>Additional email addresses</Label>
          <Textarea
            name="recipientEmails"
            rows={2}
            defaultValue={(initial?.recipientEmails ?? []).join(', ')}
            placeholder="hse@acme.com, manager@acme.com"
          />
          <p className="text-xs text-slate-400 dark:text-slate-500">Comma- or newline-separated.</p>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          Data window
        </legend>
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label>Days of data</Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder="report default"
              className="w-36"
            />
          </div>
          <p className="pb-2 text-xs text-slate-400 dark:text-slate-500">
            Leave blank to use the report default.
          </p>
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-teal-700 dark:text-slate-400">
            Advanced filters (JSON)
          </summary>
          <Textarea
            rows={3}
            value={advanced}
            onChange={(e) => setAdvanced(e.target.value)}
            placeholder='{"departmentId": "…", "siteOrgUnitId": "…"}'
            className="mt-2 font-mono text-xs"
          />
          {advancedError ? (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{advancedError}</p>
          ) : null}
        </details>
      </fieldset>

      <div className="flex items-center justify-between gap-2">
        <div>{extraFooter}</div>
        <Button type="submit" disabled={Boolean(advancedError)}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
