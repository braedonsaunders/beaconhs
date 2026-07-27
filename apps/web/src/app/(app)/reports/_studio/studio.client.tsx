'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  type CustomReportDefinition,
  type ReportEntityCatalog,
  type ReportRunResult,
} from '@beaconhs/reports'
import { ReportStudio } from '@beaconhs/reports/react'
import { previewReportDefinition, saveReportDefinition } from './actions'

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
        if (definition.id === 'new' && saved.definition.id !== 'new') {
          router.replace(`/reports/definitions/${saved.definition.id}/edit`)
        }
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
