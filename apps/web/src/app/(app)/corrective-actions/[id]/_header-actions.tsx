'use client'

import { GeneratedText, useGeneratedTranslations } from '@/i18n/generated'

// Detail-header actions for a corrective action, responsive. The status
// workflow lives HERE in the header (not a stray "Status" tab): a select that
// auto-saves non-terminal transitions on change. Closing is a distinct action
// (cost-impact prompt + lock) and reopening replaces it once locked. The
// record commands share one Actions menu on every screen size.

import Link from 'next/link'
import { useTransition } from 'react'
import { RecordActionMenu } from '@/components/record-action-menu'
import { DownloadLink } from '@/components/download-link'
import { Button, Select } from '@beaconhs/ui'
import { useOnlineAction } from '@/lib/offline-drafts/use-online-action'
import { CheckCircle2, FileText, Mail, Unlock } from 'lucide-react'

export function CaHeaderActions({
  id,
  status,
  statuses,
  locked,
  canClose,
  pdfHref,
  emailHref,
  closeHref,
  updateStatusAction,
  reopenAction,
}: {
  id: string
  status: string
  statuses: readonly string[]
  locked: boolean
  canClose: boolean
  pdfHref: string
  emailHref: string
  closeHref: string
  updateStatusAction: (formData: FormData) => Promise<void>
  reopenAction: (formData: FormData) => Promise<void>
}) {
  const tGenerated = useGeneratedTranslations()
  const [pending, start] = useTransition()
  const runOnline = useOnlineAction()

  // A status change runs flows: it needs signal and the latest field edits.
  function onStatusChange(next: string) {
    if (next === status) return
    const fd = new FormData()
    fd.set('id', id)
    fd.set('status', next)
    start(async () => {
      await runOnline('finish', () => updateStatusAction(fd))
    })
  }

  const statusSelect = locked ? null : (
    <Select
      aria-label={tGenerated('m_0b9da892d6faf0')}
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

  const pdfLink = (
    <DownloadLink href={pdfHref as any} target="_blank">
      <Button variant="outline" type="button">
        <FileText size={14} /> <GeneratedText id="m_1a2b2ed6729166" />
      </Button>
    </DownloadLink>
  )

  const emailLink = (
    <Link href={emailHref as any} scroll={false}>
      <Button variant="outline" type="button">
        <Mail size={14} /> <GeneratedText id="m_09dfca28fc95ba" />
      </Button>
    </Link>
  )

  const primary = locked ? (
    <form action={reopenAction}>
      <input type="hidden" name="id" value={id} />
      <Button variant="outline" type="submit">
        <Unlock size={14} /> <GeneratedText id="m_0341d048ec832d" />
      </Button>
    </form>
  ) : canClose ? (
    <Link href={closeHref as any} scroll={false}>
      <Button type="button">
        <CheckCircle2 size={14} /> <GeneratedText id="m_18770419e64d7e" />
      </Button>
    </Link>
  ) : (
    <Button type="button" disabled title={tGenerated('m_0c72729c5bcd03')}>
      <CheckCircle2 size={14} /> <GeneratedText id="m_18770419e64d7e" />
    </Button>
  )

  return (
    <div className="flex flex-wrap items-center gap-2">
      {statusSelect}
      <RecordActionMenu>
        {pdfLink}
        {emailLink}
        {primary}
      </RecordActionMenu>
    </div>
  )
}
