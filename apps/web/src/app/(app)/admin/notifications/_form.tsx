'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// The notifications cockpit. A tenant-wide routing policy (unified detection,
// digest, quiet hours) plus per-category rules: enable, recipient roles +
// people, channels, reminder cadence, and an escalation ladder. State is held
// locally and saved as one batch; a sticky bar tracks unsaved changes.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, Label, SearchSelect, Select, cn } from '@beaconhs/ui'
import { toast } from 'sonner'
import { type NotificationCategory } from './_catalog'
import {
  saveNotificationConfiguration,
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
  groupIds: string[]
  channels: string[]
  escalation: EscalationStep[]
}
type InitialMap = Record<string, CatConfig>
export type ChannelAvailability = 'ready' | 'disabled' | 'unconfigured'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={tGeneratedValue(label)}
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
    return (
      <p className="text-xs text-slate-400 dark:text-slate-500">
        <GeneratedText id="m_0d3aaa3bb9c390" />
      </p>
    )
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      <GeneratedValue
        value={roles.map((r) => {
          const on = value.includes(r.key)
          return (
            <button
              key={r.key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((k) => k !== r.key) : [...value, r.key])}
              className={cn(chipBase, on ? chipOn : chipOff)}
            >
              <GeneratedValue value={r.name} />
            </button>
          )
        })}
      />
    </div>
  )
}

function ChannelChips({
  value,
  onChange,
  availability,
}: {
  value: string[]
  onChange: (next: string[]) => void
  availability: Record<string, ChannelAvailability>
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  return (
    <div className="flex flex-wrap gap-1.5">
      <GeneratedValue
        value={CHANNELS.map((c) => {
          const on = c.locked || value.includes(c.key)
          const status = availability[c.key] ?? 'ready'
          const unavailable = status !== 'ready'
          const statusCopy = status === 'disabled' ? 'disabled by platform' : 'not set up'
          return (
            <button
              key={c.key}
              type="button"
              disabled={c.locked}
              aria-pressed={on}
              title={tGeneratedValue(
                status === 'unconfigured'
                  ? tGenerated('m_084a35bd061810', { value0: c.label, value1: c.label })
                  : status === 'disabled'
                    ? tGenerated('m_0d1667d84af32f', { value0: c.label })
                    : undefined,
              )}
              onClick={() =>
                c.locked
                  ? undefined
                  : onChange(on ? value.filter((k) => k !== c.key) : [...value, c.key])
              }
              className={cn(
                chipBase,
                on ? chipOn : chipOff,
                unavailable &&
                  'border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-300',
              )}
            >
              <GeneratedValue value={c.label} />
              <GeneratedValue
                value={
                  c.locked ? (
                    <GeneratedText id="m_032924a417d4d9" />
                  ) : unavailable ? (
                    ` · ${statusCopy}`
                  ) : (
                    ''
                  )
                }
              />
            </button>
          )
        })}
      />
    </div>
  )
}

function ChannelStatus({
  label,
  status,
  href,
}: {
  label: string
  status: ChannelAvailability
  href?: string
}) {
  const ready = status === 'ready'
  const statusCopy = status === 'disabled' ? 'disabled by platform' : 'not set up'
  const content = (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-1.5 w-1.5 rounded-full', ready ? 'bg-emerald-500' : 'bg-amber-500')} />
      <span
        className={
          ready ? 'text-slate-600 dark:text-slate-300' : 'text-amber-700 dark:text-amber-400'
        }
      >
        <GeneratedValue value={label} />
        <GeneratedValue value={ready ? '' : ` — ${statusCopy}`} />
      </span>
    </span>
  )
  return status === 'unconfigured' && href ? (
    <Link href={href as never} className="hover:underline">
      <GeneratedValue value={content} />
    </Link>
  ) : (
    content
  )
}

function PeoplePicker({
  options,
  value,
  onChange,
  placeholder = 'Add a person…',
  searchPlaceholder = 'Search people…',
  sheetTitle = 'Select people',
  emptyHint,
}: {
  options: MemberOpt[]
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  sheetTitle?: string
  emptyHint?: string
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const available = useMemo(() => options.filter((o) => !value.includes(o.value)), [options, value])
  const chosen = value
    .map((v) => options.find((o) => o.value === v))
    .filter((o): o is MemberOpt => Boolean(o))
  if (options.length === 0 && emptyHint) {
    return (
      <p className="text-xs text-slate-400 dark:text-slate-500">
        <GeneratedValue value={emptyHint} />
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <SearchSelect
        value=""
        onChange={(v) => v && onChange([...value, v])}
        options={available}
        placeholder={tGeneratedValue(placeholder)}
        searchPlaceholder={tGeneratedValue(searchPlaceholder)}
        sheetTitle={sheetTitle}
      />
      <GeneratedValue
        value={
          chosen.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <GeneratedValue
                value={chosen.map((o) => (
                  <span
                    key={o.value}
                    className="inline-flex items-center gap-1 rounded-full bg-teal-50 py-1 pr-1 pl-2.5 text-xs font-medium text-teal-800 dark:bg-teal-950/50 dark:text-teal-300"
                  >
                    <GeneratedValue value={o.label} />
                    <button
                      type="button"
                      aria-label={tGenerated('m_101f98a70352fa', { value0: o.label })}
                      onClick={() => onChange(value.filter((v) => v !== o.value))}
                      className="rounded-full p-0.5 text-teal-600 hover:bg-teal-100 dark:hover:bg-teal-900"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              />
            </div>
          ) : null
        }
      />
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
  const tGenerated = useGeneratedTranslations()
  const patchStep = (i: number, next: Partial<EscalationStep>) =>
    onChange(value.map((s, idx) => (idx === i ? { ...s, ...next } : s)))
  return (
    <div className="space-y-2">
      <GeneratedValue
        value={
          value.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              <GeneratedText id="m_1d98c9c8eb4678" />
            </p>
          ) : null
        }
      />
      <GeneratedValue
        value={value.map((s, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>
                <GeneratedText id="m_17d87be3a289c9" />
              </span>
              <input
                type="number"
                min={1}
                max={365}
                value={s.afterDays}
                onChange={(e) => patchStep(i, { afterDays: Number(e.target.value) || 1 })}
                className={numInput}
              />
              <span>
                <GeneratedText id="m_0966413a739b72" />
              </span>
              <button
                type="button"
                aria-label={tGenerated('m_0d04f0ad8eba98')}
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
      />
      <button
        type="button"
        onClick={() => onChange([...value, { afterDays: 3, roleKeys: [] }])}
        className="inline-flex items-center gap-1 rounded-md px-1 py-1 text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
      >
        <Plus size={13} /> <GeneratedText id="m_09f1357f2b4a1f" />
      </button>
    </div>
  )
}

export function NotificationSettingsForm({
  categories,
  roles,
  members,
  groups,
  initial,
  policy,
  emailAvailability,
  smsAvailability,
}: {
  categories: NotificationCategory[]
  roles: RoleOpt[]
  members: MemberOpt[]
  groups: MemberOpt[]
  initial: InitialMap
  policy: PolicyInput
  emailAvailability: ChannelAvailability
  smsAvailability: ChannelAvailability
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const channelAvailability: Record<string, ChannelAvailability> = {
    in_app: 'ready',
    email: emailAvailability,
    push: 'ready',
    sms: smsAvailability,
  }
  const seed = useMemo<InitialMap>(() => {
    const out: InitialMap = {}
    for (const c of categories) {
      out[c.key] = initial[c.key] ?? {
        enabled: true,
        roleKeys: c.defaultRoles,
        userIds: [],
        groupIds: [],
        channels: ['in_app', 'email'],
        escalation: [],
      }
    }
    return out
  }, [categories, initial])

  const router = useRouter()
  const [config, setConfig] = useState<InitialMap>(seed)
  const [pol, setPol] = useState<PolicyInput>(policy)
  const [baseline, setBaseline] = useState(() => JSON.stringify({ c: seed, p: policy }))
  const [pending, startTransition] = useTransition()

  const dirty = JSON.stringify({ c: config, p: pol }) !== baseline

  const patch = (key: string, next: Partial<CatConfig>) =>
    setConfig((prev) => ({ ...prev, [key]: { ...prev[key]!, ...next } }))
  const patchPol = (next: Partial<PolicyInput>) => setPol((p) => ({ ...p, ...next }))

  // Detection-schedule UI state, derived from the stored cron. Any change recompiles
  // to a cron and patches the policy (the canonical value the worker reads).
  const [sched, setSched] = useState(() => decompileCron(policy.scanCron))
  const tzList = useMemo<string[]>(() => {
    let z: string[] = []
    try {
      z =
        (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
          'timeZone',
        ) ?? []
    } catch {
      z = []
    }
    // `supportedValuesOf('timeZone')` omits the bare 'UTC' alias in some engines —
    // the stored default — so always surface it (first, since it's the default).
    return ['UTC', ...z.filter((t) => t !== 'UTC')]
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
        await saveNotificationConfiguration(items, pol)
        // Soft refresh: the action revalidates /admin/notifications, so this
        // re-pulls the saved server state without a full document reload (which
        // would replay the boot splash). Clear dirty against the just-saved snapshot.
        setBaseline(JSON.stringify({ c: config, p: pol }))
        router.refresh()
        toast.success(tGenerated('m_0ad43d07863768'))
      } catch (err) {
        toast.error(
          tGeneratedValue(err instanceof Error ? err.message : tGenerated('m_1b8a56cc7a479e')),
        )
      }
    })
  }

  return (
    <div className="space-y-3">
      {/* Channel availability — what actually delivers right now. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/40">
        <span className="font-medium text-slate-600 dark:text-slate-300">
          <GeneratedText id="m_010d889813e53e" />
        </span>
        <ChannelStatus label={tGenerated('m_15185e5e20e3c2')} status="ready" />
        <ChannelStatus
          label={tGenerated('m_00a0ba9938bdff')}
          status={emailAvailability}
          href="/admin/email"
        />
        <ChannelStatus
          label={tGenerated('m_090cf61ef27662')}
          status={smsAvailability}
          href="/admin/sms"
        />
        <ChannelStatus label={tGenerated('m_07c0298f965dc6')} status="ready" />
      </div>

      {/* Tenant-wide routing policy. No overflow-hidden: Select dropdowns near
          the card's bottom edge must overlay the boundary, not clip at it. */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            <GeneratedText id="m_107b4fcf5cad63" />
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_14de8c9242067c" />
          </p>
        </div>
        <div className="space-y-4 px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>
                <GeneratedText id="m_094aaec898740b" />
              </Label>
              <Select
                value={pol.digestMode}
                onChange={(e) =>
                  patchPol({ digestMode: e.target.value as PolicyInput['digestMode'] })
                }
              >
                <option value="off">{'Off — send immediately'}</option>
                <option value="daily">{'Daily summary'}</option>
                <option value="weekly">{'Weekly summary'}</option>
              </Select>
              <GeneratedValue
                value={
                  pol.digestMode !== 'off' ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>
                        <GeneratedText id="m_0973fa55191a8a" />
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={pol.digestHourUtc}
                        onChange={(e) => patchPol({ digestHourUtc: Number(e.target.value) || 0 })}
                        className={numInput}
                      />
                      <span>
                        <GeneratedText id="m_04b8cc0e683c51" />
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      <GeneratedText id="m_0bee6e7e6dd5ac" />
                    </p>
                  )
                }
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>
                  <GeneratedText id="m_19472ba0dedea3" />
                </Label>
                <Toggle
                  checked={!!pol.quietHours}
                  onChange={(v) => patchPol({ quietHours: v ? { start: 22, end: 6 } : null })}
                  label={tGenerated('m_19472ba0dedea3')}
                />
              </div>
              <GeneratedValue
                value={
                  pol.quietHours ? (
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
                      <span>
                        <GeneratedText id="m_160fbb6c66f34e" />
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      <GeneratedText id="m_09859d56350190" />
                    </p>
                  )
                }
              />
            </div>
          </div>

          {/* Per-tenant compliance detection schedule (evaluated in its timezone). */}
          <div className="space-y-1.5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Label>
              <GeneratedText id="m_1af34f7e5bf545" />
            </Label>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              <GeneratedText id="m_178b7c2d54db58" />
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

              <GeneratedValue
                value={
                  sched.preset === 'daily' ||
                  sched.preset === 'twice_daily' ||
                  sched.preset === 'weekly' ? (
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <span>
                        <GeneratedText id="m_11779192030c81" />
                      </span>
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
                  ) : null
                }
              />

              <GeneratedValue
                value={
                  sched.preset === 'weekly' ? (
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
                  ) : null
                }
              />

              <GeneratedValue
                value={
                  sched.preset === 'custom' ? (
                    <input
                      type="text"
                      spellCheck={false}
                      value={sched.custom}
                      onChange={(e) => updateSched({ custom: e.target.value })}
                      placeholder={tGenerated('m_1768852c7aa00e')}
                      className="h-7 w-40 rounded-md border border-slate-200 bg-white px-2 font-mono text-sm text-slate-900 outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  ) : null
                }
              />

              <span className="text-xs text-slate-400 dark:text-slate-500">
                <GeneratedText id="m_0e2bad4d6e8bd2" />
              </span>
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
            <GeneratedValue
              value={
                sched.preset === 'custom' && !isValidCron(sched.custom) ? (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    <GeneratedText id="m_032afdfec85876" /> <code>0 6 * * *</code>).
                  </p>
                ) : null
              }
            />
          </div>
        </div>
      </div>

      {/* Per-category rules */}
      <GeneratedValue
        value={categories.map((cat) => {
          const cfg = config[cat.key]!
          const noRecipients =
            cfg.roleKeys.length === 0 && cfg.userIds.length === 0 && cfg.groupIds.length === 0
          return (
            <div
              key={cat.key}
              className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <GeneratedValue value={cat.label} />
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    <GeneratedValue value={cat.description} />
                  </p>
                </div>
                <Toggle
                  checked={cfg.enabled}
                  onChange={(v) => patch(cat.key, { enabled: v })}
                  label={tGenerated('m_0fad28753c32c3', { value0: cat.label })}
                />
              </div>

              <GeneratedValue
                value={
                  cfg.enabled ? (
                    <div className="space-y-4 border-t border-slate-100 px-4 py-4 dark:border-slate-800">
                      <div className="space-y-1.5">
                        <Label>
                          <GeneratedText id="m_0574d0e16628ff" />
                        </Label>
                        <RoleChips
                          roles={roles}
                          value={cfg.roleKeys}
                          onChange={(v) => patch(cat.key, { roleKeys: v })}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>
                          <GeneratedText id="m_167a9e18d14401" />
                        </Label>
                        <PeoplePicker
                          options={members}
                          value={cfg.userIds}
                          onChange={(v) => patch(cat.key, { userIds: v })}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>
                          <GeneratedText id="m_086aa4f81b9be9" />
                        </Label>
                        <PeoplePicker
                          options={groups}
                          value={cfg.groupIds}
                          onChange={(v) => patch(cat.key, { groupIds: v })}
                          placeholder={tGenerated('m_059b16f0ac25bf')}
                          searchPlaceholder={tGenerated('m_15c4d2ca7e95f7')}
                          sheetTitle="Select notification groups"
                          emptyHint="No notification groups yet — create one from the Notification groups page."
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>
                          <GeneratedText id="m_010d889813e53e" />
                        </Label>
                        <ChannelChips
                          value={cfg.channels}
                          onChange={(v) => patch(cat.key, { channels: v })}
                          availability={channelAvailability}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>
                          <GeneratedText id="m_1b8f85dba7b244" />
                        </Label>
                        <EscalationEditor
                          roles={roles}
                          value={cfg.escalation}
                          onChange={(v) => patch(cat.key, { escalation: v })}
                        />
                      </div>

                      <GeneratedValue
                        value={
                          noRecipients ? (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                              <GeneratedText id="m_0bd3978b6f56a2" />
                            </p>
                          ) : null
                        }
                      />
                    </div>
                  ) : (
                    <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
                      <GeneratedText id="m_09600a2c12261c" />
                    </div>
                  )
                }
              />
            </div>
          )
        })}
      />

      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/90 px-1 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <GeneratedValue
            value={
              dirty ? (
                <GeneratedText id="m_1175a27a9b33f7" />
              ) : (
                <GeneratedText id="m_0ad43d07863768" />
              )
            }
          />
        </p>
        <Button onClick={save} disabled={pending || !dirty}>
          <GeneratedValue
            value={
              pending ? (
                <GeneratedText id="m_106811f2aac664" />
              ) : (
                <GeneratedText id="m_1ab9025ed1067c" />
              )
            }
          />
        </Button>
      </div>
    </div>
  )
}
