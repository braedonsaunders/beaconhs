'use client'

import { useState } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { PRINT_PROVIDERS, type DirectPrintProvider } from '@beaconhs/design-studio'
import { GeneratedValue, useGeneratedTranslations } from '@/i18n/generated'
import { toast } from '@/lib/toast'

export function DirectPrintButton({
  endpoint,
  provider,
  outputId,
  disabled = false,
}: {
  endpoint: string
  provider: DirectPrintProvider
  outputId?: string
  disabled?: boolean
}) {
  const [printing, setPrinting] = useState(false)
  const tGenerated = useGeneratedTranslations()
  const providerLabel = PRINT_PROVIDERS.find((item) => item.id === provider)?.label ?? 'printer'

  async function print() {
    if (printing || disabled) return
    setPrinting(true)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(outputId ? { outputId } : {}),
      })
      const result = (await response.json().catch(() => null)) as {
        error?: string
        jobId?: string | null
      } | null
      if (!response.ok) throw new Error(result?.error || tGenerated('m_10b6c2f119f410'))
      toast.success(
        result?.jobId
          ? tGenerated('m_18504e0a439a7e', { value0: result.jobId })
          : tGenerated('m_11afb9fce35968'),
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tGenerated('m_10b6c2f119f410'))
    } finally {
      setPrinting(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || printing}
      onClick={print}
    >
      <Printer size={14} />
      <GeneratedValue
        value={printing ? `Sending to ${providerLabel}…` : `Print with ${providerLabel}`}
      />
    </Button>
  )
}
