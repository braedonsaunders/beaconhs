'use client'

import { useEffect, useState } from 'react'
import { useGeneratedValueTranslations } from '@/i18n/generated'
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
  canUpdate,
  signed,
  crewTotal,
  revision,
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
  canUpdate: boolean
  signed: number
  crewTotal: number
  revision: number
}) {
  const t = useGeneratedValueTranslations()
  const [progress, setProgress] = useState({ id, revision, signed, total: crewTotal })
  useEffect(() => {
    function update(event: Event) {
      const detail = (
        event as CustomEvent<{
          assessmentId: string
          revision: number
          signed: number
          total: number
        }>
      ).detail
      if (detail.assessmentId === id) setProgress({ id, ...detail })
    }
    window.addEventListener('hazid-signatures-updated', update)
    return () => window.removeEventListener('hazid-signatures-updated', update)
  }, [id])
  const current =
    progress.id === id && progress.revision === revision ? progress : { signed, total: crewTotal }
  const lockDisabledReason =
    current.signed === 0
      ? t('Collect crew signatures before submitting')
      : current.signed < current.total
        ? t('Collect every crew signature or remove unsigned crew members before submitting')
        : null
  return (
    <RecordHeaderActions
      id={id}
      locked={locked}
      canDelete={canManage}
      canLock={canUpdate}
      canCopy={canUpdate}
      unlockLabel="Start new revision"
      unlockMessage="Start a new revision? Previous signatures stay in history. Everyone must review and sign again."
      pdfHref={pdfHref}
      emailHref={emailHref}
      review={canReview ? { href: reviewHref } : null}
      deleteHref={deleteHref}
      copyAction={copyAction}
      lockAction={lockAction}
      unlockAction={unlockAction}
      lockDisabledReason={lockDisabledReason}
    />
  )
}
