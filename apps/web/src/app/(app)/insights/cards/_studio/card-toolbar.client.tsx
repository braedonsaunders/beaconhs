'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Globe, Loader2, Lock, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@beaconhs/ui'
import { deleteCard, publishCard, unpublishCard } from '../_actions'

export function CardToolbar({
  id,
  status,
  canPublish,
}: {
  id: string
  status: 'draft' | 'published'
  canPublish: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [published, setPublished] = useState(status === 'published')

  function togglePublish() {
    start(async () => {
      const r = published ? await unpublishCard(id) : await publishCard({ id })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setPublished(!published)
      toast.success(published ? 'Unpublished' : 'Published to library')
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
        <Button
          type="button"
          variant="outline"
          onClick={togglePublish}
          disabled={pending}
          className="h-9 text-xs"
        >
          {pending ? (
            <Loader2 size={13} className="mr-1 animate-spin" />
          ) : published ? (
            <Lock size={13} className="mr-1" />
          ) : (
            <Globe size={13} className="mr-1" />
          )}
          {published ? 'Unpublish' : 'Publish'}
        </Button>
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
