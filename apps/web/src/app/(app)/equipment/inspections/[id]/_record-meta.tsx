'use client'

// Record-level live fields (occurred-at, hours, notes) — autosave on change/blur,
// no Save button, matching the criterion fill cards.

import { useRef, useState, useTransition } from 'react'
import { Input, Label, Textarea, cn } from '@beaconhs/ui'
import { setRecordHours, setRecordNotes, setRecordOccurredAt } from '../_actions'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function useField(action: (fd: FormData) => Promise<void>, recordId: string) {
  const [state, setState] = useState<SaveState>('idle')
  const [, start] = useTransition()
  function save(value: string) {
    setState('saving')
    start(async () => {
      try {
        const fd = new FormData()
        fd.set('recordId', recordId)
        fd.set('value', value)
        await action(fd)
        setState('saved')
        setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 1500)
      } catch {
        setState('error')
      }
    })
  }
  return { state, save }
}

function Dot({ state }: { state: SaveState }) {
  if (state === 'idle') return null
  return (
    <span
      className={cn(
        'ml-2 text-[11px] font-medium',
        state === 'saving' && 'text-slate-400',
        state === 'saved' && 'text-emerald-600',
        state === 'error' && 'text-red-600',
      )}
    >
      {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Retry'}
    </span>
  )
}

export function RecordMeta({
  recordId,
  occurredAt,
  occurredAtDisplay,
  hours,
  notes,
  locked,
}: {
  recordId: string
  /** datetime-local input value, already formatted in the viewer's timezone. */
  occurredAt: string
  /** Human-readable timestamp in the viewer's timezone, for the locked view. */
  occurredAtDisplay: string
  hours: string
  notes: string
  locked: boolean
}) {
  const occurred = useField(setRecordOccurredAt, recordId)
  const hrs = useField(setRecordHours, recordId)
  const note = useField(setRecordNotes, recordId)
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [noteVal, setNoteVal] = useState(notes)

  if (locked) {
    return (
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 text-sm sm:grid-cols-3 dark:border-slate-800">
        <div>
          <div className="text-xs text-slate-500">Performed</div>
          <div className="text-slate-800 dark:text-slate-200">{occurredAtDisplay || '—'}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Hours / reading</div>
          <div className="text-slate-800 dark:text-slate-200">{hours || '—'}</div>
        </div>
        <div className="sm:col-span-3">
          <div className="text-xs text-slate-500">Notes</div>
          <div className="whitespace-pre-wrap text-slate-800 dark:text-slate-200">
            {notes || '—'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2 dark:border-slate-800">
      <div className="space-y-1">
        <Label className="text-xs">
          Performed <Dot state={occurred.state} />
        </Label>
        <Input
          type="datetime-local"
          defaultValue={occurredAt}
          onBlur={(e) => occurred.save(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">
          Hours / meter reading <Dot state={hrs.state} />
        </Label>
        <Input
          type="number"
          step="0.1"
          defaultValue={hours}
          placeholder="0"
          onBlur={(e) => hrs.save(e.target.value)}
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-xs">
          Notes <Dot state={note.state} />
        </Label>
        <Textarea
          rows={2}
          value={noteVal}
          placeholder="Anything worth noting about this inspection"
          onChange={(e) => {
            setNoteVal(e.target.value)
            if (noteTimer.current) clearTimeout(noteTimer.current)
            noteTimer.current = setTimeout(() => note.save(e.target.value), 1000)
          }}
          onBlur={() => note.save(noteVal)}
        />
      </div>
    </div>
  )
}
