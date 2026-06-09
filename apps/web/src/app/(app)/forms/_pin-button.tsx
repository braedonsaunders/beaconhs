'use client'

import { useState, useTransition } from 'react'
import { Pin, PinOff } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { pinFormToSidebar, unpinFormFromSidebar } from '@/app/(app)/admin/navigation/_actions'

// Pin / Unpin toggle for a form template. Only rendered for users with
// admin.nav.manage (the gallery decides). Reflects + flips the tenant-wide
// sidebar pin.
export function PinFormButton({ templateId, pinned }: { templateId: string; pinned: boolean }) {
  const [isPinned, setIsPinned] = useState(pinned)
  const [pending, start] = useTransition()
  return (
    <Button
      variant={isPinned ? 'secondary' : 'outline'}
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = isPinned
            ? await unpinFormFromSidebar(templateId)
            : await pinFormToSidebar(templateId)
          if (!res.ok) {
            toast.error(res.error ?? 'Could not update sidebar')
            return
          }
          const nowPinned = !isPinned
          setIsPinned(nowPinned)
          toast.success(nowPinned ? 'Pinned to sidebar' : 'Unpinned')
        })
      }
    >
      {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
      {isPinned ? 'Unpin' : 'Pin'}
    </Button>
  )
}
