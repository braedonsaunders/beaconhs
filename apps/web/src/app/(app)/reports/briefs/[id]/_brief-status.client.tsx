'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@beaconhs/ui'
import {
  GeneratedText,
  useGeneratedTranslations,
  useGeneratedValueTranslations,
} from '@/i18n/generated'
import { confirmDialog } from '@/lib/confirm'
import { setBriefStatus } from '@/lib/briefs/actions'

export function BriefStatusButton({ id, status }: { id: string; status: 'active' | 'archived' }) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()
  const archiving = status === 'active'
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={async () => {
        if (archiving && !(await confirmDialog(tGenerated('m_1d29fe9812a955')))) return
        start(async () => {
          const result = await setBriefStatus({ id, status: archiving ? 'archived' : 'active' })
          if (!result.ok) toast.error(tGeneratedValue(result.error))
          router.refresh()
        })
      }}
    >
      {pending ? (
        <Loader2 size={14} className="animate-spin" />
      ) : archiving ? (
        <Archive size={14} />
      ) : (
        <ArchiveRestore size={14} />
      )}
      {archiving ? (
        <GeneratedText id="m_019c0a64030688" />
      ) : (
        <GeneratedText id="m_19500e41842c99" />
      )}
    </Button>
  )
}
