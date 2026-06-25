'use client'

// Equipment inspection criterion fill card — one always-live card per criterion.
// The control varies by kind: pass/fail(/N/A) buttons, a text or numeric input,
// or a photo requirement. A 'fail' reveals severity + reason + action-taken.
// Everything autosaves (optimistic) — no Save buttons. Mirrors the inspections
// fill card, trimmed for equipment (work orders are spawned on submit, so no
// per-criterion assignee/CA wiring here).

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, Input, Label, Textarea, cn } from '@beaconhs/ui'
import { Camera, CheckCircle2 } from 'lucide-react'
import { FileUpload, type AttachedFile } from '@/components/file-upload'

export type EqAnswer = 'pass' | 'fail' | 'n_a'
export type EqSeverity = 'low' | 'medium' | 'high' | 'critical'
export type EqKind = 'pass_fail' | 'pass_fail_na' | 'text' | 'numeric' | 'photo'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function useAutosave() {
  const [state, setState] = useState<SaveState>('idle')
  const [, start] = useTransition()
  const router = useRouter()
  function save(action: (fd: FormData) => Promise<void>, fields: Record<string, string>) {
    setState('saving')
    start(async () => {
      try {
        const fd = new FormData()
        for (const [k, v] of Object.entries(fields)) fd.set(k, v)
        await action(fd)
        setState('saved')
        setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 1500)
      } catch {
        setState('error')
      }
    })
  }
  return { state, save, refresh: () => router.refresh() }
}

function SaveDot({ state }: { state: SaveState }) {
  if (state === 'idle') return null
  return (
    <span
      className={cn(
        'text-[11px] font-medium',
        state === 'saving' && 'text-slate-400',
        state === 'saved' && 'text-emerald-600',
        state === 'error' && 'text-red-600',
      )}
    >
      {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Not saved — retry'}
    </span>
  )
}

function AutoTextarea({
  label,
  initial,
  placeholder,
  rows = 2,
  onCommit,
}: {
  label: string
  initial: string | null
  placeholder?: string
  rows?: number
  onCommit: (value: string) => void
}) {
  const [value, setValue] = useState(initial ?? '')
  const baseline = useRef(initial ?? '')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function commit(next: string) {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (next === baseline.current) return
    baseline.current = next
    onCommit(next)
  }
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          setValue(e.target.value)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => commit(e.target.value), 1000)
        }}
        onBlur={() => commit(value)}
      />
    </div>
  )
}

const SEVERITY_OPTS: { value: EqSeverity; label: string; active: string }[] = [
  {
    value: 'low',
    label: 'Low',
    active: 'border-slate-400 bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
  },
  {
    value: 'medium',
    label: 'Medium',
    active:
      'border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-700',
  },
  {
    value: 'high',
    label: 'High',
    active:
      'border-orange-400 bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-200 dark:border-orange-700',
  },
  {
    value: 'critical',
    label: 'Critical',
    active:
      'border-rose-400 bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-700',
  },
]

const ANSWER_OPTS: Record<'pass_fail' | 'pass_fail_na', EqAnswer[]> = {
  pass_fail: ['pass', 'fail'],
  pass_fail_na: ['pass', 'fail', 'n_a'],
}
const ANSWER_LABEL: Record<EqAnswer, string> = { pass: 'Pass', fail: 'Fail', n_a: 'N/A' }

export type CriterionActions = {
  setAnswer: (fd: FormData) => Promise<void>
  setSeverity: (fd: FormData) => Promise<void>
  setComment: (fd: FormData) => Promise<void>
  setActionTaken: (fd: FormData) => Promise<void>
  setValue: (fd: FormData) => Promise<void>
  addPhotos: (fd: FormData) => Promise<void>
}

export function CriterionCard({
  recordId,
  rowId,
  index,
  question,
  kind,
  isCritical,
  requiresPhoto,
  requiresComment,
  answer: initialAnswer,
  severity: initialSeverity,
  comment,
  actionTaken,
  textValue,
  numericValue,
  photoPreviews,
  workOrderRef,
  locked,
  actions,
}: {
  recordId: string
  rowId: string
  index: number
  question: string
  kind: EqKind
  isCritical: boolean
  requiresPhoto: boolean
  requiresComment: boolean
  answer: EqAnswer | null
  severity: EqSeverity | null
  comment: string | null
  actionTaken: string | null
  textValue: string | null
  numericValue: string | null
  photoPreviews: { id: string; url: string; filename: string }[]
  workOrderRef: string | null
  locked: boolean
  actions: CriterionActions
}) {
  const { state, save, refresh } = useAutosave()
  const [answer, setAnswerState] = useState<EqAnswer | null>(initialAnswer)
  const [severity, setSeverityState] = useState<EqSeverity | null>(initialSeverity)

  const isChoice = kind === 'pass_fail' || kind === 'pass_fail_na'

  function pickAnswer(next: EqAnswer) {
    setAnswerState(next)
    save(actions.setAnswer, { recordId, rowId, answer: next })
  }
  function pickSeverity(next: EqSeverity) {
    const value = severity === next ? '' : next
    setSeverityState(value === '' ? null : (value as EqSeverity))
    save(actions.setSeverity, { recordId, rowId, severity: value })
  }

  const tone =
    answer === 'fail'
      ? 'border-red-200 bg-red-50/50 dark:border-red-900/60 dark:bg-red-950/20'
      : answer === 'pass'
        ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/60 dark:bg-emerald-950/20'
        : answer === 'n_a'
          ? 'border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/30'
          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'

  return (
    <div className={cn('rounded-lg border p-2.5 transition-colors sm:p-3', tone)}>
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-slate-900 dark:text-slate-100">
            <span className="mr-1.5 align-baseline text-xs font-normal text-slate-400 tabular-nums dark:text-slate-500">
              {index + 1}.
            </span>
            <span className="font-medium">{question}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {isCritical ? <Badge variant="destructive">critical</Badge> : null}
            {requiresPhoto ? (
              <Badge variant="secondary" className="gap-1">
                <Camera size={10} /> Photo
              </Badge>
            ) : null}
            {requiresComment ? <Badge variant="secondary">Comment</Badge> : null}
            {workOrderRef ? (
              <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700 uppercase dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                ↳ {workOrderRef}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <SaveDot state={state} />
          {isChoice && !locked ? (
            <div className="flex items-center gap-1">
              {ANSWER_OPTS[kind as 'pass_fail' | 'pass_fail_na'].map((opt) => {
                const active = answer === opt
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => pickAnswer(opt)}
                    aria-pressed={active}
                    className={cn(
                      'min-h-9 rounded-md border px-2.5 text-sm font-medium transition-colors sm:min-h-0 sm:py-1 sm:text-xs',
                      active
                        ? opt === 'pass'
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : opt === 'fail'
                            ? 'border-red-500 bg-red-500 text-white'
                            : 'border-slate-500 bg-slate-500 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
                    )}
                  >
                    {ANSWER_LABEL[opt]}
                  </button>
                )
              })}
            </div>
          ) : isChoice && locked ? (
            <Badge variant="outline">{answer ? ANSWER_LABEL[answer] : '—'}</Badge>
          ) : null}
        </div>
      </div>

      {/* Text / numeric answer kinds */}
      {kind === 'text' && !locked ? (
        <div className="mt-2">
          <AutoTextarea
            label="Answer"
            initial={textValue}
            rows={1}
            placeholder="Enter response"
            onCommit={(v) => save(actions.setValue, { recordId, rowId, kind, value: v })}
          />
        </div>
      ) : null}
      {kind === 'numeric' && !locked ? (
        <div className="mt-2 space-y-1">
          <Label className="text-xs">Reading</Label>
          <Input
            type="number"
            defaultValue={numericValue ?? ''}
            placeholder="0"
            onBlur={(e) => save(actions.setValue, { recordId, rowId, kind, value: e.target.value })}
          />
        </div>
      ) : null}
      {(kind === 'text' || kind === 'numeric') && locked ? (
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
          {textValue ?? numericValue ?? '—'}
        </p>
      ) : null}

      {/* Failure metadata — only when failed and editable. */}
      {answer === 'fail' && !locked ? (
        <div className="mt-3 space-y-3 border-t border-red-200/70 pt-3 dark:border-red-900/50">
          <div className="space-y-1">
            <Label className="text-xs">Severity</Label>
            <div className="flex items-center gap-1.5">
              {SEVERITY_OPTS.map((o) => {
                const active = severity === o.value
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => pickSeverity(o.value)}
                    aria-pressed={active}
                    className={cn(
                      'min-h-10 flex-1 rounded-lg border text-xs font-semibold transition-colors sm:min-h-0 sm:py-1.5',
                      active
                        ? o.active
                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500',
                    )}
                  >
                    {o.label}
                  </button>
                )
              })}
            </div>
          </div>
          <AutoTextarea
            label="What's wrong?"
            initial={comment}
            placeholder="Describe the defect"
            onCommit={(v) => save(actions.setComment, { recordId, rowId, value: v })}
          />
          <AutoTextarea
            label="Action taken"
            initial={actionTaken}
            placeholder="What was done to remediate?"
            onCommit={(v) => save(actions.setActionTaken, { recordId, rowId, value: v })}
          />
        </div>
      ) : null}

      {/* Photos */}
      {photoPreviews.length > 0 || (!locked && (requiresPhoto || kind === 'photo' || answer === 'fail')) ? (
        <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
          {photoPreviews.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {photoPreviews.map((p) => (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block h-16 w-16 overflow-hidden rounded border border-slate-200 dark:border-slate-700"
                >
                  <img src={p.url} alt={p.filename} className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          ) : null}
          {!locked ? (
            <CriterionPhotoUploader
              recordId={recordId}
              rowId={rowId}
              addPhotos={actions.addPhotos}
              onDone={refresh}
            />
          ) : null}
        </div>
      ) : null}

      {/* Locked read-only summary */}
      {locked && (comment || actionTaken || (severity && answer === 'fail')) ? (
        <div className="mt-2 space-y-0.5 border-t border-slate-200 pt-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
          {severity && answer === 'fail' ? <div>Severity: {severity}</div> : null}
          {comment ? <div>Defect: {comment}</div> : null}
          {actionTaken ? <div>Action taken: {actionTaken}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

function CriterionPhotoUploader({
  recordId,
  rowId,
  addPhotos,
  onDone,
}: {
  recordId: string
  rowId: string
  addPhotos: (fd: FormData) => Promise<void>
  onDone: () => void
}) {
  const [pending, start] = useTransition()
  const [staged, setStaged] = useState<AttachedFile[]>([])
  function attach() {
    if (staged.length === 0) return
    const fd = new FormData()
    fd.set('recordId', recordId)
    fd.set('rowId', rowId)
    fd.set('attachmentIds', staged.map((s) => s.attachmentId).join(','))
    start(async () => {
      await addPhotos(fd)
      setStaged([])
      onDone()
    })
  }
  return (
    <div className="space-y-2">
      <FileUpload variant="photo" value={staged} onChange={setStaged} />
      {staged.length > 0 ? (
        <Button type="button" size="sm" onClick={attach} disabled={pending}>
          {pending ? (
            'Attaching…'
          ) : (
            <>
              <CheckCircle2 size={14} /> Attach {staged.length} photo
              {staged.length === 1 ? '' : 's'}
            </>
          )}
        </Button>
      ) : null}
    </div>
  )
}
