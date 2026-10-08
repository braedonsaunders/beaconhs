'use client'

import Link from 'next/link'
import { useState, useTransition, type ReactNode } from 'react'
import { unstable_rethrow, useRouter } from 'next/navigation'
import { Button } from '@beaconhs/ui'
import { SignaturePad } from '@/components/signature-pad'
import { GeneratedValue } from '@/i18n/generated'
import { setActiveTenant } from '@/lib/actions'
import { unwrapSigningResult } from '@/lib/hazid-signing-result'
import { signOwnAssessment } from './_signing-actions'

export function SignatureRequest({
  signatureId,
  revision,
  name,
  review,
}: {
  signatureId: string
  revision: number
  name: string
  review: ReactNode
}) {
  const [ink, setInk] = useState<string | null>(null)
  const [reviewed, setReviewed] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  if (saved)
    return (
      <p role="status">
        <GeneratedValue value="Your signature is saved" />
      </p>
    )
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{name}</h2>
      {review}
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0"
          checked={reviewed}
          disabled={pending}
          onChange={(e) => setReviewed(e.target.checked)}
        />
        <span>
          <GeneratedValue value="I have reviewed this assessment, understand the hazards and controls, and am signing my own name." />
        </span>
      </label>
      <SignaturePad value={ink} onChange={setInk} disabled={pending} />
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          <GeneratedValue value={error} />
        </p>
      ) : null}
      <Button
        className="h-11 w-full"
        disabled={pending || !reviewed || !ink}
        onClick={() => {
          if (!ink || !reviewed) return
          setError(null)
          start(async () => {
            try {
              unwrapSigningResult(await signOwnAssessment(signatureId, revision, ink, true))
              setSaved(true)
            } catch (err) {
              unstable_rethrow(err)
              setError(
                err instanceof Error ? err.message : 'Could not save your signature. Try again.',
              )
            }
          })
        }}
      >
        <GeneratedValue value={pending ? 'Saving…' : 'Sign'} />
      </Button>
      <Link href="/notifications">
        <GeneratedValue value="Back to notifications" />
      </Link>
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
