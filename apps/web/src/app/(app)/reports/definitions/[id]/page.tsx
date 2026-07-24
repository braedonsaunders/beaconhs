import { notFound } from 'next/navigation'
import { loadBeaconReportCatalog } from '@beaconhs/reports/server'
import { can } from '@beaconhs/tenant'
import { PageContainer } from '@/components/page-layout'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'
import { loadDefinitionById } from '../../_definitions'
import { loadTenantBranding, runReportForViewer } from '../../_run'
import { BeaconReportViewer } from '../../_viewer/viewer.client'

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  const definition = await loadDefinitionById(ctx.tenantId!, id)
  if (!definition) notFound()
  const [{ result, error }, branding, catalog] = await Promise.all([
    runReportForViewer(ctx, definition),
    loadTenantBranding(ctx),
    ctx.db((tx) => loadBeaconReportCatalog(tx)),
  ])
  const canBuild = ctx.isSuperAdmin || can(ctx, 'reports.builder')

  return (
    <PageContainer className="space-y-4">
      <BeaconReportViewer
        definition={definition}
        catalog={catalog}
        organization={branding.name}
        description={definition.description ?? tGenerated('m_06cf662b44bd2f')}
        initialResult={result}
        initialError={error}
        canBuild={canBuild}
      />
    </PageContainer>
  )
}
