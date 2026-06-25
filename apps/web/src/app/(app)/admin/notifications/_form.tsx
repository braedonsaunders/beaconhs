'use client'

// Per-category configuration for the automatic notification system. Each card
// toggles a category on/off, picks which roles + specific people are notified,
// and (for recurring "still overdue" scans) how often to re-alert. State is held
// locally and saved as one batch; a sticky bar tracks unsaved changes.

import { useMemo, useState, useTransition } from 'react'
import { X } from 'lucide-react'
import { Badge, Button, Label, SearchSelect, Select, cn } from '@beaconhs/ui'
import { toast } from 'sonner'
import { REMINDER_PRESETS, type NotificationCategory } from './_catalog'
import { saveNotificationSettings, type CategorySettingInput } from './_actions'

type RoleOpt = { key: string; name: string }
type MemberOpt = { value: string; label: string }
type CatConfig = {
  enabled: boolean
  roleKeys: string[]
  userIds: string[]
  reminderHours: number | null
}
type InitialMap = Record<string, CatConfig>

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
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              on
                ? 'border-teal-600 bg-teal-50 text-teal-800 dark:border-teal-500 dark:bg-teal-950/50 dark:text-teal-200'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/60',
            )}
          >
            {r.name}
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
  const available = useMemo(
    () => options.filter((o) => !value.includes(o.value)),
    [options, value],
  )
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

export function NotificationSettingsForm({
  categories,
  roles,
  members,
  initial,
}: {
  categories: NotificationCategory[]
  roles: RoleOpt[]
  members: MemberOpt[]
  initial: InitialMap
}) {
  const seed = useMemo<InitialMap>(() => {
    const out: InitialMap = {}
    for (const c of categories) {
      out[c.key] = initial[c.key] ?? {
        enabled: true,
        roleKeys: c.defaultRoles,
        userIds: [],
        reminderHours: null,
      }
    }
    return out
  }, [categories, initial])

  const [config, setConfig] = useState<InitialMap>(seed)
  const [baseline] = useState(() => JSON.stringify(seed))
  const [pending, startTransition] = useTransition()

  const dirty = JSON.stringify(config) !== baseline

  const patch = (key: string, next: Partial<CatConfig>) =>
    setConfig((prev) => ({ ...prev, [key]: { ...prev[key]!, ...next } }))

  const save = () => {
    const items: CategorySettingInput[] = categories.map((c) => ({
      category: c.key,
      ...config[c.key]!,
    }))
    startTransition(async () => {
      try {
        await saveNotificationSettings(items)
        // Re-baseline so the bar reads "saved" without a full reload.
        window.location.reload()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save settings.')
      }
    })
  }

  return (
    <div className="space-y-3">
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
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {cat.label}
                  </h3>
                  {cat.recurring ? (
                    <Badge variant="secondary" className="text-[10px]">
                      Recurring
                    </Badge>
                  ) : null}
                </div>
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

                {cat.recurring ? (
                  <div className="max-w-xs space-y-1.5">
                    <Label>Reminder frequency</Label>
                    <Select
                      value={String(cfg.reminderHours ?? '')}
                      onChange={(e) =>
                        patch(cat.key, {
                          reminderHours: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    >
                      {REMINDER_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </Select>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      How often to re-alert while a record stays overdue.
                    </p>
                  </div>
                ) : null}

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
