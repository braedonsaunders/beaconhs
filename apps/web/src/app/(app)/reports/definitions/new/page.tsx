import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'
import { DetailHeader } from '@beaconhs/ui'
import { redirect } from 'next/navigation'
import { REPORT_OPERATORS } from '@beaconhs/reports'
import { requireRequestContext } from '@/lib/auth'
import { DetailPageLayout } from '@/components/page-layout'
import { loadDefinitionById } from '../../_definitions'
import { ReportStudio } from '../../_studio/studio.client'
import { createCustomDefinition } from '../../_studio/actions'
import { loadReportStudioEntities } from '../../_studio/entities'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_084b76c7fa79df') }
}
export const dynamic = 'force-dynamic'

export default async function NewCustomDefinitionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  const sp = await searchParams
  const presetEntity = typeof sp.entity === 'string' ? sp.entity : null
  const cloneFromId = typeof sp.from === 'string' ? sp.from : null

  const requestedClone = cloneFromId ? await loadDefinitionById(ctx.tenantId!, cloneFromId) : null
  if (requestedClone?.kind === 'built_in') {
    redirect(`/reports/definitions/${requestedClone.id}` as never)
  }
  const cloneFrom = requestedClone?.kind === 'custom' ? requestedClone : null
  const seed = cloneFrom?.customQuery ?? null

  const entities = await loadReportStudioEntities(ctx)

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/reports', label: 'Back to reports' }}
          title={tGeneratedValue(
            cloneFrom
              ? tGenerated('m_06ac1201e04b80', { value0: cloneFrom.name })
              : tGenerated('m_084b76c7fa79df'),
          )}
          subtitle={tGenerated('m_0fb456e5417b3a')}
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
        initialLayout={cloneFrom?.layout ?? null}
        cloneFromId={cloneFromId}
        action={createCustomDefinition}
      />
    </DetailPageLayout>
  )
}
