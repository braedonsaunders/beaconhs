'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle, Button, Label, Textarea } from '@beaconhs/ui'
import { SignaturePad } from '@/components/signature-pad'
import { verifyCorrectiveAction } from '../_actions'

/**
 * Verification tab body. Read-only display of an already-verified CA, plus a
 * "Sign verification" trigger that opens the verify drawer when work is still
 * outstanding. The body widget used inside the drawer is `VerifyBody` below.
 */
export function VerificationPanel({
  caId,
  verifiedAt,
  verifierName,
  verificationNotes,
  locked,
}: {
  caId: string
  verifiedAt: Date | null
  verifierName: string | null
  verificationNotes: string | null
  locked: boolean
}) {
  if (verifiedAt) {
    return (
      <div className="space-y-4">
        <Alert>
          <ShieldCheck size={16} />
          <AlertTitle>
            <GeneratedText id="m_19f7a6e43934a3" />
          </AlertTitle>
          <AlertDescription>
            <GeneratedText id="m_0dd0dc5cb22cfb" />{' '}
            <strong>
              <GeneratedValue value={verifierName ?? <GeneratedText id="m_0a05e691579a3a" />} />
            </strong>{' '}
            <GeneratedText id="m_17414f59d8f567" />
            <GeneratedValue value={' '} />
            <GeneratedValue value={verifiedAt.toLocaleString()} />.
          </AlertDescription>
        </Alert>
        <GeneratedValue
          value={
            verificationNotes ? (
              <div>
                <div className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  <GeneratedText id="m_0f48a88e8e4e93" />
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                  <GeneratedValue value={verificationNotes} />
                </p>
              </div>
            ) : null
          }
        />
      </div>
    )
  }

  if (locked) {
    return (
      <Alert variant="warning">
        <AlertTitle>
          <GeneratedText id="m_0e259fa0babc2d" />
        </AlertTitle>
        <AlertDescription>
          <GeneratedText id="m_044bc752441759" />
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <Alert variant="info">
        <ShieldCheck size={16} />
        <AlertTitle>
          <GeneratedText id="m_07a541edc3e0c7" />
        </AlertTitle>
        <AlertDescription>
          <GeneratedText id="m_051852821f63ea" />
        </AlertDescription>
      </Alert>
      <Link href={`/corrective-actions/${caId}?drawer=verify`} scroll={false}>
        <Button>
          <CheckCircle2 size={14} /> <GeneratedText id="m_0fd315c49f4689" />
        </Button>
      </Link>
    </div>
  )
}

/**
 * Body of the "Verify" drawer. Captures verifier notes + optional signature.
 * The parent drawer footer's Submit button calls the internal submit via the
 * `formId` linkage.
 */
export function VerifyBody({
  caId,
  initialNotes,
  formId,
  closeHref,
}: {
  caId: string
  initialNotes: string | null
  formId: string
  closeHref: string
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [sig, setSig] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(tGeneratedValue(null))
    if (!notes.trim()) {
      setError(tGenerated('m_0c43378ce3980c'))
      return
    }
    start(async () => {
      const res = await verifyCorrectiveAction({
        caId,
        notes,
        signatureDataUrl: sig,
      })
      if (!res.ok) {
        setError(tGeneratedValue(res.error))
        return
      }
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
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_0f48a88e8e4e93" />
        </Label>
        <Textarea
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={tGenerated('m_04792ae8111054')}
          disabled={pending}
        />
      </div>
      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_13cdbd4c691489" />
        </Label>
        <SignaturePad value={sig} onChange={setSig} />
      </div>
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
              <GeneratedText id="m_1c141207042ff5" />
            ) : (
              <GeneratedText id="m_1691735480e09f" />
            )
          }
        />
      </p>
    </form>
  )
}
