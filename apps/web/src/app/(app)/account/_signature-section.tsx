'use client'

// Self-service signature capture for the account page. The user draws their
// signature on the shared SignaturePad and saves it to their linked person
// record; every form sign-off / inspection / lift plan / PDF renders it from
// there. Replaces the admin-only image-upload that used to live on the person
// detail page.

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Button, SignaturePad } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { clearMySignature, saveMySignature } from './actions'

export function SignatureSection({
  currentUrl,
  linked,
}: {
  currentUrl: string | null
  /** False when the login is not linked to a person record — nothing to sign for. */
  linked: boolean
}) {
  const [value, setValue] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!linked) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Your login is not linked to a person record yet, so there is nowhere to store a signature.
        Ask an administrator to link your account under Admin → Users.
      </p>
    )
  }

  function save() {
    if (!value) {
      toast.error('Draw your signature first.')
      return
    }
    startTransition(async () => {
      const res = await saveMySignature(value)
      if (res.ok) {
        toast.success('Signature saved')
        setValue(null)
      } else {
        toast.error(res.error ?? 'Could not save signature')
      }
    })
  }

  function clear() {
    startTransition(async () => {
      const res = await clearMySignature()
      if (res.ok) {
        toast.success('Signature cleared')
        setValue(null)
      } else {
        toast.error(res.error ?? 'Could not clear signature')
      }
    })
  }

  return (
    <div className="space-y-4">
      {currentUrl ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
            Current signature
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentUrl}
            alt="Your saved signature"
            className="max-h-20 w-full max-w-xs rounded border border-slate-200 bg-white object-contain p-1 dark:border-slate-700"
          />
        </div>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">No signature on file yet.</p>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
          {currentUrl ? 'Draw a new signature' : 'Draw your signature'}
        </p>
        <SignaturePad value={value} onChange={setValue} ariaLabel="Draw your signature" />
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" onClick={save} disabled={pending || !value}>
          {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          Save signature
        </Button>
        {currentUrl ? (
          <Button
            type="button"
            variant="ghost"
            onClick={clear}
            disabled={pending}
            className="text-red-600 hover:text-red-700"
          >
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  )
}
