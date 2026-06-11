import { notFound, redirect } from 'next/navigation'
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
import { crews, departments, people, trades } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Edit person' }
export const dynamic = 'force-dynamic'

async function updatePerson(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return

  const before = await ctx.db(async (tx) => {
    const [p] = await tx.select().from(people).where(eq(people.id, id)).limit(1)
    return p
  })

  const patch = {
    firstName: String(formData.get('firstName') ?? '').trim(),
    lastName: String(formData.get('lastName') ?? '').trim(),
    formalName: String(formData.get('formalName') ?? '').trim() || null,
    jobTitle: String(formData.get('jobTitle') ?? '').trim() || null,
    employeeNo: String(formData.get('employeeNo') ?? '').trim() || null,
    email: String(formData.get('email') ?? '').trim() || null,
    phone: String(formData.get('phone') ?? '').trim() || null,
    hireDate: String(formData.get('hireDate') ?? '').trim() || null,
    departmentId: String(formData.get('departmentId') ?? '').trim() || null,
    tradeId: String(formData.get('tradeId') ?? '').trim() || null,
    crewId: String(formData.get('crewId') ?? '').trim() || null,
    emergencyContactName: String(formData.get('emergencyContactName') ?? '').trim() || null,
    emergencyContactPhone: String(formData.get('emergencyContactPhone') ?? '').trim() || null,
    notes: String(formData.get('notes') ?? '').trim() || null,
    status: String(formData.get('status') ?? 'active') as 'active' | 'inactive' | 'terminated',
  }

  await ctx.db((tx) => tx.update(people).set(patch).where(eq(people.id, id)))
  await recordAudit(ctx, {
    entityType: 'person',
    entityId: id,
    action: 'update',
    summary: 'Person edited',
    before: before as unknown as Record<string, unknown>,
    after: patch as unknown as Record<string, unknown>,
  })
  revalidatePath(`/people/${id}`)
  revalidatePath('/people')
  redirect(`/people/${id}`)
}

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const [person, depts, allTrades, allCrews] = await ctx.db(async (tx) => {
    const [p] = await tx.select().from(people).where(eq(people.id, id)).limit(1)
    if (!p) return [null, [], [], []] as const
    const d = await tx.select().from(departments).orderBy(asc(departments.name))
    const t = await tx.select().from(trades).orderBy(asc(trades.name))
    const c = await tx.select().from(crews).orderBy(asc(crews.name))
    return [p, d, t, c] as const
  })
  if (!person) notFound()

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: `/people/${id}`, label: 'Back to profile' }}
          title="Edit person"
          subtitle={`${person.firstName} ${person.lastName}${person.employeeNo ? ` · ${person.employeeNo}` : ''}`}
        />
        <Card>
          <CardContent className="pt-6">
            <form action={updatePerson} className="space-y-4">
              <input type="hidden" name="id" value={id} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="First name" required>
                  <Input name="firstName" required defaultValue={person.firstName} />
                </Field>
                <Field label="Last name" required>
                  <Input name="lastName" required defaultValue={person.lastName} />
                </Field>
                <Field label="Formal name">
                  <Input name="formalName" defaultValue={person.formalName ?? ''} />
                </Field>
                <Field label="Job title">
                  <Input name="jobTitle" defaultValue={person.jobTitle ?? ''} />
                </Field>
                <Field label="Employee #">
                  <Input name="employeeNo" defaultValue={person.employeeNo ?? ''} />
                </Field>
                <Field label="Hire date">
                  <Input name="hireDate" type="date" defaultValue={person.hireDate ?? ''} />
                </Field>
                <Field label="Email">
                  <Input name="email" type="email" defaultValue={person.email ?? ''} />
                </Field>
                <Field label="Phone">
                  <Input name="phone" type="tel" defaultValue={person.phone ?? ''} />
                </Field>
                <Field label="Department">
                  <Select name="departmentId" defaultValue={person.departmentId ?? ''}>
                    <option value="">—</option>
                    {depts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Trade">
                  <Select name="tradeId" defaultValue={person.tradeId ?? ''}>
                    <option value="">—</option>
                    {allTrades.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Crew">
                  <Select name="crewId" defaultValue={person.crewId ?? ''}>
                    <option value="">—</option>
                    {allCrews.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status">
                  <Select name="status" defaultValue={person.status}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="terminated">Terminated</option>
                  </Select>
                </Field>
                <Field label="Emergency contact name">
                  <Input
                    name="emergencyContactName"
                    defaultValue={person.emergencyContactName ?? ''}
                  />
                </Field>
                <Field label="Emergency contact phone">
                  <Input
                    name="emergencyContactPhone"
                    type="tel"
                    defaultValue={person.emergencyContactPhone ?? ''}
                  />
                </Field>
                <Field label="Notes" className="sm:col-span-2">
                  <Textarea name="notes" rows={3} defaultValue={person.notes ?? ''} />
                </Field>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="submit">Save changes</Button>
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
