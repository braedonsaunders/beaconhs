'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@beaconhs/ui'
import { deleteObligation, setObligationEnabled } from '../_actions'

export function ObligationDetailActions({ id, enabled }: { id: string; enabled: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await setObligationEnabled(id, !enabled)
            router.refresh()
          })
        }
      >
        {enabled ? 'Disable' : 'Enable'}
      </Button>
      <Button
        variant="destructive"
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (!window.confirm('Delete this obligation? This cannot be undone.')) return
            const res = await deleteObligation(id)
            if (res.ok) router.push('/compliance/obligations')
          })
        }
      >
        Delete
      </Button>
    </div>
  )
}
