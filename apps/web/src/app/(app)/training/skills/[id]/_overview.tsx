'use client'

// Unified detail surface for a skill assignment: display AND edit in one place.
// Managers edit the mutable fields inline (debounced autosave + SaveBadge);
// everyone else sees the same layout read-only. Identity (person / skill type /
// authority) is never editable — it defines the record.

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, CloudUpload, Lock } from 'lucide-react'
import { Input, Label, Textarea, cn } from '@beaconhs/ui'

export type SkillEditableFields = {
  grantedOn: string
  expiresOn: string
  notes: string
}

type SaveState = 'idle' | 'saving' | 'saved'

export type SaveSkillAssignmentAction = (input: {
  assignmentId: string
  grantedOn: string
  expiresOn: string | null
  notes: string | null
}) => Promise<{ ok: boolean; error?: string }>

export function SkillOverview({
  assignmentId,
  canManage,
  person,
  type,
  authority,
  validForMonths,
  initial,
  saveAction,
}: {
  assignmentId: string
  canManage: boolean
  person: { id: string; firstName: string; lastName: string; employeeNo: string | null }
  type: { id: string; name: string; code: string | null }
  authority: { id: string; name: string }
  validForMonths: number | null
  initial: SkillEditableFields
  saveAction: SaveSkillAssignmentAction
}) {
  const router = useRouter()
  const [m, setM] = useState<SkillEditableFields>(initial)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(
    async (next: SkillEditableFields) => {
      const res = await saveAction({
        assignmentId,
        grantedOn: next.grantedOn,
        expiresOn: next.expiresOn || null,
        notes: next.notes.trim() || null,
      })
      setSaveState(res.ok ? 'saved' : 'idle')
      if (res.ok) {
        // Reflect status-badge / stat changes elsewhere on the page.
        if (refreshTimer.current) clearTimeout(refreshTimer.current)
        refreshTimer.current = setTimeout(() => router.refresh(), 450)
      }
    },
    [assignmentId, router, saveAction],
  )

  function field<K extends keyof SkillEditableFields>(k: K, v: SkillEditableFields[K]) {
    setM((prev) => {
      const next = { ...prev, [k]: v }
      // grantedOn is required — don't autosave an empty value.
      if (next.grantedOn) {
        setSaveState('saving')
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void flush(next), 650)
      }
      return next
    })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Skill details</h3>
        {canManage ? (
          <SaveBadge state={saveState} />
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
            <Lock size={12} /> Read only
          </span>
        )}
      </div>

      {/* Identity — always read-only */}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-2">
        <ReadRow label="Person">
          <Link
            href={`/training/transcripts/${person.id}`}
            className="font-medium text-teal-700 hover:underline dark:text-teal-300"
          >
            {person.firstName} {person.lastName}
          </Link>
          {person.employeeNo ? (
            <span className="ml-1.5 text-xs text-slate-400">#{person.employeeNo}</span>
          ) : null}
        </ReadRow>
        <ReadRow label="Authority">
          <Link
            href={`/training/authorities/${authority.id}`}
            className="text-teal-700 hover:underline dark:text-teal-300"
          >
            {authority.name}
          </Link>
        </ReadRow>
        <ReadRow label="Skill / certification">
          <Link
            href={`/training/skills/types/${type.id}`}
            className="text-teal-700 hover:underline dark:text-teal-300"
          >
            {type.code ? <span className="font-mono text-xs">{type.code}</span> : null}
            {type.code ? ' · ' : ''}
            {type.name}
          </Link>
        </ReadRow>
        <ReadRow label="Valid for">
          {validForMonths ? `${validForMonths} months` : 'No expiry'}
        </ReadRow>
      </dl>

      <div className="border-t border-slate-100 px-4 py-4 dark:border-slate-800">
        {canManage ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="s-granted">Granted on</Label>
                <Input
                  id="s-granted"
                  type="date"
                  value={m.grantedOn}
                  onChange={(e) => field('grantedOn', e.currentTarget.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-expires">Expires on</Label>
                <Input
                  id="s-expires"
                  type="date"
                  value={m.expiresOn}
                  onChange={(e) => field('expiresOn', e.currentTarget.value)}
                />
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  Leave blank for no expiry.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-notes">Notes</Label>
              <Textarea
                id="s-notes"
                rows={3}
                value={m.notes}
                onChange={(e) => field('notes', e.currentTarget.value)}
                placeholder="Internal notes about this credential"
              />
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <ReadRow label="Granted on">{m.grantedOn || '—'}</ReadRow>
            <ReadRow label="Expires on">{m.expiresOn || 'No expiry'}</ReadRow>
            {m.notes ? (
              <div className="sm:col-span-2">
                <dt className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  Notes
                </dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-slate-700 dark:text-slate-200">
                  {m.notes}
                </dd>
              </div>
            ) : null}
          </dl>
        )}
      </div>
    </div>
  )
}

function ReadRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {label}
      </dt>
      <dd className="text-slate-900 dark:text-slate-100">{children}</dd>
    </div>
  )
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === 'saving')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
        <CloudUpload size={12} /> Saving…
      </span>
    )
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        state === 'saved'
          ? 'text-teal-600 dark:text-teal-400'
          : 'text-slate-400 dark:text-slate-500',
      )}
    >
      <Check size={12} /> Saved
    </span>
  )
}
