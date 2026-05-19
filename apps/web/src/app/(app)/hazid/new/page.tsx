import { redirect } from 'next/navigation'
import { asc, desc, eq } from 'drizzle-orm'
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
  Textarea,
} from '@beaconhs/ui'
import {
  hazidAssessmentTypes,
  hazidAssessments,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { createAssessment } from '../_actions'

export const metadata = { title: 'New hazard assessment' }
export const dynamic = 'force-dynamic'

async function submit(formData: FormData) {
  'use server'
  const { id } = await createAssessment(formData)
  redirect(`/hazid/${id}`)
}

export default async function NewHazidAssessmentPage() {
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
      .where(eq(orgUnits.level, 'project'))
      .orderBy(asc(orgUnits.name))
    const types = await tx
      .select({ id: hazidAssessmentTypes.id, name: hazidAssessmentTypes.name })
      .from(hazidAssessmentTypes)
      .orderBy(asc(hazidAssessmentTypes.name))
    const supervisors = await tx
      .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
    const recents = await tx
      .select({
        id: hazidAssessments.id,
        reference: hazidAssessments.reference,
        occurredAt: hazidAssessments.occurredAt,
      })
      .from(hazidAssessments)
      .orderBy(desc(hazidAssessments.occurredAt))
      .limit(15)
    return { sites, projects, types, supervisors, recents }
  })

  const nowLocal = new Date().toISOString().slice(0, 16)

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader back={{ href: '/hazid', label: 'Back to assessments' }} title="New hazard assessment" />
        <Alert variant="info">
          <AlertTitle>Pick a type and a site</AlertTitle>
          <AlertDescription>
            We will pre-seed PPE / Question rows and any location-default tasks for you. You can
            then drill into the assessment to add hazards, capture signatures, etc.
          </AlertDescription>
        </Alert>
        <Card>
          <CardContent className="pt-6">
            <form action={submit} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Assessment type" required>
                  <Select name="assessmentTypeId" defaultValue="" required>
                    <option value="">— pick one —</option>
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Occurred at" required>
                  <Input name="occurredAt" type="datetime-local" required defaultValue={nowLocal} />
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
                <Field label="Supervisor">
                  <Select name="supervisorPersonId" defaultValue="">
                    <option value="">—</option>
                    {supervisors.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.lastName}, {p.firstName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Copy from existing">
                  <Select name="copyFromId" defaultValue="">
                    <option value="">—</option>
                    {recents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.reference} · {new Date(a.occurredAt).toLocaleDateString()}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Job scope (short summary)" className="sm:col-span-2">
                  <Textarea name="jobScope" rows={4} placeholder="What is the work? E.g. tank entry to replace gasket." />
                </Field>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit">Create assessment</Button>
              </div>
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
