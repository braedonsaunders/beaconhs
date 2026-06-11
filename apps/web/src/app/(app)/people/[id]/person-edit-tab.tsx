import { asc, eq, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { Button, Card, CardContent, Input, Label, Select, Textarea } from '@beaconhs/ui'
import { crews, departments, people, trades } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

async function savePerson(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const before = await ctx.db(async (tx) => {
    const [p] = await tx.select().from(people).where(eq(people.id, id)).limit(1)
    return p
  })
  const rawManagerId = String(formData.get('managerPersonId') ?? '').trim() || null
  // A person cannot be their own manager — silently drop the assignment if the
  // form tries it. (The dropdown already filters self out, but defend anyway.)
  const managerPersonId = rawManagerId && rawManagerId !== id ? rawManagerId : null
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
    managerPersonId,
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
}

export async function PersonEditTab({ personId }: { personId: string }) {
  const ctx = await requireRequestContext()
  const [person, depts, allTrades, allCrews, allManagers] = await ctx.db(async (tx) => {
    const [p] = await tx.select().from(people).where(eq(people.id, personId)).limit(1)
    if (!p) return [null, [], [], [], []] as const
    const d = await tx.select().from(departments).orderBy(asc(departments.name))
    const t = await tx.select().from(trades).orderBy(asc(trades.name))
    const c = await tx.select().from(crews).orderBy(asc(crews.name))
    // Exclude self from the manager picker. Note: doesn't guard against
    // longer cycles (A → B → A); the org-chart renderer has an in-memory
    // cycle guard for that case.
    const m = await tx
      .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
      .from(people)
      .where(ne(people.id, personId))
      .orderBy(asc(people.lastName), asc(people.firstName))
    return [p, d, t, c, m] as const
  })
  if (!person) return null

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={savePerson} className="space-y-4">
          <input type="hidden" name="id" value={personId} />
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
            <Field label="Reports to">
              <Select name="managerPersonId" defaultValue={person.managerPersonId ?? ''}>
                <option value="">— no manager —</option>
                {allManagers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.lastName}, {m.firstName}
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
              <Input name="emergencyContactName" defaultValue={person.emergencyContactName ?? ''} />
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
          <div className="flex justify-end">
            <Button type="submit">Save changes</Button>
          </div>
        </form>
      </CardContent>
    </Card>
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
