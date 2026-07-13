'use client'

// Single-page criterion fill — the inspections analogue of the hazard-assessment
// row components. Each criterion is one always-live card: tap an answer to save
// it (optimistic), and the fail-only metadata (severity, reason, action taken,
// assignee, due date, corrected-on) auto-saves on blur/change. No Save buttons,
// no edit drawer — the input on the page IS the field, matching the
// hazard-assessment recipe (see @/components/live-field).

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Badge,
  Button,
  Input,
  Label,
  SearchSelect,
  Textarea,
  cn,
  type SelectOption,
} from '@beaconhs/ui'
import { AlertOctagon, Camera, CheckCircle2 } from 'lucide-react'
import { FileUpload, type AttachedFile } from '@/components/file-upload'
import { RawImage } from '@/components/raw-image'

type CriterionAnswer = 'pass' | 'fail' | 'n_a'
export type CriterionSeverity = 'low' | 'medium' | 'high' | 'critical'
export type CriterionResponseType = 'pass_fail_na' | 'rating' | 'yes_no'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// One save channel per card — every field funnels through it, so the card shows
// a single "Saving…/Saved ✓" affordance (the live-field convention).
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

// Debounced textarea that commits on blur + after a typing pause.
function AutoTextarea({
  label,
  initial,
  placeholder,
  rows = 2,
  disabled,
  onCommit,
}: {
  label: string
  initial: string | null
  placeholder?: string
  rows?: number
  disabled?: boolean
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
        disabled={disabled}
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

const SEVERITY_OPTS: { value: CriterionSeverity; label: string; active: string }[] = [
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

// Answer labels vary by the criterion's response type — yes/no questions read
// "Yes / No" while keeping the underlying pass/fail/n_a enum.
const ANSWER_LABELS: Record<CriterionResponseType, Record<CriterionAnswer, string>> = {
  pass_fail_na: { pass: 'Pass', fail: 'Fail', n_a: 'N/A' },
  rating: { pass: 'Pass', fail: 'Fail', n_a: 'N/A' },
  yes_no: { pass: 'Yes', fail: 'No', n_a: 'N/A' },
}

type CriterionActions = {
  setAnswer: (fd: FormData) => Promise<void>
  setSeverity: (fd: FormData) => Promise<void>
  setNonCompliance: (fd: FormData) => Promise<void>
  setActionTaken: (fd: FormData) => Promise<void>
  setCompliantNote: (fd: FormData) => Promise<void>
  setAssignment: (fd: FormData) => Promise<void>
  setCorrected: (fd: FormData) => Promise<void>
  addPhotos: (fd: FormData) => Promise<void>
}

export function CriterionCard({
  recordId,
  rowId,
  index,
  question,
  subtext,
  responseType,
  requiresPhoto,
  requiresComment,
  answer: initialAnswer,
  severity: initialSeverity,
  nonComplianceDescription,
  actionTaken,
  compliantNote,
  assignedToPersonId,
  assignedDueDate,
  correctedOn,
  overdue,
  photoPreviews,
  correctiveActionRef,
  correctiveActionId,
  peopleOptions,
  locked,
  allowCompliantNotes,
  actions,
}: {
  recordId: string
  rowId: string
  index: number
  question: string
  /** Optional guidance/help line shown under the question. */
  subtext?: string | null
  responseType: CriterionResponseType
  requiresPhoto: boolean
  requiresComment: boolean
  answer: CriterionAnswer | null
  severity: CriterionSeverity | null
  nonComplianceDescription: string | null
  actionTaken: string | null
  compliantNote: string | null
  assignedToPersonId: string | null
  assignedDueDate: string | null
  correctedOn: string | null
  overdue: boolean
  photoPreviews: { id: string; url: string; filename: string }[]
  correctiveActionRef: string | null
  correctiveActionId: string | null
  peopleOptions: SelectOption[]
  locked: boolean
  allowCompliantNotes: boolean
  actions: CriterionActions
}) {
  const { state, save, refresh } = useAutosave()
  // Optimistic local state for the values that drive what's shown.
  const [answer, setAnswerState] = useState<CriterionAnswer | null>(initialAnswer)
  const [severity, setSeverityState] = useState<CriterionSeverity | null>(initialSeverity)
  const [assignee, setAssignee] = useState(assignedToPersonId ?? '')
  const [due, setDue] = useState(assignedDueDate ?? '')
  const [corrected, setCorrected] = useState(correctedOn ?? '')

  const labels = ANSWER_LABELS[responseType] ?? ANSWER_LABELS.pass_fail_na

  function pickAnswer(next: CriterionAnswer) {
    setAnswerState(next)
    // Mirror the server: leaving 'fail' clears the failure metadata.
    if (next !== 'fail') {
      setSeverityState(null)
      setAssignee('')
      setDue('')
      setCorrected('')
    }
    save(actions.setAnswer, { recordId, rowId, answer: next })
  }

  function pickSeverity(next: CriterionSeverity) {
    const value = severity === next ? '' : next
    setSeverityState(value === '' ? null : (value as CriterionSeverity))
    save(actions.setSeverity, { recordId, rowId, severity: value })
  }

  function saveAssignment(nextAssignee: string, nextDue: string) {
    save(actions.setAssignment, {
      recordId,
      rowId,
      assignedToPersonId: nextAssignee,
      assignedDueDate: nextDue,
    })
  }

  const tone =
    answer === 'fail'
      ? 'border-red-200 bg-red-50/50 dark:border-red-900/60 dark:bg-red-950/20'
      : answer === 'pass'
        ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/60 dark:bg-emerald-950/20'
        : answer === 'n_a'
          ? 'border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/30'
          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'

  const hasBadges =
    requiresPhoto ||
    requiresComment ||
    (Boolean(severity) && answer === 'fail') ||
    overdue ||
    (Boolean(corrected) && answer === 'fail') ||
    Boolean(correctiveActionRef)

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
          {subtext ? (
            <p className="mt-0.5 text-xs leading-snug text-slate-500 dark:text-slate-400">
              {subtext}
            </p>
          ) : null}
          {hasBadges ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              {requiresPhoto ? (
                <Badge variant="secondary" className="gap-1">
                  <Camera size={10} /> Photo
                </Badge>
              ) : null}
              {requiresComment ? <Badge variant="secondary">Comment</Badge> : null}
              {severity && answer === 'fail' ? (
                <span
                  className={cn(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                    SEVERITY_OPTS.find((o) => o.value === severity)?.active,
                  )}
                >
                  {severity}
                </span>
              ) : null}
              {overdue ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-red-700 uppercase dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                  <AlertOctagon size={10} /> Overdue
                </span>
              ) : null}
              {corrected && answer === 'fail' ? (
                <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                  Corrected {corrected}
                </span>
              ) : null}
              {correctiveActionRef ? (
                <Link
                  href={`/corrective-actions/${correctiveActionId}`}
                  className="text-teal-700 hover:underline dark:text-teal-400"
                >
                  ↳ {correctiveActionRef}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <SaveDot state={state} />
          {locked ? (
            <Badge variant="outline">{answer ? labels[answer] : '—'}</Badge>
          ) : (
            <div className="flex items-center gap-1">
              {(['pass', 'fail', 'n_a'] as const).map((opt) => {
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
                    {labels[opt]}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

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
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              High or Critical spawns a corrective action automatically.
            </p>
          </div>

          <AutoTextarea
            label="Reason for non-compliance"
            initial={nonComplianceDescription}
            placeholder="What's wrong?"
            onCommit={(v) => save(actions.setNonCompliance, { recordId, rowId, value: v })}
          />
          <AutoTextarea
            label="Action taken"
            initial={actionTaken}
            placeholder="What was done to remediate?"
            onCommit={(v) => save(actions.setActionTaken, { recordId, rowId, value: v })}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-1">
              <Label className="text-xs">Assigned to</Label>
              <SearchSelect
                value={assignee}
                onChange={(next) => {
                  setAssignee(next)
                  saveAssignment(next, due)
                }}
                options={peopleOptions}
                placeholder="— unassigned —"
                searchPlaceholder="Search active people…"
                sheetTitle="Assign finding"
                ariaLabel="Assigned to"
                clearable
                emptyLabel="— unassigned —"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Due date</Label>
              <Input
                type="date"
                value={due}
                onChange={(e) => {
                  setDue(e.target.value)
                  saveAssignment(assignee, e.target.value)
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Corrected on</Label>
              <Input
                type="date"
                value={corrected}
                onChange={(e) => {
                  setCorrected(e.target.value)
                  save(actions.setCorrected, { recordId, rowId, correctedOn: e.target.value })
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Compliant note — pass / N-A, when the type allows it. Criteria that
          require a comment always get the field (the submit gate enforces it). */}
      {(allowCompliantNotes || requiresComment) && answer && answer !== 'fail' && !locked ? (
        <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
          <AutoTextarea
            label={requiresComment ? 'Comment (required)' : 'Notes (optional)'}
            initial={compliantNote}
            rows={1}
            placeholder="Anything worth noting?"
            onCommit={(v) => save(actions.setCompliantNote, { recordId, rowId, value: v })}
          />
        </div>
      ) : null}

      {/* Photos — always offered on fails and on photo-required criteria (the
          submit gate refuses photo-required rows with no attachment). */}
      {photoPreviews.length > 0 || (!locked && (answer === 'fail' || requiresPhoto)) ? (
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
                  <RawImage src={p.url} alt={p.filename} className="h-full w-full object-cover" />
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
      {locked &&
      (nonComplianceDescription || actionTaken || compliantNote || assignedDueDate || corrected) ? (
        <div className="mt-2 space-y-0.5 border-t border-slate-200 pt-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
          {severity ? <div>Severity: {severity}</div> : null}
          {nonComplianceDescription ? <div>Non-compliance: {nonComplianceDescription}</div> : null}
          {actionTaken ? <div>Action taken: {actionTaken}</div> : null}
          {assignedDueDate ? <div>Due: {assignedDueDate}</div> : null}
          {corrected ? <div>Corrected on: {corrected}</div> : null}
          {compliantNote ? <div>Notes: {compliantNote}</div> : null}
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
