'use client'

// Detail-header actions, responsive. Desktop shows the full button row;
// phones get the one action that matters in the field (Lock / Unlock) plus a
// "More" sheet with the rest — six buttons would otherwise wrap into three
// rows and shove the form below the fold.

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@beaconhs/ui'
import { Copy, FileText, Lock, Mail, MoreHorizontal, Trash2, Unlock } from 'lucide-react'

export function AssessmentHeaderActions({
  id,
  locked,
  canManage,
  pdfHref,
  emailHref,
  deleteHref,
  copyAction,
  lockAction,
  unlockAction,
}: {
  id: string
  locked: boolean
  canManage: boolean
  pdfHref: string
  emailHref: string
  deleteHref: string
  copyAction: (formData: FormData) => Promise<void>
  lockAction: (formData: FormData) => Promise<void>
  unlockAction: (formData: FormData) => Promise<void>
}) {
  const [open, setOpen] = useState(false)

  const lockForm = (
    <form action={locked ? unlockAction : lockAction}>
      <input type="hidden" name="id" value={id} />
      <Button variant="outline" type="submit">
        {locked ? (
          <>
            <Unlock size={14} /> Unlock
          </>
        ) : (
          <>
            <Lock size={14} /> Lock
          </>
        )}
      </Button>
    </form>
  )

  const menuItem =
    'flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'

  return (
    <>
      {/* Desktop: the full row */}
      <div className="hidden items-center gap-2 sm:flex">
        {/* Plain <a>, not <Link> — the PDF route audits the export, and Link
            prefetch would log phantom exports on hover/viewport. */}
        <a href={pdfHref}>
          <Button variant="outline">
            <FileText size={14} /> Print / PDF
          </Button>
        </a>
        <Link href={emailHref as any} scroll={false}>
          <Button variant="outline">
            <Mail size={14} /> Send email
          </Button>
        </Link>
        <form action={copyAction}>
          <input type="hidden" name="id" value={id} />
          <Button variant="outline" type="submit">
            <Copy size={14} /> Copy assessment
          </Button>
        </form>
        {lockForm}
        {canManage ? (
          <Link href={deleteHref as any} scroll={false}>
            <Button variant="outline" className="text-red-600 hover:bg-red-50">
              <Trash2 size={14} /> Delete
            </Button>
          </Link>
        ) : null}
      </div>

      {/* Phone: Lock/Unlock + a More sheet */}
      <div className="flex items-center gap-2 sm:hidden">
        {lockForm}
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
              <a href={pdfHref} className={menuItem} onClick={() => setOpen(false)}>
                <FileText size={15} /> Print / PDF
              </a>
              <Link
                href={emailHref as any}
                scroll={false}
                className={menuItem}
                onClick={() => setOpen(false)}
              >
                <Mail size={15} /> Send email
              </Link>
              <form action={copyAction}>
                <input type="hidden" name="id" value={id} />
                <button type="submit" className={menuItem}>
                  <Copy size={15} /> Copy assessment
                </button>
              </form>
              {canManage ? (
                <Link
                  href={deleteHref as any}
                  scroll={false}
                  className={`${menuItem} border-t border-slate-100 text-red-600 dark:border-slate-800 dark:text-red-400`}
                  onClick={() => setOpen(false)}
                >
                  <Trash2 size={15} /> Delete
                </Link>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
