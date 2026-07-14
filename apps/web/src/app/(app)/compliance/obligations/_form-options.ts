// Immediate label hydration for the obligation form's persisted selections.
// Candidate catalogues are searched through purpose-scoped picker API branches,
// so this server loader deliberately queries only values already selected.

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  departments,
  documents,
  equipmentTypes,
  formTemplates,
  inspectionTypes,
  orgUnits,
  people,
  personTitles,
  ppeTypes,
  roles,
  trades,
  trainingAssessmentTypes,
  trainingCourses,
  trainingSkillTypes,
  type ComplianceTargetRef,
} from '@beaconhs/db/schema'
import { primaryPersonTitleName } from '@beaconhs/db'
import type { requireRequestContext } from '@/lib/auth'
import { getEffectiveRoleKeys } from '@/lib/effective-roles'
import { isUuid } from '@/lib/list-params'
import type { AudienceItem, AudienceOptions } from '@/components/audience-picker'
import { templateAccessWhere } from '../../apps/_lib/access'
import type { ObligationTargets } from './_obligation-form'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

type ObligationFormSelection = {
  targetRef?: ComplianceTargetRef
  audience?: readonly AudienceItem[]
}

function audienceKeys(audience: readonly AudienceItem[], type: AudienceItem['type']): string[] {
  return [
    ...new Set(
      audience
        .filter((item) => item.type === type)
        .map((item) => item.entityKey.trim())
        .filter(Boolean),
    ),
  ]
}

export async function loadObligationFormOptions(
  ctx: Ctx,
  selection: ObligationFormSelection = {},
): Promise<{ targets: ObligationTargets; audienceOptions: AudienceOptions }> {
  const ref = selection.targetRef ?? {}
  const audience = selection.audience ?? []
  const effectiveRoleKeys = await getEffectiveRoleKeys(ctx)

  const inspectionTypeId = isUuid(ref.inspectionTypeId ?? '') ? ref.inspectionTypeId! : null
  const documentId = isUuid(ref.documentId ?? '') ? ref.documentId! : null
  const courseId = isUuid(ref.courseId ?? '') ? ref.courseId! : null
  const assessmentTypeId = isUuid(ref.assessmentTypeId ?? '') ? ref.assessmentTypeId! : null
  const skillTypeId = isUuid(ref.skillTypeId ?? '') ? ref.skillTypeId! : null
  const formTemplateId = isUuid(ref.formTemplateId ?? '') ? ref.formTemplateId! : null
  const equipmentTypeId = isUuid(ref.equipmentTypeId ?? '') ? ref.equipmentTypeId! : null
  const ppeTypeId = isUuid(ref.ppeTypeId ?? '') ? ref.ppeTypeId! : null
  const jobTitleId = isUuid(ref.jobTitleId ?? '') ? ref.jobTitleId! : null

  const roleKeys = audienceKeys(audience, 'role')
  const tradeIds = audienceKeys(audience, 'trade').filter(isUuid)
  const departmentIds = audienceKeys(audience, 'department').filter(isUuid)
  const personIds = audienceKeys(audience, 'person').filter(isUuid)
  const orgUnitIds = audienceKeys(audience, 'org_unit').filter(isUuid)

  const data = await ctx.db(async (tx) => {
    const [
      inspTypes,
      docs,
      courses,
      assessmentTypes,
      skillTypes,
      templates,
      allRoles,
      allTrades,
      allDepts,
      allPeople,
      allOrgUnits,
      equipTypes,
      ppeTypeRows,
      jobTitles,
    ] = await Promise.all([
      inspectionTypeId
        ? tx
            .select({ id: inspectionTypes.id, name: inspectionTypes.name })
            .from(inspectionTypes)
            .where(
              and(
                eq(inspectionTypes.id, inspectionTypeId),
                eq(inspectionTypes.isPublished, true),
                isNull(inspectionTypes.deletedAt),
              ),
            )
        : Promise.resolve([]),
      documentId
        ? tx
            .select({ id: documents.id, title: documents.title })
            .from(documents)
            .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
        : Promise.resolve([]),
      courseId
        ? tx
            .select({
              id: trainingCourses.id,
              code: trainingCourses.code,
              name: trainingCourses.name,
            })
            .from(trainingCourses)
            .where(and(eq(trainingCourses.id, courseId), isNull(trainingCourses.deletedAt)))
        : Promise.resolve([]),
      assessmentTypeId
        ? tx
            .select({ id: trainingAssessmentTypes.id, name: trainingAssessmentTypes.name })
            .from(trainingAssessmentTypes)
            .where(
              and(
                eq(trainingAssessmentTypes.id, assessmentTypeId),
                isNull(trainingAssessmentTypes.deletedAt),
              ),
            )
        : Promise.resolve([]),
      skillTypeId
        ? tx
            .select({
              id: trainingSkillTypes.id,
              code: trainingSkillTypes.code,
              name: trainingSkillTypes.name,
            })
            .from(trainingSkillTypes)
            .where(eq(trainingSkillTypes.id, skillTypeId))
        : Promise.resolve([]),
      formTemplateId
        ? tx
            .select({ id: formTemplates.id, name: formTemplates.name })
            .from(formTemplates)
            .where(
              and(
                eq(formTemplates.id, formTemplateId),
                templateAccessWhere(ctx, effectiveRoleKeys, 'operate'),
              ),
            )
        : Promise.resolve([]),
      roleKeys.length > 0
        ? tx
            .select({ key: roles.key, name: roles.name })
            .from(roles)
            .where(inArray(roles.key, roleKeys))
        : Promise.resolve([]),
      tradeIds.length > 0
        ? tx
            .select({ id: trades.id, name: trades.name })
            .from(trades)
            .where(inArray(trades.id, tradeIds))
        : Promise.resolve([]),
      departmentIds.length > 0
        ? tx
            .select({ id: departments.id, name: departments.name })
            .from(departments)
            .where(inArray(departments.id, departmentIds))
        : Promise.resolve([]),
      personIds.length > 0
        ? tx
            .select({
              id: people.id,
              firstName: people.firstName,
              lastName: people.lastName,
              jobTitle: primaryPersonTitleName(people.id, people.tenantId),
            })
            .from(people)
            .where(
              and(
                inArray(people.id, personIds),
                sql`${people.deletedAt} is null and ${people.status} = 'active'`,
              ),
            )
        : Promise.resolve([]),
      orgUnitIds.length > 0
        ? tx
            .select({ id: orgUnits.id, name: orgUnits.name, level: orgUnits.level })
            .from(orgUnits)
            .where(
              and(
                inArray(orgUnits.id, orgUnitIds),
                isNull(orgUnits.deletedAt),
                sql`${orgUnits.level} in ('site', 'project')`,
              ),
            )
        : Promise.resolve([]),
      equipmentTypeId
        ? tx
            .select({ id: equipmentTypes.id, name: equipmentTypes.name })
            .from(equipmentTypes)
            .where(eq(equipmentTypes.id, equipmentTypeId))
        : Promise.resolve([]),
      ppeTypeId
        ? tx
            .select({ id: ppeTypes.id, name: ppeTypes.name })
            .from(ppeTypes)
            .where(eq(ppeTypes.id, ppeTypeId))
        : Promise.resolve([]),
      jobTitleId
        ? tx
            .select({ id: personTitles.id, name: personTitles.name })
            .from(personTitles)
            .where(and(eq(personTitles.id, jobTitleId), isNull(personTitles.deletedAt)))
        : Promise.resolve([]),
    ])
    return {
      inspTypes,
      docs,
      courses,
      assessmentTypes,
      skillTypes,
      templates,
      allRoles,
      allTrades,
      allDepts,
      allPeople,
      allOrgUnits,
      equipTypes,
      ppeTypeRows,
      jobTitles,
    }
  })

  return {
    targets: {
      inspectionTypes: data.inspTypes,
      documents: data.docs.map((document) => ({ id: document.id, title: document.title })),
      courses: data.courses.map((course) => ({
        id: course.id,
        label: `${course.code ? `${course.code} · ` : ''}${course.name}`,
      })),
      assessmentTypes: data.assessmentTypes,
      skillTypes: data.skillTypes.map((skillType) => ({
        id: skillType.id,
        name: `${skillType.code ? `${skillType.code} · ` : ''}${skillType.name}`,
      })),
      formTemplates: data.templates,
      equipmentTypes: data.equipTypes,
      ppeTypes: data.ppeTypeRows,
      jobTitles: data.jobTitles,
    },
    audienceOptions: {
      roles: data.allRoles,
      trades: data.allTrades.map((trade) => ({ id: trade.id, label: trade.name })),
      departments: data.allDepts.map((department) => ({
        id: department.id,
        label: department.name,
      })),
      people: data.allPeople.map((person) => ({
        id: person.id,
        label:
          `${person.lastName ?? ''}${person.lastName ? ', ' : ''}${person.firstName ?? ''}`.trim() ||
          '(unnamed)',
        sub: person.jobTitle ?? undefined,
      })),
      orgUnits: data.allOrgUnits.map((orgUnit) => ({
        id: orgUnit.id,
        label: `${orgUnit.name} (${orgUnit.level})`,
      })),
    },
  }
}
