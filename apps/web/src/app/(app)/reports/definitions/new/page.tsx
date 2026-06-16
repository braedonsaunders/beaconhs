import { DetailHeader } from '@beaconhs/ui'
import { REPORT_OPERATORS } from '@beaconhs/reports'
import { discoverEntities } from '@beaconhs/analytics/server'
import { requireRequestContext } from '@/lib/auth'
import { DetailPageLayout } from '@/components/page-layout'
import { loadDefinitionById } from '../../_definitions'
import { ReportStudio } from '../../_studio/studio.client'
import { createCustomDefinition } from '../../_studio/actions'
import { builtInSeedQuery } from '../../_studio/built-in-seed'

export const metadata = { title: 'New report' }
export const dynamic = 'force-dynamic'

export default async function NewCustomDefinitionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  const sp = await searchParams
  const presetEntity = typeof sp.entity === 'string' ? sp.entity : null
  const cloneFromId = typeof sp.from === 'string' ? sp.from : null

  // Cloning / edit-a-copy: prefill from the source definition. Built-ins have no
  // customQuery, so derive a starter from their queryKind.
  const cloneFrom = cloneFromId ? await loadDefinitionById(ctx.tenantId!, cloneFromId) : null
  const seed = cloneFrom ? (cloneFrom.customQuery ?? builtInSeedQuery(cloneFrom.queryKind)) : null

  const entities = discoverEntities()

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/reports/definitions', label: 'Back to library' }}
          title={cloneFrom ? `Edit a copy of "${cloneFrom.name}"` : 'New report'}
          subtitle="Choose a data source, shape the data, and add an optional chart."
        />
      }
      className="h-full max-w-none p-0"
    >
      <ReportStudio
        entities={entities}
        operators={REPORT_OPERATORS}
        intent="create"
        initialName={cloneFrom ? `${cloneFrom.name} (copy)` : ''}
        initialDescription={cloneFrom?.description ?? ''}
        initialEntityKey={presetEntity ?? seed?.entity ?? null}
        initialQuery={seed}
        cloneFromId={cloneFromId}
        action={createCustomDefinition}
      />
    </DetailPageLayout>
  )
}
