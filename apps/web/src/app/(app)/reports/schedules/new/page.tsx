import { assertCan } from '@beaconhs/tenant'
import { PageHeader } from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { requireRequestContext } from '@/lib/auth'
import { loadScheduleFormData } from '../_data'
import { BeaconScheduleForm } from '../_schedule-form'

export default async function NewSchedulePage() {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.schedule')
  const { definitions, members } = await loadScheduleFormData(ctx)
  return (
    <PageContainer className="space-y-4">
      <PageHeader
        title={tGenerated('m_038dda15ecaf4d')}
        description={tGenerated('m_07cce0ffc77126')}
      />
      <BeaconScheduleForm
        scheduleId={null}
        definitions={definitions}
        members={members}
        defaultTimezone="America/Toronto"
      />
    </PageContainer>
  )
}
