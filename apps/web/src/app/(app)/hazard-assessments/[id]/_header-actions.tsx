'use client'

import { RecordHeaderActions } from '@/components/record-header-actions'

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
  return (
    <RecordHeaderActions
      id={id}
      locked={locked}
      canDelete={canManage}
      pdfHref={pdfHref}
      emailHref={emailHref}
      review={canReview ? { href: reviewHref } : null}
      deleteHref={deleteHref}
      copyAction={copyAction}
      lockAction={lockAction}
      unlockAction={unlockAction}
    />
  )
}
