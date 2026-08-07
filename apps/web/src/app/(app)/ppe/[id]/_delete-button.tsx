'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { confirmDialog } from '@/lib/confirm'
import { toast } from '@/lib/toast'

/**
 * Remove a PPE item from the register. Confirmation names the item so a
 * mis-click on the wrong record is obvious before it happens.
 */
export function DeletePpeButton({
  itemId,
  label,
  deleteAction,
}: {
  itemId: string
  /** Serial or type name, shown in the confirmation. */
  label: string
  deleteAction: (args: {
    ppeItemId: string
  }) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()

  async function onDelete() {
    const confirmed = await confirmDialog({
      title: tGenerated('m_1deb9aa8d87738'),
      message: tGenerated('m_09b885cf21e746', { value0: label }),
      confirmLabel: tGenerated('m_11773f3c3f7558'),
      tone: 'danger',
    })
    if (!confirmed) return
    start(async () => {
      const result = await deleteAction({ ppeItemId: itemId })
      if (result.ok) {
        router.push('/ppe')
        router.refresh()
      } else {
        toast.error(tGeneratedValue(result.error))
      }
    })
  }

  return (
    <Button variant="outline" onClick={onDelete} disabled={pending} className="text-rose-600">
      <Trash2 size={14} /> <GeneratedText id="m_11773f3c3f7558" />
    </Button>
  )
}
