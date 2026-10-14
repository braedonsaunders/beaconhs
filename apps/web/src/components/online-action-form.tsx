'use client'

// A Server Action form for steps that need a live connection: starting a new
// record (the record page is rendered by the server) and finishing one
// (Finalize / Lock run on the server). Offline, it explains instead of
// failing. With `syncResponseId`, it first pushes that record's queued field
// edits (see @/lib/offline-drafts) so the server finalizes the latest answers;
// if they cannot be delivered, the action does not run.

import { useTransition, type FormEvent, type ReactNode } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { GeneratedValue, useGeneratedTranslations } from '@/i18n/generated'
import { toast } from '@/lib/toast'
import { getDraftSyncEngine } from '@/lib/offline-drafts/engine'
import { draftRecordKey } from '@/lib/offline-drafts/model'
import { useOfflineDraftsContext } from '@/lib/offline-drafts/provider'

export function OnlineActionForm({
  action,
  purpose,
  syncResponseId,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<void>
  /** `start` creates a record; `finish` acts on an existing one. */
  purpose: 'start' | 'finish'
  /** Record whose device-queued edits must reach the server first. */
  syncResponseId?: string
  className?: string
  children: ReactNode
}) {
  const tGenerated = useGeneratedTranslations()
  const offlineDrafts = useOfflineDraftsContext()
  const [pending, startTransition] = useTransition()

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const offlineMessage = tGenerated(purpose === 'start' ? 'm_01fcca92411e7f' : 'm_1274068c9365ae')
    if (!navigator.onLine) {
      toast.error(offlineMessage)
      return
    }
    startTransition(async () => {
      if (syncResponseId && offlineDrafts) {
        const key = draftRecordKey(offlineDrafts.scopeKey, 'fields', syncResponseId)
        const synced = await getDraftSyncEngine().flush(key)
        if (!synced.ok) {
          toast.error(synced.offline ? offlineMessage : tGenerated('m_00029353d2a87d'))
          return
        }
      }
      try {
        await action(formData)
      } catch (error) {
        unstable_rethrow(error)
        toast.error(tGenerated('m_02c49eab1c46fd'))
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className={className}>
      <fieldset disabled={pending} className="contents">
        <GeneratedValue value={children} />
      </fieldset>
    </form>
  )
}
