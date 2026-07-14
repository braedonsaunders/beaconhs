import { notFound } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { Badge, DetailHeader } from '@beaconhs/ui'
import {
  formTemplates,
  hazidAssessmentTypeApps,
  hazidAssessmentTypePPE,
  hazidAssessmentTypeQuestions,
  hazidAssessmentTypes,
  hazidHazardSets,
  personGroups,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { DetailPageLayout } from '@/components/page-layout'
import { isUuid } from '@/lib/list-params'
import { HazardTypeBuilder } from './_type-builder'

export const dynamic = 'force-dynamic'

function styleLabel(style: 'task_based' | 'hazard_based') {
  return style === 'hazard_based' ? 'Hazard-based' : 'Task-based'
}

export default async function AssessmentTypeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireModuleManage('hazid')
  const data = await ctx.db(async (tx) => {
    const [type] = await tx
      .select()
      .from(hazidAssessmentTypes)
      .where(and(eq(hazidAssessmentTypes.id, id), isNull(hazidAssessmentTypes.deletedAt)))
      .limit(1)
    if (!type) return null
    const ppe = await tx
      .select({
        id: hazidAssessmentTypePPE.id,
        name: hazidAssessmentTypePPE.name,
        description: hazidAssessmentTypePPE.description,
        required: hazidAssessmentTypePPE.required,
        entityOrder: hazidAssessmentTypePPE.entityOrder,
      })
      .from(hazidAssessmentTypePPE)
      .where(eq(hazidAssessmentTypePPE.typeId, id))
      .orderBy(asc(hazidAssessmentTypePPE.entityOrder))
    const questions = await tx
      .select({
        id: hazidAssessmentTypeQuestions.id,
        question: hazidAssessmentTypeQuestions.question,
        questionType: hazidAssessmentTypeQuestions.questionType,
        answers: hazidAssessmentTypeQuestions.answers,
        requiresYes: hazidAssessmentTypeQuestions.requiresYes,
        entityOrder: hazidAssessmentTypeQuestions.entityOrder,
      })
      .from(hazidAssessmentTypeQuestions)
      .where(eq(hazidAssessmentTypeQuestions.typeId, id))
      .orderBy(asc(hazidAssessmentTypeQuestions.entityOrder))
    const apps = await tx
      .select({
        id: hazidAssessmentTypeApps.id,
        label: hazidAssessmentTypeApps.label,
        key: hazidAssessmentTypeApps.key,
        description: hazidAssessmentTypeApps.description,
        required: hazidAssessmentTypeApps.required,
        autoCreate: hazidAssessmentTypeApps.autoCreate,
        entityOrder: hazidAssessmentTypeApps.entityOrder,
        templateName: formTemplates.name,
      })
      .from(hazidAssessmentTypeApps)
      .innerJoin(formTemplates, eq(formTemplates.id, hazidAssessmentTypeApps.templateId))
      .where(and(eq(hazidAssessmentTypeApps.typeId, id), isNull(hazidAssessmentTypeApps.deletedAt)))
      .orderBy(asc(hazidAssessmentTypeApps.entityOrder))
    const appTemplates = await tx
      .select({ id: formTemplates.id, name: formTemplates.name })
      .from(formTemplates)
      .where(and(eq(formTemplates.status, 'published'), isNull(formTemplates.deletedAt)))
      .orderBy(asc(formTemplates.name))
    const hazardSets = await tx
      .select({ id: hazidHazardSets.id, name: hazidHazardSets.name })
      .from(hazidHazardSets)
      .orderBy(asc(hazidHazardSets.name))
    const groups = await tx
      .select({ id: personGroups.id, name: personGroups.name })
      .from(personGroups)
      .where(isNull(personGroups.deletedAt))
      .orderBy(asc(personGroups.name))
    return { type, ppe, questions, apps, appTemplates, hazardSets, groups }
  })
  if (!data) notFound()
  const { type, ppe, questions, apps, appTemplates, hazardSets, groups } = data

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/hazard-assessments/types', label: 'Back' }}
          title={type.name}
          badge={
            <div className="flex flex-wrap items-center gap-1">
              <Badge variant="secondary">{styleLabel(type.style)}</Badge>
              {type.hasPPE ? <Badge variant="secondary">PPE</Badge> : null}
              {type.hasQuestions ? <Badge variant="secondary">Q&amp;A</Badge> : null}
            </div>
          }
        />
      }
      className="h-full max-w-none p-0"
    >
      <HazardTypeBuilder
        type={{
          id: type.id,
          name: type.name,
          description: type.description,
          style: type.style,
          defaultHazardSetId: type.defaultHazardSetId,
          hasPPE: type.hasPPE,
          hasQuestions: type.hasQuestions,
          availableToGroupIds: type.availableToGroupIds ?? [],
        }}
        ppe={ppe}
        questions={questions}
        apps={apps}
        appTemplates={appTemplates}
        hazardSets={hazardSets}
        groups={groups}
      />
    </DetailPageLayout>
  )
}
