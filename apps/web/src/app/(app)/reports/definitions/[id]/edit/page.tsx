import { notFound } from 'next/navigation'
import { loadBeaconReportCatalog } from '@beaconhs/reports/server'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'
import { loadDefinitionById, toAppKitDefinition } from '../../../_definitions'
import { loadTenantBranding, runReportForViewer } from '../../../_run'
import { BeaconReportStudio } from '../../../_studio/studio.client'

export default async function EditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.builder')
  const definition = await loadDefinitionById(ctx.tenantId!, id)
  if (!definition) notFound()
  const [{ result }, branding, catalog] = await Promise.all([
    runReportForViewer(ctx, definition),
    loadTenantBranding(ctx),
    ctx.db((tx) => loadBeaconReportCatalog(tx)),
  ])
  return (
    <BeaconReportStudio
      definition={toAppKitDefinition(definition)}
      initialResult={result}
      organization={branding.name}
      catalog={catalog}
    />
  )
}
