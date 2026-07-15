'use client'

import { useGeneratedTranslations, useGeneratedValueTranslations } from '@/i18n/generated'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pin, PinOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@beaconhs/ui'
import { pinDashboard, unpinDashboard } from '../_actions'

export function PinButton({
  dashboardId,
  pinned: initial,
}: {
  dashboardId: string
  pinned: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pinned, setPinned] = useState(initial)
  const [pending, start] = useTransition()

  function toggle() {
    start(async () => {
      const r = pinned ? await unpinDashboard(dashboardId) : await pinDashboard(dashboardId)
      if (!r.ok) {
        toast.error(tGeneratedValue(r.error))
        return
      }
      setPinned(!pinned)
      toast.success(
        tGeneratedValue(pinned ? tGenerated('m_1eaba387cb6715') : tGenerated('m_0eb3ffeb180371')),
      )
      router.refresh()
    })
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={toggle}
      disabled={pending}
      className="h-8 text-xs"
    >
      <GeneratedValue
        value={
          pending ? (
            <Loader2 size={13} className="mr-1 animate-spin" />
          ) : pinned ? (
            <PinOff size={13} className="mr-1" />
          ) : (
            <Pin size={13} className="mr-1" />
          )
        }
      />
      <GeneratedValue
        value={
          pinned ? <GeneratedText id="m_13d63bca31825b" /> : <GeneratedText id="m_16b0d6e1ba7d5e" />
        }
      />
    </Button>
  )
}
