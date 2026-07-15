'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, FilePen, Signature } from 'lucide-react'
import { Label, Textarea } from '@beaconhs/ui'
import { SignaturePad } from '@/components/signature-pad'
import { RawImage } from '@/components/raw-image'
import { appendCompleteStep } from '../_actions'

export type CompleteStep = {
  id: string
  kind: 'action_taken' | 'verification' | 'signature'
  description: string | null
  completedAt: Date
  completedByName: string | null
  signatureDataUrl: string | null
  entityOrder: number
}

const KIND_META: Record<
  CompleteStep['kind'],
  { icon: typeof FilePen; label: string; tone: string }
> = {
  action_taken: { icon: FilePen, label: 'Action taken', tone: 'bg-teal-100 text-teal-700' },
  verification: {
    icon: CheckCircle2,
    label: 'Verification',
    tone: 'bg-emerald-100 text-emerald-700',
  },
  signature: { icon: Signature, label: 'Signature', tone: 'bg-amber-100 text-amber-700' },
}

/**
 * Read-only timeline of complete-action steps. Used inline on the Work tab.
 * The mutation (add step) lives in the AddStepBody component, mounted inside
 * a drawer triggered from a "+ Add step" link.
 */
export function CompleteStepsTimeline({ steps }: { steps: CompleteStep[] }) {
  const tGenerated = useGeneratedTranslations()
  return (
    <div>
      <div className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
        <GeneratedText id="m_0d2b6a8a21df75" />
      </div>
      <GeneratedValue
        value={
          steps.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              <GeneratedText id="m_0dd8c84571baa3" />
            </p>
          ) : (
            <ol className="mt-2 space-y-2">
              <GeneratedValue
                value={steps.map((s) => {
                  const meta = KIND_META[s.kind]
                  const Icon = meta.icon
                  return (
                    <li
                      key={s.id}
                      className="rounded-md border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <span
                            className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${meta.tone}`}
                          >
                            <Icon size={11} />
                          </span>
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            <GeneratedValue value={meta.label} />
                          </span>
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          <GeneratedValue value={s.completedAt.toLocaleString()} />
                        </span>
                      </div>
                      <GeneratedValue
                        value={
                          s.completedByName ? (
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              <GeneratedText id="m_19ec032b95249e" />{' '}
                              <GeneratedValue value={s.completedByName} />
                            </div>
                          ) : null
                        }
                      />
                      <GeneratedValue
                        value={
                          s.description ? (
                            <p className="mt-2 whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                              <GeneratedValue value={s.description} />
                            </p>
                          ) : null
                        }
                      />
                      <GeneratedValue
                        value={
                          s.signatureDataUrl ? (
                            <RawImage
                              src={s.signatureDataUrl}
                              alt={tGenerated('m_0c0bc02db58371')}
                              optimizationReason="generated"
                              className="mt-2 h-20 rounded border border-slate-200 bg-white object-contain dark:border-slate-700"
                            />
                          ) : null
                        }
                      />
                    </li>
                  )
                })}
              />
            </ol>
          )
        }
      />
    </div>
  )
}

/**
 * Body of the "Add step" drawer. Renders only the form (no header / footer);
 * the parent drawer's footer Submit button targets us via `form={formId}`.
 * After a successful submit we close the drawer by navigating to `closeHref`.
 */
export function AddStepBody({
  caId,
  formId,
  closeHref,
}: {
  caId: string
  formId: string
  closeHref: string
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [kind, setKind] = useState<CompleteStep['kind']>('action_taken')
  const [description, setDescription] = useState('')
  const [sig, setSig] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(tGeneratedValue(null))
    if (kind === 'signature' && !sig) {
      setError(tGenerated('m_1b76abb47cf690'))
      return
    }
    if (kind !== 'signature' && !description.trim()) {
      setError(tGenerated('m_1d62d51c6b2ca0'))
      return
    }
    start(async () => {
      const res = await appendCompleteStep({
        caId,
        kind,
        description: kind === 'signature' ? null : description,
        signatureDataUrl: kind === 'signature' ? sig : null,
      })
      if (!res.ok) {
        setError(tGeneratedValue(res.error))
        return
      }
      setDescription('')
      setSig(null)
      setKind('action_taken')
      router.push(closeHref as any)
      router.refresh()
    })
  }

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-3"
    >
      <div className="flex flex-wrap gap-1.5 text-xs">
        <GeneratedValue
          value={(Object.keys(KIND_META) as CompleteStep['kind'][]).map((k) => {
            const meta = KIND_META[k]
            const Icon = meta.icon
            const active = kind === k
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                disabled={pending}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors ${
                  active
                    ? 'border-teal-700 bg-teal-700 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icon size={11} />
                <GeneratedValue value={meta.label} />
              </button>
            )
          })}
        />
      </div>
      <GeneratedValue
        value={
          kind !== 'signature' ? (
            <div className="space-y-1.5">
              <Label>
                <GeneratedText id="m_14d923495cf14c" />
              </Label>
              <Textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={tGeneratedValue(
                  kind === 'verification'
                    ? tGenerated('m_0511efc3e6e2d4')
                    : tGenerated('m_1f669b08e41af3'),
                )}
                disabled={pending}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>
                <GeneratedText id="m_0c0bc02db58371" />
              </Label>
              <SignaturePad value={sig} onChange={setSig} />
            </div>
          )
        }
      />
      <GeneratedValue
        value={
          error ? (
            <p className="text-xs text-red-600">
              <GeneratedValue value={error} />
            </p>
          ) : null
        }
      />
      <p className="text-xs text-slate-500">
        <GeneratedValue
          value={
            pending ? (
              <GeneratedText id="m_106811f2aac664" />
            ) : (
              <GeneratedText id="m_1cb9fcbb972395" />
            )
          }
        />
      </p>
    </form>
  )
}
