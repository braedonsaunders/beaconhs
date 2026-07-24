'use client'

import { useState } from 'react'
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
  const [value, setValue] = useState({ definition })
  return (
    <ReportStudio
      value={value}
      catalog={catalog}
      result={initialResult}
      onChange={setValue}
      onPreview={({ definition: next }) => previewReportDefinition(next)}
      onSave={({ definition: next }) => saveReportDefinition(next)}
      organization={organization}
      logoUrl={logoUrl}
      primaryColor={primaryColor}
      backHref="/reports"
      backLabel="Back to reports"
      pdfHref={
        definition.id === 'new'
          ? undefined
          : `/reports/definitions/${definition.id}/export?format=pdf`
      }
      autoPreviewMs={350}
      autoSaveMs={700}
      className="min-h-[calc(100dvh-8rem)]"
    />
  )
}
