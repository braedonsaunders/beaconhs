'use client'

import Link from 'next/link'
import { type ReactNode, useState } from 'react'
import { Button } from '@beaconhs/ui'
import { Copy, FileText, Lock, Mail, MoreHorizontal, Shield, Trash2, Unlock } from 'lucide-react'
import { GeneratedText, GeneratedValue, useGeneratedTranslations } from '@/i18n/generated'

type FormAction = (formData: FormData) => Promise<void>

/** Shared responsive action row for auditable operational records. */
export function RecordHeaderActions({
  id,
  locked,
  canDelete,
  canCopy = true,
  canEmail = true,
  canLock = true,
  pdfHref,
  emailHref,
  review,
  deleteHref,
  copyAction,
  lockAction,
  unlockAction,
  lockLabel = 'Submit & lock',
}: {
  id: string
  locked: boolean
  canDelete: boolean
  canCopy?: boolean
  canEmail?: boolean
  canLock?: boolean
  pdfHref: string
  emailHref: string
  review?: { href: string; label?: ReactNode } | null
  deleteHref: string
  copyAction: FormAction
  lockAction: FormAction
  unlockAction: FormAction
  lockLabel?: ReactNode
}) {
  const tGenerated = useGeneratedTranslations()
  const [open, setOpen] = useState(false)
  const lockForm = (
    <form action={locked ? unlockAction : lockAction}>
      <input type="hidden" name="id" value={id} />
      <Button variant="outline" type="submit">
        {locked ? <Unlock size={14} /> : <Lock size={14} />}
        {locked ? (
          <GeneratedText id="m_0ca830c9381fd6" />
        ) : (
          (lockLabel ?? <GeneratedValue value="Submit & lock" />)
        )}
      </Button>
    </form>
  )
  const menuItem =
    'flex min-h-11 w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'

  const secondaryActions = (
    <>
      {review ? (
        <Link href={review.href as never} scroll={false} className={menuItem}>
          <Shield size={15} /> {review.label ?? <GeneratedText id="m_039fc01243fb46" />}
        </Link>
      ) : null}
      <a href={pdfHref} className={menuItem}>
        <FileText size={15} /> <GeneratedText id="m_016088be0b1e51" />
      </a>
      {canEmail ? (
        <Link href={emailHref as never} scroll={false} className={menuItem}>
          <Mail size={15} /> <GeneratedText id="m_09dfca28fc95ba" />
        </Link>
      ) : null}
      {canCopy ? (
        <form action={copyAction}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" className={menuItem}>
            <Copy size={15} /> <GeneratedText id="m_10dc68936a0d02" />
          </button>
        </form>
      ) : null}
      {canDelete ? (
        <Link
          href={deleteHref as never}
          scroll={false}
          className={`${menuItem} border-t border-slate-100 text-red-600 dark:border-slate-800 dark:text-red-400`}
        >
          <Trash2 size={15} /> <GeneratedText id="m_11773f3c3f7558" />
        </Link>
      ) : null}
    </>
  )

  return (
    <>
      <div className="hidden items-center gap-2 sm:flex">
        {review ? (
          <Link href={review.href as never} scroll={false}>
            <Button variant="outline">
              <Shield size={14} /> {review.label ?? <GeneratedText id="m_039fc01243fb46" />}
            </Button>
          </Link>
        ) : null}
        <a href={pdfHref}>
          <Button variant="outline">
            <FileText size={14} /> <GeneratedText id="m_016088be0b1e51" />
          </Button>
        </a>
        {canEmail ? (
          <Link href={emailHref as never} scroll={false}>
            <Button variant="outline">
              <Mail size={14} /> <GeneratedText id="m_09dfca28fc95ba" />
            </Button>
          </Link>
        ) : null}
        {canCopy ? (
          <form action={copyAction}>
            <input type="hidden" name="id" value={id} />
            <Button variant="outline" type="submit">
              <Copy size={14} /> <GeneratedText id="m_10dc68936a0d02" />
            </Button>
          </form>
        ) : null}
        {canLock ? lockForm : null}
        {canDelete ? (
          <Link href={deleteHref as never} scroll={false}>
            <Button variant="outline" className="text-red-600 hover:bg-red-50">
              <Trash2 size={14} /> <GeneratedText id="m_11773f3c3f7558" />
            </Button>
          </Link>
        ) : null}
      </div>

      <div className="flex items-center gap-2 sm:hidden">
        {canLock ? lockForm : null}
        <Button
          variant="outline"
          type="button"
          aria-label={tGenerated('m_08ea20074b7d47')}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <MoreHorizontal size={16} />
        </Button>
        {open ? (
          <>
            <button
              type="button"
              aria-label={tGenerated('m_091cc178866e80')}
              className="fixed inset-0 z-40 bg-slate-900/30"
              onClick={() => setOpen(false)}
            />
            <div
              className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
              onClick={() => setOpen(false)}
            >
              {secondaryActions}
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
