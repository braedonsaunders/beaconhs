'use client'

// Unified detail surface for a training record (certificate): display AND edit
// in one place. Users with training.record.create edit the mutable fields inline
// (debounced autosave + SaveBadge); everyone else sees the same layout read-only.
// Identity (person / course / source) is never editable — it defines the record.

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, CloudUpload, Lock } from 'lucide-react'
import { Input, Label, Textarea, cn } from '@beaconhs/ui'

export type RecordEditableFields = {
  completedOn: string
  expiresOn: string
  instructor: string
  grade: string
  details: string
  notes: string
}

type SaveState = 'idle' | 'saving' | 'saved'

export type UpdateTrainingRecordAction = (input: {
  recordId: string
  completedOn: string
  expiresOn: string | null
  instructor: string | null
  grade: number | null
  details: string | null
  notes: string | null
}) => Promise<{ ok: boolean; error?: string }>

export function RecordOverview({
  recordId,
  canManage,
  person,
  course,
  source,
  score,
  certificateType,
  validForMonths,
  initial,
  saveAction,
}: {
  recordId: string
  canManage: boolean
  person: { id: string; firstName: string; lastName: string }
  course: { id: string; name: string; code: string | null }
  source: string
  score: number | null
  certificateType: string | null
  validForMonths: number | null
  initial: RecordEditableFields
  saveAction: UpdateTrainingRecordAction
}) {
  const router = useRouter()
  const [m, setM] = useState<RecordEditableFields>(initial)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(
    async (next: RecordEditableFields) => {
      const gradeTrim = next.grade.trim()
      const gradeNum = gradeTrim === '' ? null : Number(gradeTrim)
      const res = await saveAction({
        recordId,
        completedOn: next.completedOn,
        expiresOn: next.expiresOn || null,
        instructor: next.instructor.trim() || null,
        grade: gradeNum != null && Number.isFinite(gradeNum) ? gradeNum : null,
        details: next.details.trim() || null,
        notes: next.notes.trim() || null,
      })
      setSaveState(res.ok ? 'saved' : 'idle')
      if (res.ok) {
        // Reflect status-badge / stat changes elsewhere on the page.
        if (refreshTimer.current) clearTimeout(refreshTimer.current)
        refreshTimer.current = setTimeout(() => router.refresh(), 450)
      }
    },
    [recordId, router, saveAction],
  )

  function field<K extends keyof RecordEditableFields>(k: K, v: RecordEditableFields[K]) {
    setM((prev) => {
      const next = { ...prev, [k]: v }
      // completedOn is required — don't autosave an empty value.
      if (next.completedOn) {
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
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Record details</h3>
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
            href={`/people/${person.id}`}
            className="font-medium text-teal-700 hover:underline dark:text-teal-300"
          >
            {person.firstName} {person.lastName}
          </Link>
        </ReadRow>
        <ReadRow label="Course">
          <Link
            href={`/training/courses/${course.id}`}
            className="text-teal-700 hover:underline dark:text-teal-300"
          >
            {course.code ? <span className="font-mono text-xs">{course.code}</span> : null}
            {course.code ? ' · ' : ''}
            {course.name}
          </Link>
        </ReadRow>
        <ReadRow label="Source">{source.replace('_', ' ')}</ReadRow>
        <ReadRow label="Valid for">
          {validForMonths ? `${validForMonths} months` : 'No expiry'}
        </ReadRow>
        {score != null ? <ReadRow label="Score">{score}</ReadRow> : null}
        {certificateType ? <ReadRow label="Credential type">{certificateType}</ReadRow> : null}
      </dl>

      <div className="border-t border-slate-100 px-4 py-4 dark:border-slate-800">
        {canManage ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="r-completed">Completed on</Label>
                <Input
                  id="r-completed"
                  type="date"
                  value={m.completedOn}
                  onChange={(e) => field('completedOn', e.currentTarget.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="r-expires">Expires on</Label>
                <Input
                  id="r-expires"
                  type="date"
                  value={m.expiresOn}
                  onChange={(e) => field('expiresOn', e.currentTarget.value)}
                />
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  Leave blank for no expiry.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="r-instructor">Instructor</Label>
                <Input
                  id="r-instructor"
                  value={m.instructor}
                  onChange={(e) => field('instructor', e.currentTarget.value)}
                  placeholder="Instructor or evaluator"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="r-grade">Grade %</Label>
                <Input
                  id="r-grade"
                  type="number"
                  min="0"
                  max="100"
                  value={m.grade}
                  onChange={(e) => field('grade', e.currentTarget.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-details">Details</Label>
              <Textarea
                id="r-details"
                rows={3}
                value={m.details}
                onChange={(e) => field('details', e.currentTarget.value)}
                placeholder="Course details, modules covered, or context"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-notes">Notes</Label>
              <Textarea
                id="r-notes"
                rows={3}
                value={m.notes}
                onChange={(e) => field('notes', e.currentTarget.value)}
                placeholder="Internal notes about this record"
              />
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <ReadRow label="Completed on">{m.completedOn || '—'}</ReadRow>
            <ReadRow label="Expires on">{m.expiresOn || 'No expiry'}</ReadRow>
            <ReadRow label="Instructor">{m.instructor || '—'}</ReadRow>
            <ReadRow label="Grade">{m.grade ? `${m.grade}%` : '—'}</ReadRow>
            {m.details ? (
              <div className="sm:col-span-2">
                <dt className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  Details
                </dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-slate-700 dark:text-slate-200">
                  {m.details}
                </dd>
              </div>
            ) : null}
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
