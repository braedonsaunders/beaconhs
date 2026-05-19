import { Card, CardContent, DetailHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { BUILDER_ENTITIES, BUILDER_OPERATORS } from '../_builder-meta'
import { CustomReportBuilder } from './builder.client'
import { createCustomDefinition } from './actions'

export const metadata = { title: 'New custom report' }

export default async function NewCustomDefinitionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRequestContext()
  const sp = await searchParams
  const presetEntity = typeof sp.entity === 'string' ? sp.entity : null
  const cloneFromId = typeof sp.from === 'string' ? sp.from : null

  return (
    <PageContainer>
      <div className="max-w-4xl space-y-6">
        <DetailHeader
          back={{ href: '/reports/definitions', label: 'Back to definitions' }}
          title="Build a custom report"
          subtitle="Pick a module, choose the columns and filters you care about, then save as a reusable definition."
        />

        <Card>
          <CardContent className="pt-6">
            <CustomReportBuilder
              entities={BUILDER_ENTITIES}
              operators={BUILDER_OPERATORS}
              initialEntityKey={presetEntity}
              cloneFromId={cloneFromId}
              action={createCustomDefinition}
            />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
