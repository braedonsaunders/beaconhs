'use client'

// Body widget for the per-attendee "Sign here" drawer. Captures a signature
// PNG and saves it via the parent's `saveAction`. The drawer footer's
// Submit button targets us via `form={formId}` so we expose a stable id.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SignaturePad } from '@/components/signature-pad'

export function SignAttendeeBody({
  attendeeId,
  formId,
  closeHref,
  saveAction,
}: {
  attendeeId: string
  formId: string
  closeHref: string
  saveAction: (attendeeId: string, dataUrl: string | null) => Promise<void>
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    if (!draft) {
      setError('Sign in the box before saving.')
      return
    }
    start(async () => {
      await saveAction(attendeeId, draft)
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
      <p className="text-xs text-slate-500">
        Sign in the box below. Tap the eraser icon to clear and try again.
      </p>
      <SignaturePad value={draft} onChange={setDraft} height={180} />
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <p className="text-xs text-slate-500">
        {pending ? 'Saving…' : 'Submit from the drawer footer when ready.'}
      </p>
    </form>
  )
}
