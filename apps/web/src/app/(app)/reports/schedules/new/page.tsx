import { notFound, redirect } from 'next/navigation'
import { Card, CardContent, DetailHeader } from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadScheduleFormData } from '../_data'
import { ScheduleForm } from '../_schedule-form'
import { createSchedule } from './actions'

export const metadata = { title: 'Subscribe to report' }

export default async function NewSchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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
          title={preset ? `Subscribe to ${preset.name}` : 'Subscribe to a report'}
          subtitle="Delivers the report as a PDF email on a recurring schedule."
        />
        <Card>
          <CardContent className="pt-6">
            <ScheduleForm
              definitions={definitions}
              members={members}
              initial={preset ? { definitionId: preset.id } : undefined}
              submitLabel="Create schedule"
              action={createSchedule}
            />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
