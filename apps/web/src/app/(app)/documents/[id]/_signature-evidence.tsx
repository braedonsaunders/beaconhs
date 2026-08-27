'use client'

import { GeneratedText, useGeneratedTranslations } from '@/i18n/generated'
import { useState } from 'react'
import { PenLine } from 'lucide-react'
import { Button, Drawer } from '@beaconhs/ui'
import { RawImage } from '@/components/raw-image'

export function SignatureEvidence({
  name,
  signatureUrl,
}: {
  name: string
  signatureUrl: string | null
}) {
  const tGenerated = useGeneratedTranslations()
  const [open, setOpen] = useState(false)
  if (!signatureUrl) return null

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PenLine size={12} /> <GeneratedText id="m_0c0bc02db58371" />
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={tGenerated('m_017383099e620c', { value0: name })}
        size="sm"
      >
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
          <RawImage
            src={signatureUrl}
            alt={tGenerated('m_017383099e620c', { value0: name })}
            optimizationReason="authenticated"
            className="mx-auto h-32 w-full object-contain"
          />
        </div>
      </Drawer>
    </>
  )
}
