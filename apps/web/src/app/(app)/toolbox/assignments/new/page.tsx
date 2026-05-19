import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { asc, eq } from 'drizzle-orm'
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
  orgUnits,
  people,
  roles,
  toolboxJournalAssignments,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'New toolbox assignment' }

async function createAssignment(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const description = String(formData.get('description') ?? '').trim() || null
  const cron = String(formData.get('cron') ?? '0 7 * * 1').trim()
  const dueOffsetDays = Number(String(formData.get('dueOffsetDays') ?? '0')) || 0
  const compliantPercentage = Number(String(formData.get('compliantPercentage') ?? '80')) || 80
  const active = formData.get('active') === 'on'
  const audience = {
    roleKeys: formData.getAll('roleKeys').map((v) => String(v)).filter(Boolean),
    personIds: formData.getAll('personIds').map((v) => String(v)).filter(Boolean),
    orgUnitIds: formData.getAll('orgUnitIds').map((v) => String(v)).filter(Boolean),
  }

  const [row] = await ctx.db((tx) =>
    tx
      .insert(toolboxJournalAssignments)
      .values({
        tenantId: ctx.tenantId,
        name,
        description,
        cron,
        dueOffsetDays,
        compliantPercentage,
        active,
        audience,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning(),
  )
  if (!row) {
    redirect('/toolbox/assignments')
  }
  await recordAudit(ctx, {
    entityType: 'toolbox_journal_assignment',
    entityId: row.id,
    action: 'create',
    summary: `Created assignment "${name}"`,
    after: { name, cron, audience, active, compliantPercentage },
  })
  revalidatePath('/toolbox/assignments')
  redirect(`/toolbox/assignments/${row.id}`)
}

export default async function NewAssignmentPage() {
  const ctx = await requireRequestContext()
  const [roleRows, peopleRows, siteRows] = await ctx.db(async (tx) => {
    const r = await tx
      .select({ key: roles.key, name: roles.name })
      .from(roles)
      .orderBy(asc(roles.name))
    const p = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
      })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
      .limit(500)
    const s = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    return [r, p, s] as const
  })

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/toolbox/assignments', label: 'Back to assignments' }}
          title="New toolbox assignment"
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createAssignment} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Name" required className="sm:col-span-2">
                  <Input
                    name="name"
                    required
                    placeholder="e.g. Weekly Toolbox — Site A"
                  />
                </Field>
                <Field label="Description" className="sm:col-span-2">
                  <Textarea
                    name="description"
                    rows={2}
                    placeholder="What's being required and why"
                  />
                </Field>
                <Field label="Cron schedule" required>
                  <Input
                    name="cron"
                    placeholder="0 7 * * 1"
                    defaultValue="0 7 * * 1"
                    required
                  />
                  <p className="text-xs text-slate-500">e.g. <code>0 7 * * 1</code> = Mondays 07:00</p>
                </Field>
                <Field label="Due offset (days)">
                  <Input
                    name="dueOffsetDays"
                    type="number"
                    min={0}
                    max={30}
                    defaultValue={0}
                  />
                </Field>
                <Field label="Compliant % threshold">
                  <Input
                    name="compliantPercentage"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={80}
                  />
                </Field>
                <Field label="Active">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" name="active" defaultChecked /> Enabled
                  </label>
                </Field>
                <Field label="Audience: roles" className="sm:col-span-2">
                  <Select name="roleKeys" multiple className="h-32">
                    {roleRows.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-slate-500">
                    Cmd/Ctrl-click to pick multiple. Leave empty to skip role filter.
                  </p>
                </Field>
                <Field label="Audience: people" className="sm:col-span-2">
                  <Select name="personIds" multiple className="h-32">
                    {peopleRows.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.lastName}, {p.firstName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Audience: sites" className="sm:col-span-2">
                  <Select name="orgUnitIds" multiple className="h-24">
                    {siteRows.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-slate-500">
                    Empty in all three lists = everyone in the tenant.
                  </p>
                </Field>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit">Create assignment</Button>
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
