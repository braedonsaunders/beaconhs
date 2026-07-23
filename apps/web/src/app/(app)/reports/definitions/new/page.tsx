import { assertCan } from '@beaconhs/tenant'
import {
  DEFAULT_REPORT_LAYOUT,
  defaultColumnsFor,
  type CustomReportDefinition,
} from '@beaconhs/reports'
import { loadBeaconReportCatalog } from '@beaconhs/reports/server'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { requireRequestContext } from '@/lib/auth'
import { loadTenantBranding } from '../../_run'
import { BeaconReportStudio } from '../../_studio/studio.client'

export default async function NewReportPage() {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.builder')
  const [branding, catalog] = await Promise.all([
    loadTenantBranding(ctx),
    ctx.db((tx) => loadBeaconReportCatalog(tx)),
  ])
  const source = catalog.entities[0]!
  const definition: CustomReportDefinition = {
    schemaVersion: 1,
    id: 'new',
    slug: 'untitled-report',
    name: tGenerated('m_017ca81c89345d'),
    description: tGenerated('m_0352af5525392e'),
    query: {
      entity: source.key,
      mode: 'rows',
      columns: defaultColumnsFor(source),
      filters: null,
      groupBy: null,
      sort: source.defaultSort ?? null,
      sorts: source.defaultSort ? [source.defaultSort] : null,
      limit: 1000,
    },
    layout: DEFAULT_REPORT_LAYOUT,
    state: 'published',
    tags: [source.category],
  }
  return (
    <BeaconReportStudio
      definition={definition}
      initialResult={null}
      organization={branding.name}
      catalog={catalog}
    />
  )
}
