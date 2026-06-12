import { DetailHeader } from '@beaconhs/ui'
import { REPORT_ENTITIES, REPORT_OPERATORS } from '@beaconhs/reports'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadDefinitionById } from '../../_definitions'
import { ReportStudio } from '../../_studio/studio.client'
import { createCustomDefinition } from '../../_studio/actions'

export const metadata = { title: 'New custom report' }

export default async function NewCustomDefinitionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  const sp = await searchParams
  const presetEntity = typeof sp.entity === 'string' ? sp.entity : null
  const cloneFromId = typeof sp.from === 'string' ? sp.from : null

  // Cloning: prefill the studio from the source definition. Built-ins have no
  // customQuery — the clone starts from the entity matching their category.
  const cloneFrom = cloneFromId ? await loadDefinitionById(ctx.tenantId!, cloneFromId) : null

  return (
    <PageContainer>
      <div className="space-y-6">
        <DetailHeader
          back={{ href: '/reports/definitions', label: 'Back to library' }}
          title={cloneFrom ? `Clone: ${cloneFrom.name}` : 'New custom report'}
          subtitle="Select a data source, columns, filters, and an optional chart."
        />
        <ReportStudio
          entities={REPORT_ENTITIES}
          operators={REPORT_OPERATORS}
          mode="create"
          initialName={cloneFrom ? `${cloneFrom.name} (copy)` : ''}
          initialDescription={cloneFrom?.description ?? ''}
          initialEntityKey={presetEntity}
          initialQuery={cloneFrom?.customQuery ?? null}
          cloneFromId={cloneFromId}
          action={createCustomDefinition}
        />
      </div>
    </PageContainer>
  )
}
