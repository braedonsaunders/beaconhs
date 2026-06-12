'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@beaconhs/ui'
import { deleteObligation, setObligationEnabled } from '../_actions'

export function ObligationDetailActions({
  id,
  enabled,
  canManage,
}: {
  id: string
  enabled: boolean
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  if (!canManage) return null

  return (
    <div className="flex gap-2">
      <Link href={`/compliance/obligations/${id}/edit`}>
        <Button variant="outline" disabled={pending}>
          Edit
        </Button>
      </Link>
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
