import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { asc, eq, isNull } from 'drizzle-orm'
import {
  Button,
  Input,
  Label,
  PageHeader,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { liftPlans, orgUnits, people, tenantUsers } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { updateLiftPlanGeneral } from '../../_actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Edit lift plan · ${id.slice(0, 8)}` }
}

async function submit(formData: FormData) {
  'use server'
  const id = String(formData.get('id') ?? '')
  await updateLiftPlanGeneral(formData)
  redirect(`/lift-plans/${id}`)
}

export default async function EditLiftPlanPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [plan] = await tx
      .select()
      .from(liftPlans)
      .where(eq(liftPlans.id, id))
      .limit(1)
    if (!plan || plan.deletedAt) return null
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
    return { plan, sites, projects, supervisors, workers }
  })
  if (!data) notFound()
  const { plan, sites, projects, supervisors, workers } = data

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title={`Edit ${plan.reference}`}
          description="Edit general info. Loads, equipment, hazards, PPE, signatures, and photos are managed on the detail page."
          back={{ href: `/lift-plans/${id}`, label: 'Back to lift plan' }}
        />
        {plan.locked ? (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            This lift plan is <strong>locked</strong>. Unlock it from the detail page before
            editing.
          </div>
        ) : null}
        <form
          action={submit}
          className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-6"
        >
          <input type="hidden" name="id" value={id} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="liftDate">Lift date *</Label>
              <Input
                id="liftDate"
                name="liftDate"
                type="date"
                required
                defaultValue={plan.liftDate}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="projectOrgUnitId">Project</Label>
              <Select
                id="projectOrgUnitId"
                name="projectOrgUnitId"
                defaultValue={plan.projectOrgUnitId ?? ''}
              >
                <option value="">—</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="siteOrgUnitId">Site</Label>
              <Select id="siteOrgUnitId" name="siteOrgUnitId" defaultValue={plan.siteOrgUnitId ?? ''}>
                <option value="">—</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="supervisorTenantUserId">Supervisor</Label>
              <Select
                id="supervisorTenantUserId"
                name="supervisorTenantUserId"
                defaultValue={plan.supervisorTenantUserId ?? ''}
              >
                <option value="">—</option>
                {supervisors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName ?? 'Unnamed'}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="operatorPersonId">Crane operator</Label>
              <Select
                id="operatorPersonId"
                name="operatorPersonId"
                defaultValue={plan.operatorPersonId ?? ''}
              >
                <option value="">—</option>
                {workers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.lastName}, {p.firstName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="riggerPersonId">Rigger</Label>
              <Select
                id="riggerPersonId"
                name="riggerPersonId"
                defaultValue={plan.riggerPersonId ?? ''}
              >
                <option value="">—</option>
                {workers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.lastName}, {p.firstName}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description / scope</Label>
            <Textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={plan.description ?? ''}
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Link href={`/lift-plans/${id}`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={plan.locked}>
              Save changes
            </Button>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}
