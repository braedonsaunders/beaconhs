import { notFound, redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  DetailHeader,
  Input,
  Label,
  Select,
} from '@beaconhs/ui'
import { hazidAssessmentTypes, hazidAssessments, orgUnits, people } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { deleteAssessment, updateGeneral } from '../../_actions'

export const metadata = { title: 'Edit hazard assessment' }
export const dynamic = 'force-dynamic'

async function update(formData: FormData) {
  'use server'
  await updateGeneral(formData)
  const id = String(formData.get('id') ?? '')
  redirect(`/hazid/${id}`)
}

async function remove(formData: FormData) {
  'use server'
  await deleteAssessment(formData)
  redirect('/hazid')
}

export default async function EditHazidAssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(hazidAssessments)
      .where(eq(hazidAssessments.id, id))
      .limit(1)
    if (!row) return null
    const sites = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    const projects = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'project'))
      .orderBy(asc(orgUnits.name))
    const types = await tx
      .select({ id: hazidAssessmentTypes.id, name: hazidAssessmentTypes.name })
      .from(hazidAssessmentTypes)
      .orderBy(asc(hazidAssessmentTypes.name))
    const supervisors = await tx
      .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
      .from(people)
      .orderBy(asc(people.lastName))
    return { a: row, sites, projects, types, supervisors }
  })
  if (!data) notFound()
  const { a, sites, projects, types, supervisors } = data
  const occurredLocal = a.occurredAt
    ? new Date(new Date(a.occurredAt).getTime() - new Date().getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16)
    : ''

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: `/hazid/${id}`, label: 'Back to assessment' }}
          title="Edit assessment"
        />
        {a.locked ? (
          <Alert variant="warning">
            <AlertTitle>This assessment is locked</AlertTitle>
            <AlertDescription>
              Unlock from the detail page before editing. Existing signatures will be cleared.
            </AlertDescription>
          </Alert>
        ) : null}
        <Card>
          <CardContent className="pt-6">
            <form action={update} className="space-y-4">
              <input type="hidden" name="id" value={id} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Assessment type">
                  <Select
                    name="assessmentTypeId"
                    defaultValue={a.assessmentTypeId ?? ''}
                    disabled={a.locked}
                  >
                    <option value="">—</option>
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Occurred at" required>
                  <Input
                    name="occurredAt"
                    type="datetime-local"
                    defaultValue={occurredLocal}
                    disabled={a.locked}
                    required
                  />
                </Field>
                <Field label="Site">
                  <Select
                    name="siteOrgUnitId"
                    defaultValue={a.siteOrgUnitId ?? ''}
                    disabled={a.locked}
                  >
                    <option value="">—</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Project">
                  <Select
                    name="projectOrgUnitId"
                    defaultValue={a.projectOrgUnitId ?? ''}
                    disabled={a.locked}
                  >
                    <option value="">—</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Location on site" className="sm:col-span-2">
                  <Input
                    name="locationOnSite"
                    defaultValue={a.locationOnSite ?? ''}
                    disabled={a.locked}
                  />
                </Field>
                <Field label="Supervisor">
                  <Select
                    name="supervisorPersonId"
                    defaultValue={a.supervisorPersonId ?? ''}
                    disabled={a.locked}
                  >
                    <option value="">—</option>
                    {supervisors.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.lastName}, {p.firstName}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit" disabled={a.locked}>
                  Save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-sm font-semibold text-red-700">Danger zone</h2>
            <p className="text-xs text-slate-500">
              Soft-deletes the assessment. It can be restored later via the database.
            </p>
            <form action={remove}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" variant="outline" className="text-red-600 hover:bg-red-50">
                Delete assessment
              </Button>
            </form>
          </CardContent>
        </Card>
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
