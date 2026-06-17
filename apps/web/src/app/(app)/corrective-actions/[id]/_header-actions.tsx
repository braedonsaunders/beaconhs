'use client'

// Detail-header actions for a corrective action, responsive. The status
// workflow lives HERE in the header (not a stray "Status" tab): a select that
// auto-saves non-terminal transitions on change. Closing is a distinct action
// (cost-impact prompt + lock) and reopening replaces it once locked. Desktop
// shows the full row; phones get status + the primary action + a More sheet.

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Button, Select, cn } from '@beaconhs/ui'
import { CheckCircle2, FileText, Lock, Mail, MoreHorizontal, Unlock } from 'lucide-react'

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
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  function onStatusChange(next: string) {
    if (next === status) return
    const fd = new FormData()
    fd.set('id', id)
    fd.set('status', next)
    start(() => updateStatusAction(fd))
  }

  const statusSelect = locked ? null : (
    <Select
      aria-label="Status"
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
    <Link href={pdfHref as any} target="_blank">
      <Button variant="outline" type="button">
        <FileText size={14} /> PDF
      </Button>
    </Link>
  )

  const emailLink = (
    <Link href={emailHref as any} scroll={false}>
      <Button variant="outline" type="button">
        <Mail size={14} /> Send email
      </Button>
    </Link>
  )

  const primary = locked ? (
    <form action={reopenAction}>
      <input type="hidden" name="id" value={id} />
      <Button variant="outline" type="submit">
        <Unlock size={14} /> Reopen
      </Button>
    </form>
  ) : canClose ? (
    <Link href={closeHref as any} scroll={false}>
      <Button type="button">
        <CheckCircle2 size={14} /> Close + lock
      </Button>
    </Link>
  ) : (
    <Button type="button" disabled title="Complete verification before closing">
      <CheckCircle2 size={14} /> Close + lock
    </Button>
  )

  const menuItem =
    'flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'

  return (
    <>
      {/* Desktop: the full row */}
      <div className="hidden items-center gap-2 sm:flex">
        {statusSelect}
        {pdfLink}
        {emailLink}
        {primary}
      </div>

      {/* Phone: Status + primary + a More sheet */}
      <div className="flex items-center gap-2 sm:hidden">
        {statusSelect ? <div className={cn(pending && 'opacity-60')}>{statusSelect}</div> : null}
        {primary}
        <Button
          variant="outline"
          type="button"
          aria-label="More actions"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <MoreHorizontal size={16} />
        </Button>
        {open ? (
          <>
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-40 bg-slate-900/30"
              onClick={() => setOpen(false)}
            />
            <div className="fixed inset-x-3 bottom-3 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
              <Link href={pdfHref as any} target="_blank" className={menuItem} onClick={() => setOpen(false)}>
                <FileText size={15} /> PDF
              </Link>
              <Link
                href={emailHref as any}
                scroll={false}
                className={menuItem}
                onClick={() => setOpen(false)}
              >
                <Mail size={15} /> Send email
              </Link>
              {locked ? (
                <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">
                  <Lock size={13} /> Closed &amp; locked
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
