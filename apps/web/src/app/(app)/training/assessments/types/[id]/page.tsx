import { notFound } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { Badge, DetailHeader } from '@beaconhs/ui'
import {
  trainingAssessmentTypeQuestions,
  trainingAssessmentTypes,
  trainingCourses,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { DetailPageLayout } from '@/components/page-layout'
import { ActivityFeed } from '@/components/activity-feed'
import { recentActivityForEntity } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { getGeneratedTranslations, getGeneratedValueTranslations } from '@/i18n/generated.server'
import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { TrainingAssessmentTypeBuilder } from './_type-builder'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_05ffde9a79802e', { value0: id.slice(0, 8) }) }
}

export default async function AssessmentTypeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const ctx = await requireModuleManage('training')
  const data = await ctx.db(async (tx) => {
    const [type] = await tx
      .select()
      .from(trainingAssessmentTypes)
      .where(eq(trainingAssessmentTypes.id, id))
      .limit(1)
    if (!type) return null
    const [questions, courses] = await Promise.all([
      tx
        .select()
        .from(trainingAssessmentTypeQuestions)
        .where(eq(trainingAssessmentTypeQuestions.typeId, id))
        .orderBy(asc(trainingAssessmentTypeQuestions.entityOrder)),
      tx
        .select({ id: trainingCourses.id, name: trainingCourses.name, code: trainingCourses.code })
        .from(trainingCourses)
        .orderBy(asc(trainingCourses.name)),
    ])
    return { type, questions, courses }
  })
  if (!data) notFound()
  const activity = await recentActivityForEntity(ctx, 'training_assessment_type', id, 50)
  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/training/assessments/types', label: 'Back to assessment types' }}
          title={tGeneratedValue(data.type.name)}
          badge={
            <Badge variant={data.type.active ? 'success' : 'secondary'}>
              <GeneratedValue
                value={
                  data.type.active ? (
                    <GeneratedText id="m_1e1b1fdb7dd78e" />
                  ) : (
                    <GeneratedText id="m_0f47ea07c99dba" />
                  )
                }
              />
            </Badge>
          }
        />
      }
      className="h-full max-w-none p-0"
    >
      <TrainingAssessmentTypeBuilder
        key={data.questions
          .map(
            (question) =>
              `${question.id}:${question.entityOrder}:${question.updatedAt.toISOString()}`,
          )
          .join('|')}
        type={{
          id: data.type.id,
          name: data.type.name,
          description: data.type.description,
          passingScore: data.type.passingScore,
          courseId: data.type.courseId,
          preAssessmentMessage: data.type.preAssessmentMessage,
          postAssessmentMessage: data.type.postAssessmentMessage,
          graded: data.type.graded,
          active: data.type.active,
        }}
        courses={data.courses}
        questions={data.questions}
        activitySlot={
          <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
        }
      />
    </DetailPageLayout>
  )
}
