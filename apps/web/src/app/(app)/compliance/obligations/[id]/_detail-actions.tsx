'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@beaconhs/ui'
import { confirmDialog } from '@/lib/confirm'
import { deleteObligation, setObligationEnabled } from '../_actions'

export function ObligationDetailActions({
  id,
  enabled,
  canManage,
  canEdit,
  editHref,
}: {
  id: string
  enabled: boolean
  canManage: boolean
  // The unified form can only author the KIND_META kinds; ETL-only source
  // modules are manageable (pause/delete) but not editable through the flyout.
  canEdit: boolean
  editHref: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  if (!canManage) return null

  return (
    <div className="flex gap-2">
      {canEdit ? (
        <Link href={editHref as never} scroll={false}>
          <Button variant="outline" disabled={pending}>
            Edit
          </Button>
        </Link>
      ) : null}
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              const result = await setObligationEnabled(id, !enabled)
              if (!result.ok) {
                toast.error(result.error)
                return
              }
              router.refresh()
            } catch {
              toast.error(`Could not ${enabled ? 'disable' : 'enable'} the obligation`)
            }
          })
        }
      >
        {enabled ? 'Disable' : 'Enable'}
      </Button>
      <Button
        variant="destructive"
        disabled={pending}
        onClick={async () => {
          if (
            !(await confirmDialog({
              message: 'Delete this obligation? This cannot be undone.',
              tone: 'danger',
            }))
          )
            return
          start(async () => {
            try {
              const result = await deleteObligation(id)
              if (!result.ok) {
                toast.error(result.error)
                return
              }
              router.push('/compliance/obligations')
            } catch {
              toast.error('Could not delete the obligation')
            }
          })
        }}
      >
        Delete
      </Button>
    </div>
  )
}
