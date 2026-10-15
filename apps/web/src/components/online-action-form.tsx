'use client'

// A Server Action form for steps that need a live connection: starting a new
// record (the record page is rendered by the server) and finishing one
// (Finalize / Lock / Submit run on the server and its flows). Offline, it
// explains instead of failing. Before a `finish` action runs it pushes every
// mounted record's queued edits (see @/lib/offline-drafts) so the server acts
// on the latest answers; if they cannot be delivered, the action does not run.

import { useTransition, type FormEvent, type ReactNode } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { GeneratedValue } from '@/i18n/generated'
import { useOnlineAction } from '@/lib/offline-drafts/use-online-action'

export function OnlineActionForm({
  action,
  purpose,
  id,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<void>
  /** `start` creates a record; `finish` acts on an existing one. */
  purpose: 'start' | 'finish'
  /** For a submit button outside the form (`<Button form={id}>`, e.g. a drawer footer). */
  id?: string
  className?: string
  children: ReactNode
}) {
  const runOnline = useOnlineAction()
  const [pending, startTransition] = useTransition()

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Keep the pressed button's name/value (e.g. Approve vs Reject).
    const formData = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter)
    startTransition(async () => {
      await runOnline(purpose, async () => {
        try {
          await action(formData)
        } catch (error) {
          unstable_rethrow(error)
          throw error
        }
      })
    })
  }

  return (
    // It explains the offline case itself (see the provider's submit guard).
    <form id={id} onSubmit={onSubmit} className={className} data-offline-ok="">
      <fieldset disabled={pending} className="contents">
        <GeneratedValue value={children} />
      </fieldset>
    </form>
  )
}
