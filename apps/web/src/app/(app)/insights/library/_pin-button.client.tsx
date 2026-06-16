'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pin, PinOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@beaconhs/ui'
import { pinDashboard, unpinDashboard } from '../_actions'

export function PinButton({
  dashboardId,
  pinned: initial,
}: {
  dashboardId: string
  pinned: boolean
}) {
  const router = useRouter()
  const [pinned, setPinned] = useState(initial)
  const [pending, start] = useTransition()

  function toggle() {
    start(async () => {
      const r = pinned ? await unpinDashboard(dashboardId) : await pinDashboard(dashboardId)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setPinned(!pinned)
      toast.success(pinned ? 'Unpinned' : 'Pinned to your Insights')
      router.refresh()
    })
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={toggle}
      disabled={pending}
      className="h-8 text-xs"
    >
      {pending ? (
        <Loader2 size={13} className="mr-1 animate-spin" />
      ) : pinned ? (
        <PinOff size={13} className="mr-1" />
      ) : (
        <Pin size={13} className="mr-1" />
      )}
      {pinned ? 'Pinned' : 'Pin'}
    </Button>
  )
}
