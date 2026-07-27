'use client'

import { useTransition } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@beaconhs/ui'
import { GeneratedText, useGeneratedTranslations } from '@/i18n/generated'
import { confirmDialog } from '@/lib/confirm'
import { toast } from '@/lib/toast'
import { deleteReportDefinition } from './_studio/actions'

export function DeleteReportButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const tGenerated = useGeneratedTranslations()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
      onClick={() => {
        void confirmDialog({
          message: tGenerated('m_17a872546b7b13', { value0: name }),
          confirmLabel: tGenerated('m_11773f3c3f7558'),
          tone: 'danger',
        }).then((confirmed) => {
          if (!confirmed) return
          startTransition(async () => {
            const result = await deleteReportDefinition(id)
            if (!result.ok) {
              toast.error(result.error)
              return
            }
            toast.success(tGenerated('m_0066ba1d61ce5a'))
            router.refresh()
          })
        })
      }}
    >
      {pending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
      <GeneratedText id="m_11773f3c3f7558" />
    </Button>
  )
}
