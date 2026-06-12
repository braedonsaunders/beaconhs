import { notFound, redirect } from 'next/navigation'
import { DetailHeader } from '@beaconhs/ui'
import { REPORT_ENTITIES, REPORT_OPERATORS } from '@beaconhs/reports'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadDefinitionById } from '../../../_definitions'
import { ReportStudio } from '../../../_studio/studio.client'
import { updateCustomDefinition } from '../../../_studio/actions'

export const metadata = { title: 'Edit report' }

export default async function EditCustomDefinitionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const definition = await loadDefinitionById(ctx.tenantId!, id)
  if (!definition) notFound()
  // Built-ins are read-only — clone instead.
  if (definition.kind !== 'custom' || definition.tenantId !== ctx.tenantId) {
    redirect(`/reports/definitions/new?from=${id}` as never)
  }

  const action = updateCustomDefinition.bind(null, id)

  return (
    <PageContainer>
      <div className="space-y-6">
        <DetailHeader
          back={{ href: `/reports/definitions/${id}`, label: 'Back to report' }}
          title={`Edit: ${definition.name}`}
          subtitle="Changes apply to every schedule subscribed to this report."
        />
        <ReportStudio
          entities={REPORT_ENTITIES}
          operators={REPORT_OPERATORS}
          mode="edit"
          initialName={definition.name}
          initialDescription={definition.description ?? ''}
          initialQuery={definition.customQuery}
          action={action}
        />
      </div>
    </PageContainer>
  )
}
