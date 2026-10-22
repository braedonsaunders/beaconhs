'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// Record actions for an incident. The status workflow lives
// HERE in the header (not a stray card at the bottom of the page): a select
// that auto-saves on change; record commands share one Actions menu.

import Link from 'next/link'
import { useTransition } from 'react'
import { RecordActionMenu } from '@/components/record-action-menu'
import { DownloadLink } from '@/components/download-link'
import { OnlineActionForm } from '@/components/online-action-form'
import { Button, Select } from '@beaconhs/ui'
import { useOnlineAction } from '@/lib/offline-drafts/use-online-action'
import { Copy, FileText, Lock, Mail, Trash2, Unlock } from 'lucide-react'

export function IncidentHeaderActions({
  id,
  status,
  statuses,
  locked,
  canManage,
  pdfHref,
  emailHref,
  copyHref,
  deleteHref,
  updateStatusAction,
  toggleLockAction,
}: {
  id: string
  status: string
  statuses: readonly string[]
  locked: boolean
  canManage: boolean
  pdfHref: string
  emailHref: string
  copyHref: string
  deleteHref: string
  updateStatusAction: (formData: FormData) => Promise<void>
  toggleLockAction: (formData: FormData) => Promise<void>
}) {
  const tGenerated = useGeneratedTranslations()
  const [pending, start] = useTransition()
  const runOnline = useOnlineAction()

  // A status change runs flows (and closing locks): it needs signal and the
  // latest field edits.
  function onStatusChange(next: string) {
    if (next === status) return
    const fd = new FormData()
    fd.set('id', id)
    fd.set('status', next)
    start(async () => {
      await runOnline('finish', () => updateStatusAction(fd))
    })
  }

  const statusSelect = (
    <Select
      aria-label={tGenerated('m_15e6f0c4903078')}
      value={status}
      disabled={pending}
      onChange={(e) => onStatusChange(e.target.value)}
      className="w-auto min-w-36 capitalize"
    >
      {statuses.map((s) => (
        <option key={s} value={s} className="capitalize">
          {s.replace(/_/g, ' ')}
        </option>
      ))}
    </Select>
  )

  const lockFields = (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="lock" value={locked ? 'false' : 'true'} />
      <Button variant="outline" type="submit">
        <GeneratedValue
          value={
            locked ? (
              <>
                <Unlock size={14} /> <GeneratedText id="m_0ca830c9381fd6" />
              </>
            ) : (
              <>
                <Lock size={14} /> <GeneratedText id="m_19f2c846c5777a" />
              </>
            )
          }
        />
      </Button>
    </>
  )
  // Locking pushes the queued field edits first. Unlocking does not wait for
  // them: it is what makes edits left on a locked record deliverable again
  // (the offline submit guard still covers it).
  const lockForm = locked ? (
    <form action={toggleLockAction}>
      <GeneratedValue value={lockFields} />
    </form>
  ) : (
    <OnlineActionForm action={toggleLockAction} purpose="finish">
      <GeneratedValue value={lockFields} />
    </OnlineActionForm>
  )

  return (
    <div className="flex flex-wrap items-center gap-2">
      {statusSelect}
      <RecordActionMenu
        destructive={
          canManage ? (
            <Link href={deleteHref as never} scroll={false}>
              <Trash2 size={15} /> <GeneratedText id="m_11773f3c3f7558" />
            </Link>
          ) : null
        }
      >
        <DownloadLink href={pdfHref as never}>
          <FileText size={15} />
          <GeneratedText id="m_016088be0b1e51" />
        </DownloadLink>
        <Link href={emailHref as never} scroll={false}>
          <Mail size={15} />
          <GeneratedText id="m_09dfca28fc95ba" />
        </Link>
        <Link href={copyHref as never} scroll={false}>
          <Copy size={15} />
          <GeneratedText id="m_17e5ebd91b9a4f" />
        </Link>
        {lockForm}
      </RecordActionMenu>
    </div>
  )
}
