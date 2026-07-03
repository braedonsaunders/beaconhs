// Server loader for everything the obligation form needs to render its pickers
// — target entities for every kind plus the audience option lists. Shared by
// the create and edit pages.

import { and, asc, eq, isNull, sql } from 'drizzle-orm'
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
} from '@beaconhs/db/schema'
import type { requireRequestContext } from '@/lib/auth'
import type { AudienceOptions } from '@/components/audience-picker'
import type { ObligationTargets } from './_obligation-form'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

export async function loadObligationFormOptions(
  ctx: Ctx,
): Promise<{ targets: ObligationTargets; audienceOptions: AudienceOptions }> {
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
      tx
        .select({ id: inspectionTypes.id, name: inspectionTypes.name })
        .from(inspectionTypes)
        .where(and(eq(inspectionTypes.isPublished, true), isNull(inspectionTypes.deletedAt)))
        .orderBy(asc(inspectionTypes.name)),
      tx
        .select({ id: documents.id, title: documents.title })
        .from(documents)
        .where(isNull(documents.deletedAt))
        .orderBy(asc(documents.title))
        .limit(500),
      tx
        .select({ id: trainingCourses.id, code: trainingCourses.code, name: trainingCourses.name })
        .from(trainingCourses)
        .where(isNull(trainingCourses.deletedAt))
        .orderBy(asc(trainingCourses.name)),
      tx
        .select({ id: trainingAssessmentTypes.id, name: trainingAssessmentTypes.name })
        .from(trainingAssessmentTypes)
        .where(isNull(trainingAssessmentTypes.deletedAt))
        .orderBy(asc(trainingAssessmentTypes.name)),
      tx
        .select({
          id: trainingSkillTypes.id,
          code: trainingSkillTypes.code,
          name: trainingSkillTypes.name,
        })
        .from(trainingSkillTypes)
        .orderBy(asc(trainingSkillTypes.name)),
      tx
        .select({ id: formTemplates.id, name: formTemplates.name })
        .from(formTemplates)
        .where(eq(formTemplates.status, 'published'))
        .orderBy(asc(formTemplates.name))
        .limit(500),
      tx.select({ key: roles.key, name: roles.name }).from(roles).orderBy(asc(roles.name)),
      tx.select({ id: trades.id, name: trades.name }).from(trades).orderBy(asc(trades.name)),
      tx
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .orderBy(asc(departments.name)),
      tx
        .select({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          jobTitle: people.jobTitle,
        })
        .from(people)
        .where(sql`${people.deletedAt} is null and ${people.status} = 'active'`)
        .orderBy(asc(people.lastName), asc(people.firstName))
        .limit(1000),
      tx
        .select({ id: orgUnits.id, name: orgUnits.name, level: orgUnits.level })
        .from(orgUnits)
        .where(isNull(orgUnits.deletedAt))
        .orderBy(asc(orgUnits.name)),
      tx
        .select({ id: equipmentTypes.id, name: equipmentTypes.name })
        .from(equipmentTypes)
        .orderBy(asc(equipmentTypes.name)),
      tx
        .select({ id: ppeTypes.id, name: ppeTypes.name })
        .from(ppeTypes)
        .orderBy(asc(ppeTypes.name)),
      tx
        .select({ id: personTitles.id, name: personTitles.name })
        .from(personTitles)
        .where(isNull(personTitles.deletedAt))
        .orderBy(asc(personTitles.name)),
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
      documents: data.docs.map((d) => ({ id: d.id, title: d.title })),
      courses: data.courses.map((c) => ({
        id: c.id,
        label: `${c.code ? c.code + ' · ' : ''}${c.name}`,
      })),
      assessmentTypes: data.assessmentTypes,
      skillTypes: data.skillTypes.map((s) => ({
        id: s.id,
        name: `${s.code ? s.code + ' · ' : ''}${s.name}`,
      })),
      formTemplates: data.templates,
      equipmentTypes: data.equipTypes,
      ppeTypes: data.ppeTypeRows,
      jobTitles: data.jobTitles,
    },
    audienceOptions: {
      roles: data.allRoles,
      trades: data.allTrades.map((t) => ({ id: t.id, label: t.name })),
      departments: data.allDepts.map((d) => ({ id: d.id, label: d.name })),
      people: data.allPeople.map((p) => ({
        id: p.id,
        label:
          `${p.lastName ?? ''}${p.lastName ? ', ' : ''}${p.firstName ?? ''}`.trim() || '(unnamed)',
        sub: p.jobTitle ?? undefined,
      })),
      orgUnits: data.allOrgUnits
        .filter((o) => o.level === 'site' || o.level === 'project')
        .map((o) => ({ id: o.id, label: `${o.name} (${o.level})` })),
    },
  }
}
