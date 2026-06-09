import { asc, eq, isNull, sql } from 'drizzle-orm'
import { PageHeader } from '@beaconhs/ui'
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
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCan } from '@beaconhs/tenant'
import { PageContainer } from '@/components/page-layout'
import { pickString } from '@/lib/list-params'
import { ObligationForm } from './_obligation-form'
import { OBLIGATION_KINDS, type ObligationKind } from '../_meta'

export const metadata = { title: 'New obligation' }
export const dynamic = 'force-dynamic'

export default async function NewObligationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.assign')
  const sp = await searchParams
  const rawKind = pickString(sp.kind)
  const initialKind: ObligationKind = OBLIGATION_KINDS.includes(rawKind as ObligationKind)
    ? (rawKind as ObligationKind)
    : 'inspection'

  const data = await ctx.db(async (tx) => {
    const [
      inspTypes,
      docs,
      courses,
      assessmentTypes,
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
        .where(eq(inspectionTypes.isPublished, true))
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
        .orderBy(asc(trainingCourses.name)),
      tx
        .select({ id: trainingAssessmentTypes.id, name: trainingAssessmentTypes.name })
        .from(trainingAssessmentTypes)
        .where(isNull(trainingAssessmentTypes.deletedAt))
        .orderBy(asc(trainingAssessmentTypes.name)),
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
      tx.select({ id: ppeTypes.id, name: ppeTypes.name }).from(ppeTypes).orderBy(asc(ppeTypes.name)),
      tx
        .select({ id: personTitles.id, name: personTitles.name })
        .from(personTitles)
        .orderBy(asc(personTitles.name)),
    ])
    return {
      inspTypes,
      docs,
      courses,
      assessmentTypes,
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

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="New obligation"
          description="Pick a kind, choose the thing to require, the audience, and the cadence. One form for every compliance obligation."
          back={{ href: '/compliance/obligations', label: 'Back to obligations' }}
        />
        <ObligationForm
          initialKind={initialKind}
          targets={{
            inspectionTypes: data.inspTypes,
            documents: data.docs.map((d) => ({ id: d.id, title: d.title })),
            courses: data.courses.map((c) => ({
              id: c.id,
              label: `${c.code ? c.code + ' · ' : ''}${c.name}`,
            })),
            assessmentTypes: data.assessmentTypes,
            formTemplates: data.templates,
            equipmentTypes: data.equipTypes,
            ppeTypes: data.ppeTypeRows,
            jobTitles: data.jobTitles,
          }}
          audienceOptions={{
            roles: data.allRoles,
            trades: data.allTrades.map((t) => ({ id: t.id, label: t.name })),
            departments: data.allDepts.map((d) => ({ id: d.id, label: d.name })),
            people: data.allPeople.map((p) => ({
              id: p.id,
              label: `${p.lastName ?? ''}${p.lastName ? ', ' : ''}${p.firstName ?? ''}`.trim() || '(unnamed)',
              sub: p.jobTitle ?? undefined,
            })),
            orgUnits: data.allOrgUnits
              .filter((o) => o.level === 'site' || o.level === 'project')
              .map((o) => ({ id: o.id, label: `${o.name} (${o.level})` })),
          }}
        />
      </div>
    </PageContainer>
  )
}
