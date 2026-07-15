'use client'

import { useGeneratedTranslations, useGeneratedValueTranslations } from '@/i18n/generated'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@beaconhs/ui'
import { confirmDialog } from '@/lib/confirm'
import { deleteObligation, setObligationEnabled } from '../_actions'

export function ObligationDetailActions({
  id,
  enabled,
  canManage,
  canEdit,
  editHref,
}: {
  id: string
  enabled: boolean
  canManage: boolean
  // The unified form can only author the KIND_META kinds; ETL-only source
  // modules are manageable (pause/delete) but not editable through the flyout.
  canEdit: boolean
  editHref: string
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()

  if (!canManage) return null

  return (
    <div className="flex gap-2">
      <GeneratedValue
        value={
          canEdit ? (
            <Link href={editHref as never} scroll={false}>
              <Button variant="outline" disabled={pending}>
                <GeneratedText id="m_03a66f9d34ac7b" />
              </Button>
            </Link>
          ) : null
        }
      />
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              const result = await setObligationEnabled(id, !enabled)
              if (!result.ok) {
                toast.error(tGeneratedValue(result.error))
                return
              }
              router.refresh()
            } catch {
              toast.error(
                tGenerated('m_170f0e6a0a4a20', { value0: enabled ? 'disable' : 'enable' }),
              )
            }
          })
        }
      >
        <GeneratedValue
          value={
            enabled ? (
              <GeneratedText id="m_13b801904d8adf" />
            ) : (
              <GeneratedText id="m_0abe527dca8fa6" />
            )
          }
        />
      </Button>
      <Button
        variant="destructive"
        disabled={pending}
        onClick={async () => {
          if (
            !(await confirmDialog({
              message: 'Delete this obligation? This cannot be undone.',
              tone: 'danger',
            }))
          )
            return
          start(async () => {
            try {
              const result = await deleteObligation(id)
              if (!result.ok) {
                toast.error(tGeneratedValue(result.error))
                return
              }
              router.push('/compliance/obligations')
            } catch {
              toast.error(tGenerated('m_1d9cccca18d567'))
            }
          })
        }}
      >
        <GeneratedText id="m_11773f3c3f7558" />
      </Button>
    </div>
  )
}
