'use client'

import Link from 'next/link'
import { unwrapSigningResult } from '@/lib/hazid-signing-result'
import { useState, useTransition, type ReactNode } from 'react'
import { Button, Label, SearchSelect } from '@beaconhs/ui'
import { SignaturePad } from '@/components/signature-pad'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { setActiveTenant } from '@/lib/actions'
import { unstable_rethrow, useRouter } from 'next/navigation'
import { signCrewMember, signOwnAssessment } from './_signing-actions'

export function SigningPad({
  assessmentId,
  revision,
  signers: initial,
  review,
  own = false,
}: {
  assessmentId: string
  revision: number
  signers: { id: string; name: string }[]
  review: ReactNode
  own?: boolean
}) {
  const t = useGeneratedValueTranslations()
  const [remaining, setRemaining] = useState(initial)
  const [selected, setSelected] = useState(initial[0]?.id ?? '')
  const [signed, setSigned] = useState(0)
  const [ink, setInk] = useState<string | null>(null)
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const current = remaining.find((row) => row.id === selected) ?? remaining[0]
  const back = own ? '/notifications' : `/hazard-assessments/${assessmentId}#section-signatures`
  function save() {
    if (!current || !ink || !reviewed) return
    setError(null)
    start(async () => {
      try {
        unwrapSigningResult(
          await (own ? signOwnAssessment : signCrewMember)(current.id, revision, ink, reviewed),
        )
        const next = remaining.filter((row) => row.id !== current.id)
        setRemaining(next)
        setSelected(next[0]?.id ?? '')
        setSigned((s) => s + 1)
        setInk(null)
        setReviewed(false)
      } catch (err) {
        unstable_rethrow(err)
        setError(err instanceof Error ? err.message : 'Could not save your signature. Try again.')
      }
    })
  }
  if (!current)
    return (
      <div
        role="status"
        className="space-y-4 rounded-lg border border-teal-300 bg-teal-50 p-5 dark:bg-teal-950"
      >
        <h2 className="text-xl font-semibold">
          <GeneratedValue value={own ? 'Your signature is saved' : 'Crew signatures saved'} />
        </h2>
        <p>
          <GeneratedValue value="Each signature is saved immediately. You can safely leave this page." />
        </p>
        <Link
          href={back as any}
          onClick={(event) => {
            if (
              pending ||
              (ink &&
                !window.confirm(
                  t('Leave without saving this signature? Already saved signatures are safe.'),
                ))
            )
              event.preventDefault()
          }}
        >
          <Button>
            <GeneratedValue value={own ? 'Back to notifications' : 'Return to assessment'} />
          </Button>
        </Link>
      </div>
    )
  return (
    <div className="space-y-5">
      <div className="sticky top-0 z-10 space-y-2 rounded-lg border bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <p className="text-xs text-slate-500">
          <GeneratedValue value="Revision" /> {revision} · {signed} <GeneratedValue value="saved" />{' '}
          · {remaining.length} <GeneratedValue value="awaiting signature" />
        </p>
        <h2 className="text-xl font-semibold">{current.name}</h2>
        {!own && remaining.length > 1 ? (
          <SearchSelect
            value={current.id}
            onChange={(value) => {
              if (ink && !window.confirm(t('Discard the unsaved signature to switch people?')))
                return
              setSelected(value)
              setInk(null)
              setReviewed(false)
              setError(null)
            }}
            options={remaining.map((row) => ({ value: row.id, label: row.name }))}
            disabled={pending}
            aria-label={t('Choose next signer')}
          />
        ) : null}
      </div>
      <details open className="rounded-lg border p-3 dark:border-slate-700">
        <summary className="cursor-pointer font-semibold">
          <GeneratedValue value="Review job hazards and controls" />
        </summary>
        <div className="pt-4">{review}</div>
      </details>
      <div
        className="space-y-4 rounded-lg border bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
        key={current.id}
      >
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
            disabled={pending}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>
            <GeneratedValue value="I have reviewed this assessment, understand the hazards and controls, and am signing my own name." />
          </span>
        </label>
        <Label>
          <GeneratedValue value="Signature" />
        </Label>
        <div className={pending ? 'pointer-events-none opacity-60' : undefined} aria-busy={pending}>
          <SignaturePad value={ink} onChange={setInk} />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            <GeneratedValue value={error} />
          </p>
        ) : null}
        <div className="sticky bottom-0 flex flex-wrap justify-between gap-2 bg-white py-3 dark:bg-slate-900">
          <Link
            href={back as any}
            onClick={(event) => {
              if (
                pending ||
                (ink &&
                  !window.confirm(
                    t('Leave without saving this signature? Already saved signatures are safe.'),
                  ))
              )
                event.preventDefault()
            }}
          >
            <Button variant="outline" disabled={pending} className="h-11 px-4">
              <GeneratedValue value="Done for now" />
            </Button>
          </Link>
          <Button onClick={save} disabled={pending || !ink || !reviewed} className="h-11 px-4">
            <GeneratedValue
              value={
                pending
                  ? 'Saving signature…'
                  : own || remaining.length === 1
                    ? 'Save signature'
                    : 'Save & next'
              }
            />
          </Button>
        </div>
      </div>
    </div>
  )
}

export function SigningWorkspaceSwitch({ tenantId }: { tenantId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition(),
    [error, setError] = useState<string | null>(null)
  return (
    <div className="space-y-3">
      <p>
        <GeneratedValue value="This request belongs to another workspace. Switch to review and sign it." />
      </p>
      {error ? (
        <p role="alert">
          <GeneratedValue value={error} />
        </p>
      ) : null}
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await setActiveTenant(tenantId)
            if (result.ok) router.refresh()
            else setError(result.error ?? 'Could not switch workspace')
          })
        }
      >
        <GeneratedValue value={pending ? 'Switching…' : 'Open signing workspace'} />
      </Button>
    </div>
  )
}
