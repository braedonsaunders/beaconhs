import { redirect } from 'next/navigation'
import { asc, eq, isNull } from 'drizzle-orm'
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
import { orgUnits, people, tenantUsers } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { createLiftPlan } from '../_actions'

export const metadata = { title: 'New lift plan' }
export const dynamic = 'force-dynamic'

async function submit(formData: FormData) {
  'use server'
  const { id } = await createLiftPlan(formData)
  redirect(`/lift-plans/${id}`)
}

export default async function NewLiftPlanPage() {
  const ctx = await requireRequestContext()
  const { sites, projects, supervisors, workers } = await ctx.db(async (tx) => {
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
    const supervisors = await tx
      .select({ id: tenantUsers.id, displayName: tenantUsers.displayName })
      .from(tenantUsers)
      .where(eq(tenantUsers.status, 'active'))
      .orderBy(asc(tenantUsers.displayName))
    const workers = await tx
      .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
    return { sites, projects, supervisors, workers }
  })
  const today = new Date().toISOString().slice(0, 10)

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl space-y-6">
        <DetailHeader back={{ href: '/lift-plans', label: 'Back to lift plans' }} title="New lift plan" />
        <Alert variant="info">
          <AlertTitle>Set the basics</AlertTitle>
          <AlertDescription>
            Pick the project, site, lift date, supervisor, operator, and rigger. After creation
            you can add loads, equipment, hazards, PPE, signatures, and photos.
          </AlertDescription>
        </Alert>
        <Card>
          <CardContent className="pt-6">
            <form action={submit} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <Field label="Lift date" required>
                  <Input name="liftDate" type="date" required defaultValue={today} />
                </Field>
                <Field label="Supervisor">
                  <Select name="supervisorTenantUserId" defaultValue="">
                    <option value="">—</option>
                    {supervisors.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.displayName ?? 'Unnamed'}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Crane operator">
                  <Select name="operatorPersonId" defaultValue="">
                    <option value="">—</option>
                    {workers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.lastName}, {p.firstName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Rigger">
                  <Select name="riggerPersonId" defaultValue="">
                    <option value="">—</option>
                    {workers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.lastName}, {p.firstName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Description / scope" className="sm:col-span-2">
                  <Textarea
                    name="description"
                    rows={4}
                    placeholder="What is being lifted, where, why? Special hazards or constraints."
                  />
                </Field>
              </div>
              <div className="flex items-center justify-end">
                <Button type="submit">Create lift plan</Button>
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
