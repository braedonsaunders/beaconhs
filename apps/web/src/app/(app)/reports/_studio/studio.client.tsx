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
  catalog,
}: {
  definition: CustomReportDefinition
  initialResult: ReportRunResult | null
  organization: string
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
      autoPreviewMs={350}
      autoSaveMs={700}
      className="min-h-[calc(100dvh-8rem)]"
    />
  )
}
