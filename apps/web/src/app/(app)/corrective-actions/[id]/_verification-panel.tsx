'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ShieldCheck } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Label,
  Textarea,
} from '@beaconhs/ui'
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
          <AlertTitle>Verified</AlertTitle>
          <AlertDescription>
            Signed off by <strong>{verifierName ?? 'unknown'}</strong> on{' '}
            {verifiedAt.toLocaleString()}.
          </AlertDescription>
        </Alert>
        {verificationNotes ? (
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Verification notes
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
              {verificationNotes}
            </p>
          </div>
        ) : null}
      </div>
    )
  }

  if (locked) {
    return (
      <Alert variant="warning">
        <AlertTitle>Locked</AlertTitle>
        <AlertDescription>
          This action is locked. Unlock or reopen it to sign off.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <Alert variant="info">
        <ShieldCheck size={16} />
        <AlertTitle>Verification required</AlertTitle>
        <AlertDescription>
          Confirm the corrective action is complete and effective. Your name and
          timestamp will be stamped on the record once you sign.
        </AlertDescription>
      </Alert>
      <Link href={`/corrective-actions/${caId}?tab=verification&drawer=verify`}>
        <Button>
          <CheckCircle2 size={14} /> Sign verification
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
  const router = useRouter()
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [sig, setSig] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    if (!notes.trim()) {
      setError('Add a verification note before signing.')
      return
    }
    start(async () => {
      const res = await verifyCorrectiveAction({
        caId,
        notes,
        signatureDataUrl: sig,
      })
      if (!res.ok) {
        setError(res.error)
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
        <Label>Verification notes</Label>
        <Textarea
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What did you check? Was the corrective action effective?"
          disabled={pending}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Signature (optional)</Label>
        <SignaturePad value={sig} onChange={setSig} />
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <p className="text-xs text-slate-500">
        {pending ? 'Signing…' : 'Submit from the drawer footer when ready.'}
      </p>
    </form>
  )
}
