'use client'

// Interactive workflow-step panel for /forms/responses/[id].
//
// Renders the workflow steps from the template's schema, joined against the
// per-step state (signed/rejected/pending). Exposes Sign / Advance / Reject
// affordances for the *current* step only — completed and future steps are
// read-only. All actions call the server actions in _actions.ts.
//
// Layout per step:
//   ┌─ pending ────────────────────────────────────────────┐
//   │ Step 2 of 4 · Supervisor signoff   [Current]         │
//   │ Sign with your finger, pen, or mouse                 │
//   │ [canvas]                                             │
//   │ [Sign & advance]  [Reject…]                          │
//   └──────────────────────────────────────────────────────┘
//   ┌─ signed ─────────────────────────────────────────────┐
//   │ Step 1 of 4 · Crew acknowledgement   [Signed]        │
//   │ John Smith · 2026-05-19 09:32                        │
//   │ [signature thumbnail]                                │
//   └──────────────────────────────────────────────────────┘

import { useMemo, useState, useTransition } from 'react'
import { CheckCircle2, ChevronRight, Circle, XCircle } from 'lucide-react'
import { Badge, Button, Textarea } from '@beaconhs/ui'
import { SignaturePad } from '@/components/signature-pad'
import { advanceWorkflowStep, rejectWorkflowStep, signWorkflowStep } from './_actions'

// Mirror of @beaconhs/db/schema FormWorkflowStep + workflow-step-state shape,
// but client-friendly (no Date instances). The page passes already-serialised
// rows; we never reach into Drizzle types here.
export type WorkflowStepProp = {
  key: string
  sequence: number // 0-based
  title: string
  signatureRequired: boolean
  assigneeKind: 'literal' | 'role' | 'expression'
  assigneeLabel: string // human-readable: 'Foreman', '$submitter', etc.
  // State (populated from form_response_steps + workflow_state)
  status: 'pending' | 'signed' | 'rejected' | 'skipped'
  signedAt: string | null // ISO
  signedBy: string | null // human-readable
  signatureDataUrl: string | null
  comment: string | null
  rejectionReason: string | null
  rejectedAt: string | null // ISO
  rejectedBy: string | null
}

export function WorkflowPanel({
  responseId,
  steps,
  currentStepKey,
  responseStatus,
  canAct,
}: {
  responseId: string
  steps: WorkflowStepProp[]
  currentStepKey: string | null
  responseStatus: string
  canAct: boolean
}) {
  // Resolve which step is "current" — falls back to first pending if not set.
  const resolvedCurrent = useMemo(() => {
    if (currentStepKey) return currentStepKey
    const firstPending = steps.find((s) => s.status === 'pending' || s.status === 'rejected')
    return firstPending?.key ?? steps[0]?.key ?? null
  }, [currentStepKey, steps])

  if (steps.length === 0) {
    return <p className="text-sm text-slate-500">No workflow configured for this template.</p>
  }

  // Terminal states block further actions even on the "current" step.
  const terminal = responseStatus === 'closed' || responseStatus === 'rejected'

  return (
    <ol className="space-y-3">
      {steps.map((step) => {
        const isCurrent = step.key === resolvedCurrent
        const isFuture =
          !isCurrent &&
          step.status === 'pending' &&
          step.sequence > (steps.find((s) => s.key === resolvedCurrent)?.sequence ?? -1)
        return (
          <li key={step.key}>
            <WorkflowStepCard
              step={step}
              responseId={responseId}
              isCurrent={isCurrent}
              isFuture={isFuture}
              canAct={canAct && isCurrent && !terminal}
              totalSteps={steps.length}
            />
          </li>
        )
      })}
    </ol>
  )
}

function WorkflowStepCard({
  step,
  responseId,
  isCurrent,
  isFuture,
  canAct,
  totalSteps,
}: {
  step: WorkflowStepProp
  responseId: string
  isCurrent: boolean
  isFuture: boolean
  canAct: boolean
  totalSteps: number
}) {
  const stateBadge =
    step.status === 'signed' ? (
      <Badge variant="success">
        <CheckCircle2 size={12} /> Signed
      </Badge>
    ) : step.status === 'rejected' ? (
      <Badge variant="destructive">
        <XCircle size={12} /> Rejected
      </Badge>
    ) : isCurrent ? (
      <Badge variant="warning">
        <ChevronRight size={12} /> Current
      </Badge>
    ) : (
      <Badge variant="secondary">
        <Circle size={12} /> Pending
      </Badge>
    )

  return (
    <div
      className={
        'rounded-md border p-3 ' +
        (isCurrent
          ? 'border-amber-300 bg-amber-50/40'
          : step.status === 'signed'
            ? 'border-emerald-200 bg-emerald-50/30'
            : step.status === 'rejected'
              ? 'border-red-200 bg-red-50/30'
              : 'border-slate-200 bg-white')
      }
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs tracking-wide text-slate-500 uppercase">
            Step {step.sequence + 1} of {totalSteps}
          </div>
          <div className="text-sm font-medium text-slate-900">{step.title}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            Assignee:{' '}
            <span className="font-mono">
              {step.assigneeKind === 'role'
                ? `role: ${step.assigneeLabel}`
                : step.assigneeKind === 'expression'
                  ? step.assigneeLabel
                  : step.assigneeLabel}
            </span>
            {step.signatureRequired ? (
              <span className="ml-2 text-amber-700">· signature required</span>
            ) : null}
          </div>
        </div>
        {stateBadge}
      </header>

      {/* Signed-step body — signer + signature thumbnail */}
      {step.status === 'signed' ? (
        <div className="mt-3 space-y-2 text-sm">
          <div className="text-slate-700">
            Signed by <strong>{step.signedBy ?? '—'}</strong>
            {step.signedAt ? <> · {new Date(step.signedAt).toLocaleString()}</> : null}
          </div>
          {step.signatureDataUrl ? (
            <div className="rounded border border-slate-200 bg-white p-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={step.signatureDataUrl}
                alt={`Signature for ${step.title}`}
                className="max-h-24 w-auto"
              />
            </div>
          ) : null}
          {step.comment ? <div className="text-xs text-slate-500">Note: {step.comment}</div> : null}
        </div>
      ) : null}

      {/* Rejected-step body — reason + when */}
      {step.status === 'rejected' ? (
        <div className="mt-3 space-y-1 rounded-md border border-red-200 bg-white p-2 text-sm">
          <div className="text-red-800">
            Rejected by <strong>{step.rejectedBy ?? '—'}</strong>
            {step.rejectedAt ? <> · {new Date(step.rejectedAt).toLocaleString()}</> : null}
          </div>
          <div className="text-slate-700">
            <span className="text-xs tracking-wide text-slate-500 uppercase">Reason:</span>{' '}
            {step.rejectionReason}
          </div>
          {canAct ? (
            <p className="mt-2 text-xs text-slate-500">
              Re-capture a signature below to re-attempt this step.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Future / pending non-current: leave header-only */}
      {isFuture ? <p className="mt-2 text-xs text-slate-500 italic">Awaits earlier step.</p> : null}

      {/* Action affordances live only on the active step + when the actor can act */}
      {canAct ? (
        <ActiveStepActions
          step={step}
          responseId={responseId}
          showResign={step.status === 'rejected'}
        />
      ) : null}
    </div>
  )
}

function ActiveStepActions({
  step,
  responseId,
  showResign,
}: {
  step: WorkflowStepProp
  responseId: string
  showResign: boolean
}) {
  const [mode, setMode] = useState<'idle' | 'sign' | 'reject'>(
    step.status === 'signed' ? 'idle' : 'sign',
  )
  const [signature, setSignature] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState('')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function clearLocalState() {
    setSignature(null)
    setComment('')
    setReason('')
    setError(null)
  }

  function doSign() {
    setError(null)
    if (!signature) {
      setError('Capture a signature first')
      return
    }
    start(async () => {
      const r = await signWorkflowStep({
        responseId,
        stepKey: step.key,
        signatureDataUrl: signature,
        comment: comment.trim() || null,
      })
      if (!r.ok) {
        setError(r.error)
        return
      }
      // After a successful sign, auto-advance so the actor doesn't have to
      // click twice. If the step has signatureRequired=false this is still
      // correct because advanceWorkflowStep happily moves a signed step.
      const adv = await advanceWorkflowStep({
        responseId,
        currentStepKey: step.key,
      })
      if (!adv.ok) {
        setError(adv.error)
        return
      }
      clearLocalState()
      setMode('idle')
    })
  }

  function doAdvanceWithoutSignature() {
    setError(null)
    start(async () => {
      const r = await advanceWorkflowStep({
        responseId,
        currentStepKey: step.key,
      })
      if (!r.ok) {
        setError(r.error)
        return
      }
      clearLocalState()
      setMode('idle')
    })
  }

  function doReject() {
    setError(null)
    if (!reason.trim()) {
      setError('A reason is required')
      return
    }
    start(async () => {
      const r = await rejectWorkflowStep({
        responseId,
        currentStepKey: step.key,
        reason: reason.trim(),
      })
      if (!r.ok) {
        setError(r.error)
        return
      }
      clearLocalState()
      setMode('idle')
    })
  }

  // Already signed but still current (final step before close) — show only
  // an Advance button.
  if (step.status === 'signed') {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" onClick={doAdvanceWithoutSignature} disabled={pending}>
          {pending ? 'Working…' : 'Advance / Close'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setMode('reject')}
          disabled={pending}
        >
          Reject step
        </Button>
        {mode === 'reject' ? (
          <div className="w-full space-y-2 rounded-md border border-red-200 bg-white p-2">
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for rejecting this step…"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setMode('idle')
                  clearLocalState()
                }}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={doReject}
                disabled={pending || !reason.trim()}
              >
                {pending ? 'Working…' : 'Reject'}
              </Button>
            </div>
          </div>
        ) : null}
        {error ? <div className="text-xs text-red-600">{error}</div> : null}
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-3">
      {showResign ? (
        <div className="text-xs tracking-wide text-slate-500 uppercase">Re-sign</div>
      ) : null}
      {/* SIGN sub-form */}
      {mode === 'sign' ? (
        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-2">
          <SignaturePad value={signature} onChange={setSignature} />
          <Textarea
            rows={1}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional note (e.g. 'pending verification')"
          />
          <div className="flex flex-wrap justify-end gap-2">
            {!step.signatureRequired ? (
              <Button
                type="button"
                variant="outline"
                onClick={doAdvanceWithoutSignature}
                disabled={pending}
              >
                Advance without signature
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => setMode('reject')}
              disabled={pending}
            >
              Reject step
            </Button>
            <Button type="button" onClick={doSign} disabled={pending || !signature}>
              {pending ? 'Working…' : 'Sign & advance'}
            </Button>
          </div>
        </div>
      ) : null}

      {/* REJECT sub-form */}
      {mode === 'reject' ? (
        <div className="space-y-2 rounded-md border border-red-200 bg-white p-2">
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for rejecting this step (required)…"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setMode('sign')
                clearLocalState()
              }}
              disabled={pending}
            >
              Back to sign
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={doReject}
              disabled={pending || !reason.trim()}
            >
              {pending ? 'Working…' : 'Reject step'}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <div className="text-xs text-red-600">{error}</div> : null}
    </div>
  )
}
