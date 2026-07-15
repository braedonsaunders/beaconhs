import { getGeneratedTranslations } from '@/i18n/generated.server'
import { notFound, redirect } from 'next/navigation'
import { DetailHeader } from '@beaconhs/ui'
import { REPORT_OPERATORS } from '@beaconhs/reports'
import { requireRequestContext } from '@/lib/auth'
import { DetailPageLayout } from '@/components/page-layout'
import { loadDefinitionById } from '../../../_definitions'
import { ReportStudio } from '../../../_studio/studio.client'
import { updateCustomDefinition } from '../../../_studio/actions'
import { loadReportStudioEntities } from '../../../_studio/entities'
import { isUuid } from '@/lib/list-params'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_186e85e2d4fd61') }
}
export const dynamic = 'force-dynamic'

export default async function EditCustomDefinitionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()

  const definition = await loadDefinitionById(ctx.tenantId!, id)
  if (!definition) notFound()
  // Built-ins are shared across tenants — editing one opens an editable copy.
  if (definition.kind !== 'custom' || definition.tenantId !== ctx.tenantId) {
    redirect(`/reports/definitions/new?from=${id}` as never)
  }

  const action = updateCustomDefinition.bind(null, id)
  const entities = await loadReportStudioEntities(ctx)

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: `/reports/definitions/${id}`, label: 'Back to report' }}
          title={tGenerated('m_1c5d935f08d2c3', { value0: definition.name })}
          subtitle={tGenerated('m_047089b0ab0adf')}
        />
      }
      className="h-full max-w-none p-0"
    >
      <ReportStudio
        entities={entities}
        operators={REPORT_OPERATORS}
        intent="edit"
        initialName={definition.name}
        initialDescription={definition.description ?? ''}
        initialQuery={definition.customQuery}
        initialLayout={definition.layout}
        action={action}
      />
    </DetailPageLayout>
  )
}
