'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  // Which system tabs the record page renders. Unset defaults live on the record
  // page: review auto-on only when the app scores or signs off, comments + audit on.
  tabs?: {
    review?: boolean
    comments?: boolean
    audit?: boolean
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
  const [tabReview, setTabReview] = useState<boolean>(initial?.tabs?.review ?? false)
  const [tabComments, setTabComments] = useState<boolean>(initial?.tabs?.comments ?? true)
  const [tabAudit, setTabAudit] = useState<boolean>(initial?.tabs?.audit ?? true)
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
        tabs: {
          review: tabReview,
          comments: tabComments,
          audit: tabAudit,
        },
      }
      const res = await updateRecordBehavior({ templateId, recordConfig })
      if (!res.ok) {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0af1983403d12e')))
        return
      }
      toast.success(tGenerated('m_00681575a0664e'))
    })

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_0803b7b920d907" />
      </p>

      <section className="space-y-2">
        <Label className="text-xs">
          <GeneratedText id="m_0879e428dfc8f6" />
        </Label>
        <div className="space-y-2">
          <GeneratedValue
            value={EDITING_MODES.map((m) => {
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
                    <GeneratedValue value={active ? <Check size={11} /> : null} />
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
                      <GeneratedValue value={m.title} />
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      <GeneratedValue value={m.description} />
                    </span>
                  </span>
                </button>
              )
            })}
          />
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
              <GeneratedText id="m_15cff7e96f61aa" />
            </span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              <GeneratedText id="m_1f8c77feb5365e" />
            </span>
          </span>
        </label>

        <GeneratedValue
          value={
            lockEnabled ? (
              <div className="space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                <div className="space-y-1">
                  <Label className="text-xs">
                    <GeneratedText id="m_02e677adb5c678" />
                  </Label>
                  <div className="space-y-1">
                    <GeneratedValue
                      value={LOCK_TRIGGERS.map((opt) => (
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
                          <span className="text-slate-700 dark:text-slate-300">
                            <GeneratedValue value={opt.label} />
                          </span>
                        </label>
                      ))}
                    />
                  </div>
                </div>

                <RoleMultiSelect
                  label={tGenerated('m_05028cd7450139')}
                  help="Leave empty to allow anyone with edit access. Admins can always lock."
                  roles={roles}
                  selected={lockRoles}
                  onToggle={(key) => toggleIn(setLockRoles, key)}
                />
                <RoleMultiSelect
                  label={tGenerated('m_1aa712173e01f9')}
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
                      <GeneratedText id="m_0e15f6f99b6f18" />
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      <GeneratedText id="m_1fb233c2fe56fd" />
                    </span>
                  </span>
                </label>
              </div>
            ) : null
          }
        />
      </section>

      <section className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <div className="space-y-0.5">
          <Label className="text-xs">
            <GeneratedText id="m_1c3acdb7f9e7b2" />
          </Label>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_023c8de0a422af" />
          </p>
        </div>
        <TabToggle
          label={tGenerated('m_08b7d8b7086dea')}
          help="Compliance scoring + sign-off. Off for plain capture apps that don't need review."
          checked={tabReview}
          onChange={setTabReview}
        />
        <TabToggle
          label={tGenerated('m_178ca0601c94ed')}
          help="Let reviewers leave comments on a record."
          checked={tabComments}
          onChange={setTabComments}
        />
        <TabToggle
          label={tGenerated('m_1d08c50771a4bc')}
          help="Show the change history tab."
          checked={tabAudit}
          onChange={setTabAudit}
        />
      </section>

      <Button onClick={save} disabled={pending} className="w-full">
        <GeneratedValue
          value={
            pending ? (
              <GeneratedText id="m_106811f2aac664" />
            ) : (
              <GeneratedText id="m_17ba4a8c9186fa" />
            )
          }
        />
      </Button>
    </div>
  )
}

function TabToggle({
  label,
  help,
  checked,
  onChange,
}: {
  label: string
  help: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <span>
        <span className="font-medium text-slate-800 dark:text-slate-200">
          <GeneratedValue value={label} />
        </span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">
          <GeneratedValue value={help} />
        </span>
      </span>
    </label>
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
      <Label className="text-xs">
        <GeneratedValue value={label} />
      </Label>
      <GeneratedValue
        value={
          roles.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              <GeneratedText id="m_008f5a3d7812ab" />
            </p>
          ) : (
            <ul className="space-y-1">
              <GeneratedValue
                value={roles.map((r) => (
                  <li key={r.key}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                      <input
                        type="checkbox"
                        checked={selected.has(r.key)}
                        onChange={() => onToggle(r.key)}
                      />
                      <span className="flex-1 text-slate-700 dark:text-slate-300">
                        <GeneratedValue value={r.name} />
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">
                        <GeneratedValue value={r.key} />
                      </span>
                    </label>
                  </li>
                ))}
              />
            </ul>
          )
        }
      />
      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        <GeneratedValue value={help} />
      </p>
    </div>
  )
}
