import { redirect } from 'next/navigation'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import {
  Button,
  Card,
  CardContent,
  DetailHeader,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import {
  hazidAssessmentTypes,
  hazidAssessments,
  orgUnits,
  people,
  personGroupMemberships,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { PersonSelectField } from '@/components/person-select-field'
import { createAssessment } from '../_actions'
import { localDatetimeValue } from '../_datetime'
import { TypePicker, type TypeCard } from './_type-picker'

export const metadata = { title: 'New hazard assessment' }
export const dynamic = 'force-dynamic'

async function submit(formData: FormData) {
  'use server'
  const { id } = await createAssessment(formData)
  redirect(`/hazard-assessments/${id}`)
}

export default async function NewHazardAssessmentPage() {
  const ctx = await requireRequestContext()
  const { sites, projects, types, supervisors, recents } = await ctx.db(async (tx) => {
    const sites = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    const projects = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      // active jobs only (archived/closed jobs are not selectable for a new assessment)
      .where(and(eq(orgUnits.level, 'project'), isNull(orgUnits.deletedAt)))
      .orderBy(asc(orgUnits.name))

    const allTypes = await tx
      .select()
      .from(hazidAssessmentTypes)
      .where(isNull(hazidAssessmentTypes.deletedAt))
      .orderBy(asc(hazidAssessmentTypes.name))

    // Legacy AvailableTo parity: a type with group restrictions is only
    // offered to members of those groups. Empty restriction = everyone.
    const restricted = allTypes.some((t) => (t.availableToGroupIds ?? []).length > 0)
    let myGroupIds = new Set<string>()
    if (restricted) {
      const [me] = await tx
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.userId, ctx.userId), isNull(people.deletedAt)))
        .limit(1)
      if (me) {
        const memberships = await tx
          .select({ groupId: personGroupMemberships.groupId })
          .from(personGroupMemberships)
          .where(eq(personGroupMemberships.personId, me.id))
        myGroupIds = new Set(memberships.map((m) => m.groupId))
      }
    }
    const types = allTypes.filter((t) => {
      const allow = t.availableToGroupIds ?? []
      if (allow.length === 0) return true
      if (ctx.isSuperAdmin) return true
      return allow.some((g) => myGroupIds.has(g))
    })

    const supervisors = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
      })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
    const recents = await tx
      .select({
        id: hazidAssessments.id,
        reference: hazidAssessments.reference,
        jobScope: hazidAssessments.jobScope,
        occurredAt: hazidAssessments.occurredAt,
      })
      .from(hazidAssessments)
      .where(isNull(hazidAssessments.deletedAt))
      .orderBy(desc(hazidAssessments.occurredAt))
      .limit(15)
    return { sites, projects, types, supervisors, recents }
  })

  const nowLocal = localDatetimeValue()
  const typeCards: TypeCard[] = types.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    style: t.style,
    hasTasks: t.hasTasks,
    hasHazards: t.hasHazards,
    hasPPE: t.hasPPE,
    hasQuestions: t.hasQuestions,
  }))

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/hazard-assessments', label: 'Back to assessments' }}
          title="New hazard assessment"
          subtitle="Pick the type, say where and when — PPE, questions, and site-default tasks are seeded automatically."
        />
        <form action={submit} className="space-y-6">
          <Card>
            <CardContent className="space-y-3 pt-6">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  1 · Assessment type
                </h2>
                <p className="text-xs text-slate-500">
                  The type decides which sections appear and what gets pre-filled.
                </p>
              </div>
              <TypePicker types={typeCards} name="assessmentTypeId" />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  2 · Job context
                </h2>
                <p className="text-xs text-slate-500">Where the work happens and who runs it.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Occurred at" required>
                  <Input name="occurredAt" type="datetime-local" required defaultValue={nowLocal} />
                </Field>
                <Field label="Supervisor">
                  <PersonSelectField
                    name="supervisorPersonId"
                    defaultValue=""
                    options={supervisors.map((p) => ({
                      value: p.id,
                      label: `${p.lastName}, ${p.firstName}`,
                      hint: p.employeeNo ?? undefined,
                    }))}
                    placeholder="Select a supervisor…"
                    clearable
                    emptyLabel="—"
                  />
                </Field>
                <Field label="Site">
                  <Select name="siteOrgUnitId" defaultValue="">
                    <option value="">—</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Project">
                  <Select name="projectOrgUnitId" defaultValue="">
                    <option value="">—</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Location on site" className="sm:col-span-2">
                  <Input name="locationOnSite" placeholder="Building / area / equipment label" />
                </Field>
                <Field label="Job scope (short summary)" className="sm:col-span-2">
                  <Textarea
                    name="jobScope"
                    rows={3}
                    placeholder="What is the work? E.g. tank entry to replace gasket."
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  3 · Start from an earlier assessment{' '}
                  <span className="font-normal text-slate-400">(optional)</span>
                </h2>
                <p className="text-xs text-slate-500">
                  Copies its tasks, hazards, PPE list, and questions. Signatures, photos, and
                  embedded app responses always start fresh.
                </p>
              </div>
              <Select name="copyFromId" defaultValue="">
                <option value="">Start blank</option>
                {recents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.reference} · {new Date(a.occurredAt).toLocaleDateString()}
                    {a.jobScope ? ` · ${a.jobScope.slice(0, 60)}` : ''}
                  </option>
                ))}
              </Select>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-2">
            <Button type="submit">Create assessment</Button>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
