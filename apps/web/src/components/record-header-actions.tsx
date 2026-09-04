'use client'

import Link from 'next/link'
import { type ReactNode, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@beaconhs/ui'
import { DownloadLink } from '@/components/download-link'
import { confirmDialog } from '@/lib/confirm'
import { Copy, FileText, Lock, Mail, MoreHorizontal, Shield, Trash2, Unlock } from 'lucide-react'
import {
  GeneratedText,
  GeneratedValue,
  useGeneratedTranslations,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

type FormAction = (formData: FormData) => Promise<void>

/**
 * Submit button that asks first. Lock and unlock both run tenant flows
 * (submit / unlock emails) against a record people sign, and on a phone the
 * button sits a thumb's width from "More actions" — a mis-tap must not submit
 * a half-finished record.
 *
 * Confirming re-submits the same form, so the server action stays bound to the
 * form (no client-side re-implementation of the action call).
 */
function ConfirmedSubmitButton({
  title,
  message,
  confirmLabel,
  children,
}: {
  title: string
  message: string
  confirmLabel: string
  children: ReactNode
}) {
  const { pending } = useFormStatus()
  return (
    <Button
      variant="outline"
      type="submit"
      disabled={pending}
      onClick={(event) => {
        event.preventDefault()
        const button = event.currentTarget
        void confirmDialog({ title, message, confirmLabel }).then((ok) => {
          if (ok) button.form?.requestSubmit(button)
        })
      }}
    >
      {children}
    </Button>
  )
}

/**
 * Copy submit control. Copying an assessment/inspection duplicates every child
 * row, so it is slow enough that the field user needs a pending state —
 * otherwise the tap looks like it did nothing and they tap again, creating two
 * drafts. Rendered as a button or a sheet row via `className`.
 */
function CopySubmit({
  label,
  className,
  iconSize,
}: {
  label: string
  className?: string
  iconSize: number
}) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const { pending } = useFormStatus()
  const content = (
    <>
      <Copy size={iconSize} /> {pending ? tGenerated('m_17f0584a533f66') : tGeneratedValue(label)}
    </>
  )
  return className ? (
    <button type="submit" className={className} disabled={pending}>
      {content}
    </button>
  ) : (
    <Button variant="outline" type="submit" disabled={pending}>
      {content}
    </Button>
  )
}

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
  copyLabel = 'Copy assessment',
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
  /** Module wording for the copy control, e.g. "Copy inspection". */
  copyLabel?: string
  lockAction: FormAction
  unlockAction: FormAction
  lockLabel?: string
}) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const [open, setOpen] = useState(false)
  const lockForm = (
    <form action={locked ? unlockAction : lockAction}>
      <input type="hidden" name="id" value={id} />
      <ConfirmedSubmitButton
        title={locked ? tGenerated('m_0ada1228bbdfc0') : tGenerated('m_1b0351e1b7075e')}
        message={locked ? tGenerated('m_1b9e23f3e26938') : tGenerated('m_06944c5267be24')}
        confirmLabel={locked ? tGenerated('m_0ca830c9381fd6') : tGeneratedValue(lockLabel)}
      >
        {locked ? <Unlock size={14} /> : <Lock size={14} />}
        {locked ? <GeneratedText id="m_0ca830c9381fd6" /> : <GeneratedValue value={lockLabel} />}
      </ConfirmedSubmitButton>
    </form>
  )
  const menuItem =
    'flex min-h-11 w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:text-slate-200 dark:hover:bg-slate-800'

  // Every sheet row closes the sheet itself. Closing from the sheet container
  // instead would unmount the copy <form> while the tap is still being
  // dispatched, and the browser cancels submission of a disconnected form — the
  // copy button would silently do nothing on a phone. The copy form is left
  // mounted on purpose: it shows its pending state and the redirect to the new
  // record unmounts the whole header.
  const secondaryActions = (
    <>
      {review ? (
        <Link
          href={review.href as never}
          scroll={false}
          className={menuItem}
          onClick={() => setOpen(false)}
        >
          <Shield size={15} /> {review.label ?? <GeneratedText id="m_039fc01243fb46" />}
        </Link>
      ) : null}
      <DownloadLink href={pdfHref} className={menuItem} onClick={() => setOpen(false)}>
        <FileText size={15} /> <GeneratedText id="m_016088be0b1e51" />
      </DownloadLink>
      {canEmail ? (
        <Link
          href={emailHref as never}
          scroll={false}
          className={menuItem}
          onClick={() => setOpen(false)}
        >
          <Mail size={15} /> <GeneratedText id="m_09dfca28fc95ba" />
        </Link>
      ) : null}
      {canCopy ? (
        <form action={copyAction}>
          <input type="hidden" name="id" value={id} />
          <CopySubmit label={copyLabel} className={menuItem} iconSize={15} />
        </form>
      ) : null}
      {canDelete ? (
        <Link
          href={deleteHref as never}
          scroll={false}
          className={`${menuItem} border-t border-slate-100 text-red-600 dark:border-slate-800 dark:text-red-400`}
          onClick={() => setOpen(false)}
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
        <DownloadLink href={pdfHref}>
          <Button variant="outline">
            <FileText size={14} /> <GeneratedText id="m_016088be0b1e51" />
          </Button>
        </DownloadLink>
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
            <CopySubmit label={copyLabel} iconSize={14} />
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
            <div className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
              {secondaryActions}
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
