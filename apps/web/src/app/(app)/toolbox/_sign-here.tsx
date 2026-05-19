'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, X } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { SignaturePad } from '@/components/signature-pad'

/**
 * Inline "Sign here" panel for a single attendee. Calls the given server
 * action with the captured PNG data URL and triggers a refresh.
 */
export function SignHere({
  attendeeId,
  alreadySigned,
  saveAction,
}: {
  attendeeId: string
  alreadySigned: boolean
  saveAction: (attendeeId: string, dataUrl: string | null) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Pencil size={12} />
        {alreadySigned ? 'Re-sign' : 'Sign'}
      </Button>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-700">Sign in the box below</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false)
            setDraft(null)
          }}
        >
          <X size={12} />
        </Button>
      </div>
      <SignaturePad value={draft} onChange={setDraft} height={120} />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!draft || pending}
          onClick={() => {
            if (!draft) return
            start(async () => {
              await saveAction(attendeeId, draft)
              setOpen(false)
              setDraft(null)
              router.refresh()
            })
          }}
        >
          {pending ? 'Saving…' : 'Save signature'}
        </Button>
      </div>
    </div>
  )
}
