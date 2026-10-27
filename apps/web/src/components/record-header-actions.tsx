'use client'

import Link from 'next/link'
import { unstable_rethrow } from 'next/navigation'
import { flushRecordSaves } from '@/lib/pending-record-saves'
import { toast } from '@/lib/toast'
import { type ReactNode, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@beaconhs/ui'
import { DownloadLink } from '@/components/download-link'
import { RecordActionMenu } from '@/components/record-action-menu'
import { confirmDialog } from '@/lib/confirm'
import { Copy, FileText, Lock, Mail, Shield, Trash2, Unlock } from 'lucide-react'
import {
  GeneratedText,
  GeneratedValue,
  useGeneratedTranslations,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

type FormAction = (formData: FormData) => Promise<void>
type LockResult = { error: string; details?: string[] } | void
type LockAction = (formData: FormData) => Promise<LockResult>

/**
 * Submit button that asks first. Lock and unlock both run tenant flows
 * (submit / unlock emails) against a record people sign, and on a phone the
 * button sits a thumb's width from "More actions" — a mis-tap must not submit
 * a half-finished record.
 *
 * Confirming re-submits the same form, so the server action stays bound to the
 * form (no client-side re-implementation of the action call).
 */
export function ConfirmedSubmitButton({
  title,
  message,
  confirmLabel,
  disabledReason = null,
  children,
}: {
  title: string
  message: string
  confirmLabel: string
  /** Set to block the action outright, with the reason as the tooltip. */
  disabledReason?: string | null
  children: ReactNode
}) {
  const { pending } = useFormStatus()
  return (
    <Button
      variant="outline"
      type="submit"
      title={disabledReason ?? undefined}
      disabled={pending || Boolean(disabledReason)}
      onClick={(event) => {
        event.preventDefault()
        const button = event.currentTarget
        void confirmDialog({ title, message, confirmLabel }).then(async (ok) => {
          if (!ok) return
          try {
            await flushRecordSaves()
            button.form?.requestSubmit(button)
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Save failed. Please retry.')
          }
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
  iconSize,
  offerPhotoCopy = false,
}: {
  label: string
  iconSize: number
  offerPhotoCopy?: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const { pending } = useFormStatus()
  const [preparing, setPreparing] = useState(false)
  const busy = useRef(false)
  async function prepare(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    if (busy.current || pending) return
    busy.current = true
    setPreparing(true)
    const button = event.currentTarget
    let includePhotos = false
    try {
      if (
        offerPhotoCopy &&
        !(await confirmDialog({
          title: tGeneratedValue('Copy assessment'),
          confirmLabel: tGeneratedValue('Create copy'),
          message: (
            <div className="space-y-3">
              <p>
                {tGeneratedValue(
                  'Job content, answers, plans and crew names carry forward. The copy starts as a new draft with a new date. Everyone must sign again. Review attached plans before submitting them.',
                )}
              </p>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  onChange={(event) => {
                    includePhotos = event.target.checked
                  }}
                />
                <span>
                  {tGeneratedValue(
                    'Include existing photos. These are from the original assessment, not new site evidence.',
                  )}
                </span>
              </label>
            </div>
          ),
        }))
      )
        return
      if (!navigator.onLine)
        throw new Error(
          tGeneratedValue(
            'You need signal to copy this record. Your answers are saved on this device.',
          ),
        )
      await flushRecordSaves()
      const photoInput = button.form?.elements.namedItem('includePhotos')
      if (photoInput instanceof HTMLInputElement) photoInput.value = includePhotos ? '1' : '0'
      button.form?.requestSubmit(button)
    } catch (error) {
      unstable_rethrow(error)
      toast.error(
        error instanceof Error ? error.message : tGeneratedValue('Save failed. Please retry.'),
      )
    } finally {
      busy.current = false
      setPreparing(false)
    }
  }
  const content = (
    <>
      <Copy size={iconSize} />{' '}
      {pending || preparing ? tGenerated('m_17f0584a533f66') : tGeneratedValue(label)}
    </>
  )
  return (
    <Button variant="outline" type="submit" disabled={pending || preparing} onClick={prepare}>
      {content}
    </Button>
  )
}

/** Shared actions for auditable operational records, on every screen size. */
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
  offerPhotoCopy = false,
  lockAction,
  unlockAction,
  lockLabel = 'Submit & lock',
  mobileLockLabel = lockLabel,
  lockDisabledReason = null,
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
  offerPhotoCopy?: boolean
  lockAction: LockAction
  unlockAction: LockAction
  lockLabel?: string
  /** Short phone label; confirmation still describes the complete action. */
  mobileLockLabel?: string
  /**
   * Why this record cannot be submitted yet. The server is authoritative and
   * rejects the submit regardless; showing the reason here stops the button
   * offering an action that is going to fail after the person confirms it.
   */
  lockDisabledReason?: string | null
}) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const [lockError, setLockError] = useState<Exclude<LockResult, void> | null>(null)
  async function changeLock(formData: FormData): Promise<void> {
    setLockError(null)
    try {
      const result = await (locked ? unlockAction : lockAction)(formData)
      if (result) setLockError(result)
    } catch (error) {
      unstable_rethrow(error)
      setLockError({
        error:
          'Could not update this record. Your work was not reported as complete. Please retry.',
      })
    }
  }
  const lockForm = (
    <form action={changeLock}>
      <input type="hidden" name="id" value={id} />
      <ConfirmedSubmitButton
        title={locked ? tGenerated('m_0ada1228bbdfc0') : tGenerated('m_1b0351e1b7075e')}
        message={locked ? tGenerated('m_1b9e23f3e26938') : tGenerated('m_06944c5267be24')}
        confirmLabel={locked ? tGenerated('m_0ca830c9381fd6') : tGeneratedValue(lockLabel)}
        disabledReason={locked ? null : lockDisabledReason}
      >
        {locked ? <Unlock size={14} /> : <Lock size={14} />}
        {locked ? (
          <GeneratedText id="m_0ca830c9381fd6" />
        ) : mobileLockLabel === lockLabel ? (
          <GeneratedValue value={lockLabel} />
        ) : (
          <>
            <span className="sm:hidden">
              <GeneratedValue value={mobileLockLabel} />
            </span>
            <span className="hidden sm:inline">
              <GeneratedValue value={lockLabel} />
            </span>
          </>
        )}
      </ConfirmedSubmitButton>
    </form>
  )
  // Copy and lock forms stay connected while confirmation dialogs are open.
  const secondaryActions = (
    <>
      {review ? (
        <Link href={review.href as never} scroll={false}>
          <Shield size={15} /> {review.label ?? <GeneratedText id="m_039fc01243fb46" />}
        </Link>
      ) : null}
      <DownloadLink href={pdfHref}>
        <FileText size={15} /> <GeneratedText id="m_016088be0b1e51" />
      </DownloadLink>
      {canEmail ? (
        <Link href={emailHref as never} scroll={false}>
          <Mail size={15} /> <GeneratedText id="m_09dfca28fc95ba" />
        </Link>
      ) : null}
      {canCopy ? (
        <form action={copyAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="includePhotos" defaultValue="0" />
          <CopySubmit label={copyLabel} iconSize={15} offerPhotoCopy={offerPhotoCopy} />
        </form>
      ) : null}
    </>
  )

  return (
    <>
      <RecordActionMenu
        destructive={
          canDelete ? (
            <Link href={deleteHref as never} scroll={false}>
              <Trash2 size={15} /> <GeneratedText id="m_11773f3c3f7558" />
            </Link>
          ) : null
        }
      >
        {secondaryActions}
        {canLock ? lockForm : null}
      </RecordActionMenu>
      {lockError ? (
        <div role="alert" className="mt-2 max-w-sm text-sm text-red-700 dark:text-red-300">
          <GeneratedValue value={lockError.error} />
          {lockError.details?.length ? (
            <ul className="mt-1 list-disc pl-5">
              {lockError.details.map((detail, index) => (
                <li key={`${index}-${detail}`}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
