'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

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
  const tGenerated = useGeneratedTranslations()
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
      aria-label={tGenerated('m_0b9da892d6faf0')}
      value={status}
      disabled={pending}
      onChange={(e) => onStatusChange(e.target.value)}
      className="w-auto min-w-36 capitalize"
    >
      <GeneratedValue
        value={statuses.map((s) => (
          <option key={s} value={s} className="capitalize">
            <GeneratedValue value={s.replace(/_/g, ' ')} />
          </option>
        ))}
      />
    </Select>
  )

  const pdfLink = (
    <Link href={pdfHref as any} target="_blank">
      <Button variant="outline" type="button">
        <FileText size={14} /> <GeneratedText id="m_1a2b2ed6729166" />
      </Button>
    </Link>
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

  const menuItem =
    'flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'

  return (
    <>
      {/* Desktop: the full row */}
      <div className="hidden items-center gap-2 sm:flex">
        <GeneratedValue value={statusSelect} />
        <GeneratedValue value={pdfLink} />
        <GeneratedValue value={emailLink} />
        <GeneratedValue value={primary} />
      </div>

      {/* Phone: Status + primary + a More sheet */}
      <div className="flex items-center gap-2 sm:hidden">
        <GeneratedValue
          value={
            statusSelect ? (
              <div className={cn(pending && 'opacity-60')}>
                <GeneratedValue value={statusSelect} />
              </div>
            ) : null
          }
        />
        <GeneratedValue value={primary} />
        <Button
          variant="outline"
          type="button"
          aria-label={tGenerated('m_08ea20074b7d47')}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <MoreHorizontal size={16} />
        </Button>
        <GeneratedValue
          value={
            open ? (
              <>
                <button
                  type="button"
                  aria-label={tGenerated('m_091cc178866e80')}
                  className="fixed inset-0 z-40 bg-slate-900/30"
                  onClick={() => setOpen(false)}
                />
                <div className="fixed inset-x-3 bottom-3 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  <Link
                    href={pdfHref as any}
                    target="_blank"
                    className={menuItem}
                    onClick={() => setOpen(false)}
                  >
                    <FileText size={15} /> <GeneratedText id="m_1a2b2ed6729166" />
                  </Link>
                  <Link
                    href={emailHref as any}
                    scroll={false}
                    className={menuItem}
                    onClick={() => setOpen(false)}
                  >
                    <Mail size={15} /> <GeneratedText id="m_09dfca28fc95ba" />
                  </Link>
                  <GeneratedValue
                    value={
                      locked ? (
                        <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">
                          <Lock size={13} /> <GeneratedText id="m_14597c6d86b045" />
                        </div>
                      ) : null
                    }
                  />
                </div>
              </>
            ) : null
          }
        />
      </div>
    </>
  )
}
