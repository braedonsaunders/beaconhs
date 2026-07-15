'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// Detail-header actions for an incident, responsive. The status workflow lives
// HERE in the header (not a stray card at the bottom of the page): a select
// that auto-saves on change. Desktop shows the full button row; phones get the
// status + the one action that matters in the field (Lock / Unlock) plus a
// "More" sheet with the rest.

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Button, Select, cn } from '@beaconhs/ui'
import { Copy, FileText, Lock, Mail, MoreHorizontal, Trash2, Unlock } from 'lucide-react'

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
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  function onStatusChange(next: string) {
    if (next === status) return
    const fd = new FormData()
    fd.set('id', id)
    fd.set('status', next)
    start(() => updateStatusAction(fd))
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

  const lockForm = (
    <form action={toggleLockAction}>
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
    </form>
  )

  const menuItem =
    'flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'

  return (
    <>
      {/* Desktop: the full row */}
      <div className="hidden items-center gap-2 sm:flex">
        <GeneratedValue value={statusSelect} />
        <Link href={pdfHref as any}>
          <Button variant="outline">
            <FileText size={14} /> <GeneratedText id="m_016088be0b1e51" />
          </Button>
        </Link>
        <Link href={emailHref as any} scroll={false}>
          <Button variant="outline">
            <Mail size={14} /> <GeneratedText id="m_09dfca28fc95ba" />
          </Button>
        </Link>
        <Link href={copyHref as any} scroll={false}>
          <Button variant="outline">
            <Copy size={14} /> <GeneratedText id="m_17e5ebd91b9a4f" />
          </Button>
        </Link>
        <GeneratedValue value={lockForm} />
        <GeneratedValue
          value={
            canManage ? (
              <Link href={deleteHref as any} scroll={false}>
                <Button variant="outline" className="text-red-600 hover:bg-red-50">
                  <Trash2 size={14} /> <GeneratedText id="m_11773f3c3f7558" />
                </Button>
              </Link>
            ) : null
          }
        />
      </div>

      {/* Phone: Status + Lock/Unlock + a More sheet */}
      <div className="flex items-center gap-2 sm:hidden">
        <div className={cn(pending && 'opacity-60')}>
          <GeneratedValue value={statusSelect} />
        </div>
        <GeneratedValue value={lockForm} />
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
                  <Link href={pdfHref as any} className={menuItem} onClick={() => setOpen(false)}>
                    <FileText size={15} /> <GeneratedText id="m_016088be0b1e51" />
                  </Link>
                  <Link
                    href={emailHref as any}
                    scroll={false}
                    className={menuItem}
                    onClick={() => setOpen(false)}
                  >
                    <Mail size={15} /> <GeneratedText id="m_09dfca28fc95ba" />
                  </Link>
                  <Link
                    href={copyHref as any}
                    scroll={false}
                    className={menuItem}
                    onClick={() => setOpen(false)}
                  >
                    <Copy size={15} /> <GeneratedText id="m_17e5ebd91b9a4f" />
                  </Link>
                  <GeneratedValue
                    value={
                      canManage ? (
                        <Link
                          href={deleteHref as any}
                          scroll={false}
                          className={`${menuItem} border-t border-slate-100 text-red-600 dark:border-slate-800 dark:text-red-400`}
                          onClick={() => setOpen(false)}
                        >
                          <Trash2 size={15} /> <GeneratedText id="m_11773f3c3f7558" />
                        </Link>
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
