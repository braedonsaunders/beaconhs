'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

// Interactive workflow-step panel for /apps/responses/[id].
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
import { RawImage } from '@/components/raw-image'
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
  signatureUrl: string | null
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
    return (
      <p className="text-sm text-slate-500">
        <GeneratedText id="m_0122051bdf4938" />
      </p>
    )
  }

  // Terminal states block further actions even on the "current" step.
  const terminal = responseStatus === 'closed' || responseStatus === 'rejected'

  return (
    <ol className="space-y-3">
      <GeneratedValue
        value={steps.map((step) => {
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
      />
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
  const tGenerated = useGeneratedTranslations()
  const stateBadge =
    step.status === 'signed' ? (
      <Badge variant="success">
        <CheckCircle2 size={12} /> <GeneratedText id="m_142c80b0b4c3f4" />
      </Badge>
    ) : step.status === 'rejected' ? (
      <Badge variant="destructive">
        <XCircle size={12} /> <GeneratedText id="m_1870217cd63ffc" />
      </Badge>
    ) : isCurrent ? (
      <Badge variant="warning">
        <ChevronRight size={12} /> <GeneratedText id="m_134fafff4446f6" />
      </Badge>
    ) : (
      <Badge variant="secondary">
        <Circle size={12} /> <GeneratedText id="m_131b7246255b65" />
      </Badge>
    )

  return (
    <div
      className={
        'rounded-md border p-3 ' +
        (isCurrent
          ? 'border-amber-300 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/30'
          : step.status === 'signed'
            ? 'border-emerald-200 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/30'
            : step.status === 'rejected'
              ? 'border-red-200 bg-red-50/30 dark:border-red-900 dark:bg-red-950/30'
              : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900')
      }
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs tracking-wide text-slate-500 uppercase">
            <GeneratedText id="m_0cff7e37da2b3f" /> <GeneratedValue value={step.sequence + 1} />{' '}
            <GeneratedText id="m_00e704d1194796" /> <GeneratedValue value={totalSteps} />
          </div>
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
            <GeneratedValue value={step.title} />
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            <GeneratedText id="m_1447cf1def2174" />
            <GeneratedValue value={' '} />
            <span className="font-mono">
              <GeneratedValue
                value={
                  step.assigneeKind === 'role' ? (
                    <GeneratedText id="m_1b7232e0de4d59" values={{ value0: step.assigneeLabel }} />
                  ) : step.assigneeKind === 'expression' ? (
                    step.assigneeLabel
                  ) : (
                    step.assigneeLabel
                  )
                }
              />
            </span>
            <GeneratedValue
              value={
                step.signatureRequired ? (
                  <span className="ml-2 text-amber-700 dark:text-amber-400">
                    <GeneratedText id="m_0a6d5e0e208c7e" />
                  </span>
                ) : null
              }
            />
          </div>
        </div>
        <GeneratedValue value={stateBadge} />
      </header>

      {/* Signed-step body — signer + signature thumbnail */}
      <GeneratedValue
        value={
          step.status === 'signed' ? (
            <div className="mt-3 space-y-2 text-sm">
              <div className="text-slate-700 dark:text-slate-300">
                <GeneratedText id="m_0664908f5b6c68" />{' '}
                <strong>
                  <GeneratedValue value={step.signedBy ?? '—'} />
                </strong>
                <GeneratedValue
                  value={
                    step.signedAt ? (
                      <>
                        {' '}
                        · <GeneratedValue value={new Date(step.signedAt).toLocaleString()} />
                      </>
                    ) : null
                  }
                />
              </div>
              <GeneratedValue
                value={
                  step.signatureUrl ? (
                    <div className="rounded border border-slate-200 bg-white p-1.5 dark:border-slate-700">
                      <RawImage
                        src={step.signatureUrl}
                        alt={tGenerated('m_015c2c2c5023d2', { value0: step.title })}
                        optimizationReason="authenticated"
                        className="max-h-24 w-auto"
                      />
                    </div>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  step.comment ? (
                    <div className="text-xs text-slate-500">
                      <GeneratedText id="m_02a80801f23cc0" />{' '}
                      <GeneratedValue value={step.comment} />
                    </div>
                  ) : null
                }
              />
            </div>
          ) : null
        }
      />

      {/* Rejected-step body — reason + when */}
      <GeneratedValue
        value={
          step.status === 'rejected' ? (
            <div className="mt-3 space-y-1 rounded-md border border-red-200 bg-white p-2 text-sm dark:border-red-900 dark:bg-slate-900">
              <div className="text-red-800 dark:text-red-300">
                <GeneratedText id="m_16d1378e47de23" />{' '}
                <strong>
                  <GeneratedValue value={step.rejectedBy ?? '—'} />
                </strong>
                <GeneratedValue
                  value={
                    step.rejectedAt ? (
                      <>
                        {' '}
                        · <GeneratedValue value={new Date(step.rejectedAt).toLocaleString()} />
                      </>
                    ) : null
                  }
                />
              </div>
              <div className="text-slate-700 dark:text-slate-300">
                <span className="text-xs tracking-wide text-slate-500 uppercase">
                  <GeneratedText id="m_183a955f0dc9a8" />
                </span>
                <GeneratedValue value={' '} />
                <GeneratedValue value={step.rejectionReason} />
              </div>
              <GeneratedValue
                value={
                  canAct ? (
                    <p className="mt-2 text-xs text-slate-500">
                      <GeneratedText id="m_18d0e71124fd04" />
                    </p>
                  ) : null
                }
              />
            </div>
          ) : null
        }
      />

      {/* Future / pending non-current: leave header-only */}
      <GeneratedValue
        value={
          isFuture ? (
            <p className="mt-2 text-xs text-slate-500 italic">
              <GeneratedText id="m_104d6ee18c4694" />
            </p>
          ) : null
        }
      />

      {/* Action affordances live only on the active step + when the actor can act */}
      <GeneratedValue
        value={
          canAct ? (
            <ActiveStepActions
              step={step}
              responseId={responseId}
              showResign={step.status === 'rejected'}
            />
          ) : null
        }
      />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
    setError(tGeneratedValue(null))
  }

  function doSign() {
    setError(tGeneratedValue(null))
    if (!signature) {
      setError(tGenerated('m_002521e2b63697'))
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
        setError(tGeneratedValue(r.error))
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
        setError(tGeneratedValue(adv.error))
        return
      }
      clearLocalState()
      setMode('idle')
    })
  }

  function doAdvanceWithoutSignature() {
    setError(tGeneratedValue(null))
    start(async () => {
      const r = await advanceWorkflowStep({
        responseId,
        currentStepKey: step.key,
      })
      if (!r.ok) {
        setError(tGeneratedValue(r.error))
        return
      }
      clearLocalState()
      setMode('idle')
    })
  }

  function doReject() {
    setError(tGeneratedValue(null))
    if (!reason.trim()) {
      setError(tGenerated('m_0830ced211ca83'))
      return
    }
    start(async () => {
      const r = await rejectWorkflowStep({
        responseId,
        currentStepKey: step.key,
        reason: reason.trim(),
      })
      if (!r.ok) {
        setError(tGeneratedValue(r.error))
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
          <GeneratedValue
            value={
              pending ? (
                <GeneratedText id="m_09001dc89c0edf" />
              ) : (
                <GeneratedText id="m_18948560179932" />
              )
            }
          />
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setMode('reject')}
          disabled={pending}
        >
          <GeneratedText id="m_143a0447de17cc" />
        </Button>
        <GeneratedValue
          value={
            mode === 'reject' ? (
              <div className="w-full space-y-2 rounded-md border border-red-200 bg-white p-2 dark:border-red-900 dark:bg-slate-900">
                <Textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={tGenerated('m_0b154bd2db12d1')}
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
                    <GeneratedText id="m_112e2e8ecda428" />
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={doReject}
                    disabled={pending || !reason.trim()}
                  >
                    <GeneratedValue
                      value={
                        pending ? (
                          <GeneratedText id="m_09001dc89c0edf" />
                        ) : (
                          <GeneratedText id="m_0f51548c04b27f" />
                        )
                      }
                    />
                  </Button>
                </div>
              </div>
            ) : null
          }
        />
        <GeneratedValue
          value={
            error ? (
              <div className="text-xs text-red-600">
                <GeneratedValue value={error} />
              </div>
            ) : null
          }
        />
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-3">
      <GeneratedValue
        value={
          showResign ? (
            <div className="text-xs tracking-wide text-slate-500 uppercase">
              <GeneratedText id="m_05823fa61e640f" />
            </div>
          ) : null
        }
      />
      {/* SIGN sub-form */}
      <GeneratedValue
        value={
          mode === 'sign' ? (
            <div className="space-y-2 rounded-md border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
              <SignaturePad value={signature} onChange={setSignature} />
              <Textarea
                rows={1}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={tGenerated('m_1942ee843b69ca')}
              />
              <div className="flex flex-wrap justify-end gap-2">
                <GeneratedValue
                  value={
                    !step.signatureRequired ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={doAdvanceWithoutSignature}
                        disabled={pending}
                      >
                        <GeneratedText id="m_18b288e3fea767" />
                      </Button>
                    ) : null
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMode('reject')}
                  disabled={pending}
                >
                  <GeneratedText id="m_143a0447de17cc" />
                </Button>
                <Button type="button" onClick={doSign} disabled={pending || !signature}>
                  <GeneratedValue
                    value={
                      pending ? (
                        <GeneratedText id="m_09001dc89c0edf" />
                      ) : (
                        <GeneratedText id="m_049b235e36c6e0" />
                      )
                    }
                  />
                </Button>
              </div>
            </div>
          ) : null
        }
      />

      {/* REJECT sub-form */}
      <GeneratedValue
        value={
          mode === 'reject' ? (
            <div className="space-y-2 rounded-md border border-red-200 bg-white p-2 dark:border-red-900 dark:bg-slate-900">
              <Textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={tGenerated('m_10bc9103b5579b')}
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
                  <GeneratedText id="m_11d2a6d0007e98" />
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={doReject}
                  disabled={pending || !reason.trim()}
                >
                  <GeneratedValue
                    value={
                      pending ? (
                        <GeneratedText id="m_09001dc89c0edf" />
                      ) : (
                        <GeneratedText id="m_143a0447de17cc" />
                      )
                    }
                  />
                </Button>
              </div>
            </div>
          ) : null
        }
      />

      <GeneratedValue
        value={
          error ? (
            <div className="text-xs text-red-600">
              <GeneratedValue value={error} />
            </div>
          ) : null
        }
      />
    </div>
  )
}
