import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'
import { notFound, redirect } from 'next/navigation'
import { Card, CardContent, DetailHeader } from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadScheduleFormData } from '../_data'
import { ScheduleForm } from '../_schedule-form'
import { createSchedule } from './actions'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_029449419e6ed5') }
}

export default async function NewSchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  if (!can(ctx, 'reports.schedule')) redirect('/reports/schedules')
  const sp = await searchParams
  const presetDefinitionId = typeof sp.definitionId === 'string' ? sp.definitionId : undefined

  const { definitions, members } = await loadScheduleFormData(ctx)
  if (definitions.length === 0) notFound()
  const preset = definitions.find((d) => d.id === presetDefinitionId)

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={
            preset
              ? { href: `/reports/definitions/${preset.id}`, label: `Back to ${preset.name}` }
              : { href: '/reports/schedules', label: 'Back to schedules' }
          }
          title={tGeneratedValue(
            preset
              ? tGenerated('m_1a2df4b944122f', { value0: preset.name })
              : tGenerated('m_1919496659d390'),
          )}
          subtitle={tGenerated('m_1139008657c692')}
        />
        <Card>
          <CardContent className="pt-6">
            <ScheduleForm
              definitions={definitions}
              members={members}
              initial={preset ? { definitionId: preset.id } : undefined}
              submitLabel={tGenerated('m_1c516d834dca35')}
              action={createSchedule}
            />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
