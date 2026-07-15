import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirect } from 'next/navigation'
import { asc, isNull } from 'drizzle-orm'
import { DetailHeader } from '@beaconhs/ui'
import { hazidHazardSets, personGroups } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { PageContainer } from '@/components/page-layout'
import { createAssessmentType } from '../../_actions'
import { NewAssessmentTypeForm } from './_new-type-form'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1d23e917eeb2e4') }
}
export const dynamic = 'force-dynamic'

async function submit(formData: FormData) {
  'use server'
  await createAssessmentType(formData)
  redirect('/hazard-assessments/types')
}

export default async function NewAssessmentTypePage() {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireModuleManage('hazid')
  const { sets, groups } = await ctx.db(async (tx) => {
    const sets = await tx
      .select({ id: hazidHazardSets.id, name: hazidHazardSets.name })
      .from(hazidHazardSets)
      .orderBy(asc(hazidHazardSets.name))
    const groups = await tx
      .select({ id: personGroups.id, name: personGroups.name })
      .from(personGroups)
      .where(isNull(personGroups.deletedAt))
      .orderBy(asc(personGroups.name))
    return { sets, groups }
  })
  return (
    <PageContainer>
      <div className="max-w-2xl space-y-6">
        <DetailHeader
          back={{ href: '/hazard-assessments/types', label: 'Back' }}
          title={tGenerated('m_1d23e917eeb2e4')}
        />
        <NewAssessmentTypeForm sets={sets} groups={groups} action={submit} />
      </div>
    </PageContainer>
  )
}
