'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@beaconhs/ui'
import { PublishControl, type PublishRoleOption } from '../../_publish-control.client'
import { deleteCard, publishCard, unpublishCard } from '../_actions'

export function CardToolbar({
  id,
  status,
  canPublish,
  roles,
  allowedRoles,
}: {
  id: string
  status: 'draft' | 'published'
  canPublish: boolean
  roles: PublishRoleOption[]
  allowedRoles: string[] | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [published, setPublished] = useState(status === 'published')

  function publish(nextAllowedRoles: string[] | null) {
    start(async () => {
      const r = await publishCard({ id, allowedRoles: nextAllowedRoles })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setPublished(true)
      toast.success('Published to library')
      router.refresh()
    })
  }

  function unpublish() {
    start(async () => {
      const r = await unpublishCard(id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setPublished(false)
      toast.success('Unpublished')
      router.refresh()
    })
  }

  function remove() {
    if (!window.confirm('Delete this card? It will be removed from any dashboards.')) return
    start(async () => {
      const r = await deleteCard(id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Card deleted')
      router.push('/insights/library')
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-2">
      {canPublish ? (
        <PublishControl
          status={published ? 'published' : 'draft'}
          roles={roles}
          initialAllowedRoles={allowedRoles}
          pending={pending}
          onPublish={publish}
          onUnpublish={unpublish}
        />
      ) : null}
      <Button
        type="button"
        variant="ghost"
        onClick={remove}
        disabled={pending}
        className="h-9 text-xs text-rose-600 hover:bg-rose-50"
      >
        <Trash2 size={13} />
      </Button>
    </div>
  )
}
