'use client'

// The notifications cockpit. A tenant-wide routing policy (unified detection,
// digest, quiet hours) plus per-category rules: enable, recipient roles +
// people, channels, reminder cadence, and an escalation ladder. State is held
// locally and saved as one batch; a sticky bar tracks unsaved changes.

import { useMemo, useState, useTransition } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, Label, SearchSelect, Select, cn } from '@beaconhs/ui'
import { toast } from 'sonner'
import { type NotificationCategory } from './_catalog'
import {
  saveNotificationPolicy,
  saveNotificationSettings,
  type CategorySettingInput,
  type EscalationStep,
  type PolicyInput,
} from './_actions'
import {
  compileCron,
  decompileCron,
  isValidCron,
  SCHEDULE_PRESETS,
  WEEKDAYS,
  type SchedulePreset,
} from './_schedule'

type RoleOpt = { key: string; name: string }
type MemberOpt = { value: string; label: string }
type CatConfig = {
  enabled: boolean
  roleKeys: string[]
  userIds: string[]
  channels: string[]
  escalation: EscalationStep[]
}
type InitialMap = Record<string, CatConfig>

const CHANNELS: { key: string; label: string; locked?: boolean }[] = [
  { key: 'in_app', label: 'In-app', locked: true },
  { key: 'email', label: 'Email' },
  { key: 'push', label: 'Push' },
  { key: 'sms', label: 'SMS' },
]

const chipBase =
  'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-default'
const chipOn =
  'border-teal-600 bg-teal-50 text-teal-800 dark:border-teal-500 dark:bg-teal-950/50 dark:text-teal-200'
const chipOff =
  'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/60'

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors',
        checked ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-600',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
          checked && 'translate-x-5',
        )}
      />
    </button>
  )
}

function RoleChips({
  roles,
  value,
  onChange,
}: {
  roles: RoleOpt[]
  value: string[]
  onChange: (next: string[]) => void
}) {
  if (roles.length === 0) {
    return <p className="text-xs text-slate-400 dark:text-slate-500">No roles defined yet.</p>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((r) => {
        const on = value.includes(r.key)
        return (
          <button
            key={r.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((k) => k !== r.key) : [...value, r.key])}
            className={cn(chipBase, on ? chipOn : chipOff)}
          >
            {r.name}
          </button>
        )
      })}
    </div>
  )
}

function ChannelChips({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CHANNELS.map((c) => {
        const on = c.locked || value.includes(c.key)
        return (
          <button
            key={c.key}
            type="button"
            disabled={c.locked}
            aria-pressed={on}
            onClick={() =>
              c.locked
                ? undefined
                : onChange(on ? value.filter((k) => k !== c.key) : [...value, c.key])
            }
            className={cn(chipBase, on ? chipOn : chipOff)}
          >
            {c.label}
            {c.locked ? ' · always' : ''}
          </button>
        )
      })}
    </div>
  )
}

function PeoplePicker({
  options,
  value,
  onChange,
}: {
  options: MemberOpt[]
  value: string[]
  onChange: (next: string[]) => void
}) {
  const available = useMemo(() => options.filter((o) => !value.includes(o.value)), [options, value])
  const chosen = value
    .map((v) => options.find((o) => o.value === v))
    .filter((o): o is MemberOpt => Boolean(o))
  return (
    <div className="space-y-2">
      <SearchSelect
        value=""
        onChange={(v) => v && onChange([...value, v])}
        options={available}
        placeholder="Add a person…"
        searchPlaceholder="Search people…"
        sheetTitle="Select people"
      />
      {chosen.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((o) => (
            <span
              key={o.value}
              className="inline-flex items-center gap-1 rounded-full bg-teal-50 py-1 pr-1 pl-2.5 text-xs font-medium text-teal-800 dark:bg-teal-950/50 dark:text-teal-300"
            >
              {o.label}
              <button
                type="button"
                aria-label={`Remove ${o.label}`}
                onClick={() => onChange(value.filter((v) => v !== o.value))}
                className="rounded-full p-0.5 text-teal-600 hover:bg-teal-100 dark:hover:bg-teal-900"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const numInput =
  'h-7 w-16 rounded-md border border-slate-200 bg-white px-2 text-center text-sm text-slate-900 outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'

function EscalationEditor({
  roles,
  value,
  onChange,
}: {
  roles: RoleOpt[]
  value: EscalationStep[]
  onChange: (next: EscalationStep[]) => void
}) {
  const patchStep = (i: number, next: Partial<EscalationStep>) =>
    onChange(value.map((s, idx) => (idx === i ? { ...s, ...next } : s)))
  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          No escalation — only the recipients above are alerted.
        </p>
      ) : null}
      {value.map((s, i) => (
        <div key={i} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>After</span>
            <input
              type="number"
              min={1}
              max={365}
              value={s.afterDays}
              onChange={(e) => patchStep(i, { afterDays: Number(e.target.value) || 1 })}
              className={numInput}
            />
            <span>days overdue, also alert</span>
            <button
              type="button"
              aria-label="Remove step"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              className="ml-auto rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
            >
              <X size={14} />
            </button>
          </div>
          <div className="mt-2">
            <RoleChips
              roles={roles}
              value={s.roleKeys}
              onChange={(v) => patchStep(i, { roleKeys: v })}
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...value, { afterDays: 3, roleKeys: [] }])}
        className="inline-flex items-center gap-1 rounded-md px-1 py-1 text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
      >
        <Plus size={13} /> Add escalation step
      </button>
    </div>
  )
}

export function NotificationSettingsForm({
  categories,
  roles,
  members,
  initial,
  policy,
}: {
  categories: NotificationCategory[]
  roles: RoleOpt[]
  members: MemberOpt[]
  initial: InitialMap
  policy: PolicyInput
}) {
  const seed = useMemo<InitialMap>(() => {
    const out: InitialMap = {}
    for (const c of categories) {
      out[c.key] = initial[c.key] ?? {
        enabled: true,
        roleKeys: c.defaultRoles,
        userIds: [],
        channels: ['in_app', 'email'],
        escalation: [],
      }
    }
    return out
  }, [categories, initial])

  const [config, setConfig] = useState<InitialMap>(seed)
  const [pol, setPol] = useState<PolicyInput>(policy)
  const [baseline] = useState(() => JSON.stringify({ c: seed, p: policy }))
  const [pending, startTransition] = useTransition()

  const dirty = JSON.stringify({ c: config, p: pol }) !== baseline

  const patch = (key: string, next: Partial<CatConfig>) =>
    setConfig((prev) => ({ ...prev, [key]: { ...prev[key]!, ...next } }))
  const patchPol = (next: Partial<PolicyInput>) => setPol((p) => ({ ...p, ...next }))

  // Detection-schedule UI state, derived from the stored cron. Any change recompiles
  // to a cron and patches the policy (the canonical value the worker reads).
  const [sched, setSched] = useState(() => decompileCron(policy.scanCron))
  const tzList = useMemo<string[]>(() => {
    try {
      const z = (
        Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
      ).supportedValuesOf?.('timeZone')
      return z && z.length ? z : ['UTC']
    } catch {
      return ['UTC']
    }
  }, [])
  const updateSched = (next: Partial<ReturnType<typeof decompileCron>>) => {
    const merged = { ...sched, ...next }
    setSched(merged)
    patchPol({ scanCron: compileCron(merged.preset, merged.hour, merged.weekday, merged.custom) })
  }

  const save = () => {
    const items: CategorySettingInput[] = categories.map((c) => ({
      category: c.key,
      ...config[c.key]!,
    }))
    startTransition(async () => {
      try {
        await saveNotificationSettings(items)
        await saveNotificationPolicy(pol)
        window.location.reload()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save settings.')
      }
    })
  }

  return (
    <div className="space-y-3">
      {/* Tenant-wide routing policy */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Routing policy
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Tenant-wide defaults for how alerts are detected and delivered.
          </p>
        </div>
        <div className="space-y-4 px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Digest</Label>
              <Select
                value={pol.digestMode}
                onChange={(e) =>
                  patchPol({ digestMode: e.target.value as PolicyInput['digestMode'] })
                }
              >
                <option value="off">Off — send immediately</option>
                <option value="daily">Daily summary</option>
                <option value="weekly">Weekly summary</option>
              </Select>
              {pol.digestMode !== 'off' ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>Send at</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={pol.digestHourUtc}
                    onChange={(e) => patchPol({ digestHourUtc: Number(e.target.value) || 0 })}
                    className={numInput}
                  />
                  <span>:00 UTC</span>
                </div>
              ) : (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Batch non-urgent alerts into one email instead of many.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Quiet hours</Label>
                <Toggle
                  checked={!!pol.quietHours}
                  onChange={(v) => patchPol({ quietHours: v ? { start: 22, end: 6 } : null })}
                  label="Quiet hours"
                />
              </div>
              {pol.quietHours ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={pol.quietHours.start}
                    onChange={(e) =>
                      patchPol({
                        quietHours: {
                          start: Number(e.target.value) || 0,
                          end: pol.quietHours!.end,
                        },
                      })
                    }
                    className={numInput}
                  />
                  <span>→</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={pol.quietHours.end}
                    onChange={(e) =>
                      patchPol({
                        quietHours: {
                          start: pol.quietHours!.start,
                          end: Number(e.target.value) || 0,
                        },
                      })
                    }
                    className={numInput}
                  />
                  <span>UTC</span>
                </div>
              ) : (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Hold non-critical email + push overnight. Critical alerts always go through.
                </p>
              )}
            </div>
          </div>

          {/* Per-tenant compliance detection schedule (evaluated in its timezone). */}
          <div className="space-y-1.5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Label>Compliance detection schedule</Label>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              How often overdue and expiring items are re-checked and alerted. Untouched tenants run
              once a day at 06:00 UTC.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Select
                value={sched.preset}
                onChange={(e) => updateSched({ preset: e.target.value as SchedulePreset })}
                className="w-40"
              >
                {SCHEDULE_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>

              {sched.preset === 'daily' ||
              sched.preset === 'twice_daily' ||
              sched.preset === 'weekly' ? (
                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <span>at</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={sched.hour}
                    onChange={(e) => updateSched({ hour: Number(e.target.value) || 0 })}
                    className={numInput}
                  />
                  <span>:00</span>
                </div>
              ) : null}

              {sched.preset === 'weekly' ? (
                <Select
                  value={String(sched.weekday)}
                  onChange={(e) => updateSched({ weekday: Number(e.target.value) })}
                  className="w-36"
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              ) : null}

              {sched.preset === 'custom' ? (
                <input
                  type="text"
                  spellCheck={false}
                  value={sched.custom}
                  onChange={(e) => updateSched({ custom: e.target.value })}
                  placeholder="m h dom mon dow"
                  className="h-7 w-40 rounded-md border border-slate-200 bg-white px-2 font-mono text-sm text-slate-900 outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              ) : null}

              <span className="text-xs text-slate-400 dark:text-slate-500">in</span>
              <Select
                value={pol.scanTimezone}
                onChange={(e) => patchPol({ scanTimezone: e.target.value })}
                className="w-56"
              >
                {tzList.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </div>
            {sched.preset === 'custom' && !isValidCron(sched.custom) ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                Enter a valid 5-field cron (e.g. <code>0 6 * * *</code>).
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Per-category rules */}
      {categories.map((cat) => {
        const cfg = config[cat.key]!
        const noRecipients = cfg.roleKeys.length === 0 && cfg.userIds.length === 0
        return (
          <div
            key={cat.key}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {cat.label}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {cat.description}
                </p>
              </div>
              <Toggle
                checked={cfg.enabled}
                onChange={(v) => patch(cat.key, { enabled: v })}
                label={`Enable ${cat.label} notifications`}
              />
            </div>

            {cfg.enabled ? (
              <div className="space-y-4 border-t border-slate-100 px-4 py-4 dark:border-slate-800">
                <div className="space-y-1.5">
                  <Label>Notify these roles</Label>
                  <RoleChips
                    roles={roles}
                    value={cfg.roleKeys}
                    onChange={(v) => patch(cat.key, { roleKeys: v })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Also notify specific people</Label>
                  <PeoplePicker
                    options={members}
                    value={cfg.userIds}
                    onChange={(v) => patch(cat.key, { userIds: v })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Channels</Label>
                  <ChannelChips
                    value={cfg.channels}
                    onChange={(v) => patch(cat.key, { channels: v })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Escalation ladder</Label>
                  <EscalationEditor
                    roles={roles}
                    value={cfg.escalation}
                    onChange={(v) => patch(cat.key, { escalation: v })}
                  />
                </div>

                {noRecipients ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    No recipients selected — nobody will be notified for this category.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
                Muted — no automatic alerts are sent for this category.
              </div>
            )}
          </div>
        )
      })}

      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/90 px-1 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {dirty ? 'Unsaved changes' : 'All changes saved'}
        </p>
        <Button onClick={save} disabled={pending || !dirty}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}
