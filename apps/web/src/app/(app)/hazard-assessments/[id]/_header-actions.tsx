'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// Detail-header actions, responsive. Desktop shows the full button row;
// phones get the one action that matters in the field (Lock / Unlock) plus a
// "More" sheet with the rest — six buttons would otherwise wrap into three
// rows and shove the form below the fold.

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@beaconhs/ui'
import { Copy, FileText, Lock, Mail, MoreHorizontal, Shield, Trash2, Unlock } from 'lucide-react'

export function AssessmentHeaderActions({
  id,
  locked,
  canManage,
  canReview,
  pdfHref,
  emailHref,
  reviewHref,
  deleteHref,
  copyAction,
  lockAction,
  unlockAction,
}: {
  id: string
  locked: boolean
  canManage: boolean
  canReview: boolean
  pdfHref: string
  emailHref: string
  reviewHref: string
  deleteHref: string
  copyAction: (formData: FormData) => Promise<void>
  lockAction: (formData: FormData) => Promise<void>
  unlockAction: (formData: FormData) => Promise<void>
}) {
  const tGenerated = useGeneratedTranslations()
  const [open, setOpen] = useState(false)

  const lockForm = (
    <form action={locked ? unlockAction : lockAction}>
      <input type="hidden" name="id" value={id} />
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
        <GeneratedValue
          value={
            canReview ? (
              <Link href={reviewHref as any} scroll={false}>
                <Button variant="outline">
                  <Shield size={14} /> <GeneratedText id="m_039fc01243fb46" />
                </Button>
              </Link>
            ) : null
          }
        />
        {/* Plain <a>, not <Link> — the PDF route audits the export, and Link
            prefetch would log phantom exports on hover/viewport. */}
        <a href={pdfHref}>
          <Button variant="outline">
            <FileText size={14} /> <GeneratedText id="m_016088be0b1e51" />
          </Button>
        </a>
        <Link href={emailHref as any} scroll={false}>
          <Button variant="outline">
            <Mail size={14} /> <GeneratedText id="m_09dfca28fc95ba" />
          </Button>
        </Link>
        <form action={copyAction}>
          <input type="hidden" name="id" value={id} />
          <Button variant="outline" type="submit">
            <Copy size={14} /> <GeneratedText id="m_10dc68936a0d02" />
          </Button>
        </form>
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

      {/* Phone: Lock/Unlock + a More sheet */}
      <div className="flex items-center gap-2 sm:hidden">
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
                  <GeneratedValue
                    value={
                      canReview ? (
                        <Link
                          href={reviewHref as any}
                          scroll={false}
                          className={menuItem}
                          onClick={() => setOpen(false)}
                        >
                          <Shield size={15} /> <GeneratedText id="m_039fc01243fb46" />
                        </Link>
                      ) : null
                    }
                  />
                  <a href={pdfHref} className={menuItem} onClick={() => setOpen(false)}>
                    <FileText size={15} /> <GeneratedText id="m_016088be0b1e51" />
                  </a>
                  <Link
                    href={emailHref as any}
                    scroll={false}
                    className={menuItem}
                    onClick={() => setOpen(false)}
                  >
                    <Mail size={15} /> <GeneratedText id="m_09dfca28fc95ba" />
                  </Link>
                  <form action={copyAction}>
                    <input type="hidden" name="id" value={id} />
                    <button type="submit" className={menuItem}>
                      <Copy size={15} /> <GeneratedText id="m_10dc68936a0d02" />
                    </button>
                  </form>
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
