'use client'

import { useGeneratedTranslations, useGeneratedValueTranslations } from '@/i18n/generated'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

import { useState, useTransition } from 'react'
import { Pin, PinOff } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { pinFormToSidebar, unpinFormFromSidebar } from '@/app/(app)/admin/navigation/_actions'

// Pin / Unpin toggle for a form template. Only rendered for users with
// admin.nav.manage (the gallery decides). Reflects + flips the tenant-wide
// sidebar pin.
export function PinFormButton({ templateId, pinned }: { templateId: string; pinned: boolean }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [isPinned, setIsPinned] = useState(pinned)
  const [pending, start] = useTransition()
  return (
    <Button
      variant={isPinned ? 'secondary' : 'outline'}
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = isPinned
            ? await unpinFormFromSidebar(templateId)
            : await pinFormToSidebar(templateId)
          if (!res.ok) {
            toast.error(tGeneratedValue(res.error ?? tGenerated('m_09249e0e6a801e')))
            return
          }
          const nowPinned = !isPinned
          setIsPinned(nowPinned)
          toast.success(
            tGeneratedValue(
              nowPinned ? tGenerated('m_0b17db61978aca') : tGenerated('m_1eaba387cb6715'),
            ),
          )
        })
      }
    >
      <GeneratedValue value={isPinned ? <PinOff size={14} /> : <Pin size={14} />} />
      <GeneratedValue
        value={
          isPinned ? (
            <GeneratedText id="m_09eea65fa736d3" />
          ) : (
            <GeneratedText id="m_16b0d6e1ba7d5e" />
          )
        }
      />
    </Button>
  )
}
