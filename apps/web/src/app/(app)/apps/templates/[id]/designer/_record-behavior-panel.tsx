'use client'

// Record behaviour panel — the "Record" left-rail tab in the App designer.
//
// Edits form_templates.recordConfig (jsonb): how a record built from this App
// behaves once it exists. Two concerns:
//   • editingMode — guided fill (step wizard + Submit) vs. inline record (native
//     per-field autosave, edit in place like incidents) vs. both.
//   • locking     — whether finished records can be locked read-only, what
//     triggers the lock, and which roles may lock / unlock.
//
// Saved via the updateRecordBehavior server action. Authoring only — the record
// page reads recordConfig to pick the renderer and gate lock/unlock.

import { useState, useTransition } from 'react'
import { Button, Label } from '@beaconhs/ui'
import { Check } from 'lucide-react'
import { toast } from '@/lib/toast'
import { updateRecordBehavior } from './actions'

export type RecordConfig = {
  editingMode?: 'guided_fill' | 'inline_record' | 'both'
  locking?: {
    enabled?: boolean
    trigger?: 'manual' | 'on_finalize' | 'on_signoff'
    lockRoles?: string[]
    unlockRoles?: string[]
    autoLockOnFinalize?: boolean
  }
}

type EditingMode = NonNullable<RecordConfig['editingMode']>
type LockTrigger = NonNullable<NonNullable<RecordConfig['locking']>['trigger']>

const EDITING_MODES: { value: EditingMode; title: string; description: string }[] = [
  {
    value: 'guided_fill',
    title: 'Guided fill',
    description: 'A step-by-step wizard ending in Submit. Best for one-off captures in the field.',
  },
  {
    value: 'inline_record',
    title: 'Inline record',
    description:
      'A living record edited in place — every field autosaves as you type, like an incident.',
  },
  {
    value: 'both',
    title: 'Both',
    description: 'An inline record that can also be completed through the guided wizard.',
  },
]

const LOCK_TRIGGERS: { value: LockTrigger; label: string }[] = [
  { value: 'manual', label: 'Manually, with a Lock button' },
  { value: 'on_finalize', label: 'When the record is finalised' },
  { value: 'on_signoff', label: 'When all sign-off steps are complete' },
]

export function RecordBehaviorPanel({
  templateId,
  initial,
  roles,
}: {
  templateId: string
  initial?: RecordConfig
  roles: { key: string; name: string }[]
}) {
  const [editingMode, setEditingMode] = useState<EditingMode>(initial?.editingMode ?? 'guided_fill')
  const [lockEnabled, setLockEnabled] = useState<boolean>(initial?.locking?.enabled ?? false)
  const [trigger, setTrigger] = useState<LockTrigger>(initial?.locking?.trigger ?? 'manual')
  const [autoLockOnFinalize, setAutoLockOnFinalize] = useState<boolean>(
    initial?.locking?.autoLockOnFinalize ?? false,
  )
  const [lockRoles, setLockRoles] = useState<Set<string>>(
    new Set(initial?.locking?.lockRoles ?? []),
  )
  const [unlockRoles, setUnlockRoles] = useState<Set<string>>(
    new Set(initial?.locking?.unlockRoles ?? []),
  )
  const [pending, start] = useTransition()

  const toggleIn = (setter: typeof setLockRoles, key: string) =>
    setter((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const save = () =>
    start(async () => {
      const recordConfig: RecordConfig = {
        editingMode,
        locking: {
          enabled: lockEnabled,
          trigger,
          autoLockOnFinalize,
          lockRoles: Array.from(lockRoles),
          unlockRoles: Array.from(unlockRoles),
        },
      }
      const res = await updateRecordBehavior({ templateId, recordConfig })
      if (!res.ok) {
        toast.error(res.error ?? 'Could not save')
        return
      }
      toast.success('Record behaviour saved')
    })

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        How a record made from this App behaves once it exists — the way it&apos;s edited, and
        whether finished records can be locked.
      </p>

      <section className="space-y-2">
        <Label className="text-xs">Editing mode</Label>
        <div className="space-y-2">
          {EDITING_MODES.map((m) => {
            const active = editingMode === m.value
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => setEditingMode(m.value)}
                aria-pressed={active}
                className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition ${
                  active
                    ? 'border-teal-300 bg-teal-50 dark:border-teal-700 dark:bg-teal-950/40'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    active
                      ? 'border-teal-500 bg-teal-500 text-white'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                >
                  {active ? <Check size={11} /> : null}
                </span>
                <span>
                  <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                    {m.title}
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {m.description}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={lockEnabled}
            onChange={(e) => setLockEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="font-medium text-slate-800 dark:text-slate-200">
              Allow records to be locked
            </span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              A locked record is read-only until someone with permission unlocks it.
            </span>
          </span>
        </label>

        {lockEnabled ? (
          <div className="space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
            <div className="space-y-1">
              <Label className="text-xs">Lock a record</Label>
              <div className="space-y-1">
                {LOCK_TRIGGERS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    <input
                      type="radio"
                      name="lock-trigger"
                      checked={trigger === opt.value}
                      onChange={() => setTrigger(opt.value)}
                    />
                    <span className="text-slate-700 dark:text-slate-300">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <RoleMultiSelect
              label="Who can lock"
              help="Leave empty to allow anyone with edit access. Admins can always lock."
              roles={roles}
              selected={lockRoles}
              onToggle={(key) => toggleIn(setLockRoles, key)}
            />
            <RoleMultiSelect
              label="Who can unlock"
              help="Leave empty to allow anyone with edit access. Admins can always unlock."
              roles={roles}
              selected={unlockRoles}
              onToggle={(key) => toggleIn(setUnlockRoles, key)}
            />

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoLockOnFinalize}
                onChange={(e) => setAutoLockOnFinalize(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  Lock automatically when finalised
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  Records lock the moment they reach a final state, with no extra step.
                </span>
              </span>
            </label>
          </div>
        ) : null}
      </section>

      <Button onClick={save} disabled={pending} className="w-full">
        {pending ? 'Saving…' : 'Save record behaviour'}
      </Button>
    </div>
  )
}

function RoleMultiSelect({
  label,
  help,
  roles,
  selected,
  onToggle,
}: {
  label: string
  help: string
  roles: { key: string; name: string }[]
  selected: Set<string>
  onToggle: (key: string) => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {roles.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          No roles defined for this tenant.
        </p>
      ) : (
        <ul className="space-y-1">
          {roles.map((r) => (
            <li key={r.key}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                <input
                  type="checkbox"
                  checked={selected.has(r.key)}
                  onChange={() => onToggle(r.key)}
                />
                <span className="flex-1 text-slate-700 dark:text-slate-300">{r.name}</span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500">{r.key}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-slate-400 dark:text-slate-500">{help}</p>
    </div>
  )
}
