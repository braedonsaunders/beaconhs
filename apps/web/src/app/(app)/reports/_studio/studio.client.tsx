'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  type CustomReportDefinition,
  type ReportEntityCatalog,
  type ReportRunResult,
} from '@beaconhs/reports'
import { ReportStudio } from '@beaconhs/reports/react'
import { useGeneratedTranslations } from '@/i18n/generated'
import { confirmDialog } from '@/lib/confirm'
import { toast } from '@/lib/toast'
import { deleteReportDefinition, previewReportDefinition, saveReportDefinition } from './actions'

export function BeaconReportStudio({
  definition,
  initialResult,
  organization,
  logoUrl,
  primaryColor,
  catalog,
}: {
  definition: CustomReportDefinition
  initialResult: ReportRunResult | null
  organization: string
  logoUrl: string | null
  primaryColor: string | null
  catalog: ReportEntityCatalog
}) {
  const router = useRouter()
  const tGenerated = useGeneratedTranslations()
  const [value, setValue] = useState({ definition })
  return (
    <ReportStudio
      value={value}
      catalog={catalog}
      result={initialResult}
      onChange={setValue}
      onPreview={({ definition: next }) => previewReportDefinition(next)}
      onSave={async ({ definition: next }) => {
        const result = await saveReportDefinition(next)
        return result.ok ? { ok: true, value: { definition: result.definition } } : result
      }}
      onSaved={(saved) => {
        if (saved.definition.id !== definition.id && saved.definition.id !== 'new') {
          router.replace(`/reports/definitions/${saved.definition.id}/edit`)
        }
      }}
      onDelete={
        definition.id === 'new'
          ? undefined
          : async ({ definition: current }) => {
              const confirmed = await confirmDialog({
                message: tGenerated('m_17a872546b7b13', { value0: current.name }),
                confirmLabel: tGenerated('m_11773f3c3f7558'),
                tone: 'danger',
              })
              if (!confirmed) return { ok: false, cancelled: true }
              return deleteReportDefinition(current.id)
            }
      }
      onDeleted={() => {
        toast.success(tGenerated('m_0066ba1d61ce5a'))
        router.replace('/reports')
      }}
      organization={organization}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
      pdfHref={
        definition.id === 'new'
          ? undefined
          : `/reports/definitions/${definition.id}/export?format=pdf`
      }
      autoPreviewMs={350}
      autoSaveMs={700}
      className="min-h-[calc(100dvh-12rem)] rounded-xl border border-slate-200 dark:border-slate-800"
    />
  )
}
