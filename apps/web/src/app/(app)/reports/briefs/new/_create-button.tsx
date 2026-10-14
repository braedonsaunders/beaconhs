'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@beaconhs/ui'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { createBrief } from '@/lib/briefs/actions'

export function CreateBriefButton({
  templateKey,
  label,
  variant = 'default',
}: {
  templateKey: string | null
  label: string
  variant?: 'default' | 'outline'
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant={variant}
      disabled={pending || busy}
      onClick={() => {
        setBusy(true)
        start(async () => {
          const result = await createBrief({ templateKey })
          if (result.ok) {
            router.push(`/reports/briefs/${result.id}`)
          } else {
            toast.error(tGeneratedValue(result.error))
            setBusy(false)
          }
        })
      }}
    >
      {pending || busy ? <Loader2 size={14} className="animate-spin" /> : null}
      <GeneratedValue value={label} />
    </Button>
  )
}
