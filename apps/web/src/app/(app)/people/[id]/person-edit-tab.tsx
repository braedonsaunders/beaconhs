import { and, asc, eq, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { crews, departments, people, trades } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { getPersonSyncOrigin } from '@/lib/people-sync'
import { PersonSelectField } from '@/components/person-select-field'

async function savePerson(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const { before, syncOrigin } = await ctx.db(async (tx) => {
    const [p] = await tx.select().from(people).where(eq(people.id, id)).limit(1)
    const origin = p ? await getPersonSyncOrigin(tx, id) : null
    return { before: p, syncOrigin: origin }
  })
  if (!before) return
  // While a person is actively synced, the source system owns the identity
  // fields — we ignore whatever the (disabled) inputs post and preserve the
  // current values, so a stray submit can never blank a synced field.
  const locked = syncOrigin != null

  const rawManagerId = String(formData.get('managerPersonId') ?? '').trim() || null
  // A person cannot be their own manager — silently drop the assignment if the
  // form tries it. (The dropdown already filters self out, but defend anyway.)
  const managerPersonId = rawManagerId && rawManagerId !== id ? rawManagerId : null

  // App-owned fields — always editable, sync or not.
  const appFields = {
    formalName: String(formData.get('formalName') ?? '').trim() || null,
    crewId: String(formData.get('crewId') ?? '').trim() || null,
    managerPersonId,
    emergencyContactName: String(formData.get('emergencyContactName') ?? '').trim() || null,
    emergencyContactPhone: String(formData.get('emergencyContactPhone') ?? '').trim() || null,
    notes: String(formData.get('notes') ?? '').trim() || null,
  }

  // Sync-owned fields — preserved verbatim when locked, read from the form otherwise.
  const syncedFields = locked
    ? {
        firstName: before.firstName,
        lastName: before.lastName,
        jobTitle: before.jobTitle,
        employeeNo: before.employeeNo,
        email: before.email,
        phone: before.phone,
        hireDate: before.hireDate,
        departmentId: before.departmentId,
        tradeId: before.tradeId,
        status: before.status,
      }
    : {
        firstName: String(formData.get('firstName') ?? '').trim(),
        lastName: String(formData.get('lastName') ?? '').trim(),
        jobTitle: String(formData.get('jobTitle') ?? '').trim() || null,
        employeeNo: String(formData.get('employeeNo') ?? '').trim() || null,
        email: String(formData.get('email') ?? '').trim() || null,
        phone: String(formData.get('phone') ?? '').trim() || null,
        hireDate: String(formData.get('hireDate') ?? '').trim() || null,
        departmentId: String(formData.get('departmentId') ?? '').trim() || null,
        tradeId: String(formData.get('tradeId') ?? '').trim() || null,
        status: String(formData.get('status') ?? 'active') as 'active' | 'inactive' | 'terminated',
      }

  // Required-field guard only applies to manual edits (synced names come from before).
  if (!locked && (!syncedFields.firstName || !syncedFields.lastName)) return

  const patch = { ...syncedFields, ...appFields }
  await ctx.db((tx) => tx.update(people).set(patch).where(eq(people.id, id)))
  await recordAudit(ctx, {
    entityType: 'person',
    entityId: id,
    action: 'update',
    summary: locked ? 'Person edited (synced fields preserved)' : 'Person edited',
    before: before as unknown as Record<string, unknown>,
    after: patch as unknown as Record<string, unknown>,
  })
  revalidatePath(`/people/${id}`)
}

export async function PersonEditTab({ personId }: { personId: string }) {
  const ctx = await requireRequestContext()
  const [person, depts, allTrades, allCrews, allManagers, syncOrigin] = await ctx.db(async (tx) => {
    const [p] = await tx.select().from(people).where(eq(people.id, personId)).limit(1)
    if (!p) return [null, [], [], [], [], null] as const
    const d = await tx.select().from(departments).orderBy(asc(departments.name))
    const t = await tx.select().from(trades).orderBy(asc(trades.name))
    const c = await tx.select().from(crews).orderBy(asc(crews.name))
    // Exclude self from the manager picker. Note: doesn't guard against
    // longer cycles (A → B → A); the org-chart renderer has an in-memory
    // cycle guard for that case.
    const m = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
      })
      .from(people)
      .where(and(ne(people.id, personId), eq(people.status, 'active')))
      .orderBy(asc(people.lastName), asc(people.firstName))
    const origin = await getPersonSyncOrigin(tx, personId)
    return [p, d, t, c, m, origin] as const
  })
  if (!person) return null
  const locked = syncOrigin != null

  return (
    <Card>
      <CardContent className="pt-6">
        {locked ? (
          <Alert variant="info" className="mb-4">
            <AlertTitle>Synced from {syncOrigin!.connectionName}</AlertTitle>
            <AlertDescription>
              Identity fields (name, employee #, contact, department, trade, status, hire date) are
              kept in sync from {syncOrigin!.sourceSystem} and are read-only here — edit them at the
              source. App-only fields below stay editable.
            </AlertDescription>
          </Alert>
        ) : null}
        <form action={savePerson} className="space-y-4">
          <input type="hidden" name="id" value={personId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="First name" required>
              <Input name="firstName" required defaultValue={person.firstName} disabled={locked} />
            </Field>
            <Field label="Last name" required>
              <Input name="lastName" required defaultValue={person.lastName} disabled={locked} />
            </Field>
            <Field label="Formal name">
              <Input name="formalName" defaultValue={person.formalName ?? ''} />
            </Field>
            <Field label="Job title">
              <Input name="jobTitle" defaultValue={person.jobTitle ?? ''} disabled={locked} />
            </Field>
            <Field label="Employee #">
              <Input name="employeeNo" defaultValue={person.employeeNo ?? ''} disabled={locked} />
            </Field>
            <Field label="Hire date">
              <Input
                name="hireDate"
                type="date"
                defaultValue={person.hireDate ?? ''}
                disabled={locked}
              />
            </Field>
            <Field label="Email">
              <Input
                name="email"
                type="email"
                defaultValue={person.email ?? ''}
                disabled={locked}
              />
            </Field>
            <Field label="Phone">
              <Input name="phone" type="tel" defaultValue={person.phone ?? ''} disabled={locked} />
            </Field>
            <Field label="Department">
              <Select
                name="departmentId"
                defaultValue={person.departmentId ?? ''}
                disabled={locked}
              >
                <option value="">—</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Trade">
              <Select name="tradeId" defaultValue={person.tradeId ?? ''} disabled={locked}>
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
              <PersonSelectField
                name="managerPersonId"
                defaultValue={person.managerPersonId ?? ''}
                options={allManagers.map((m) => ({
                  value: m.id,
                  label: `${m.lastName}, ${m.firstName}`,
                  hint: m.employeeNo ?? undefined,
                }))}
                placeholder="Search people…"
                clearable
                emptyLabel="— no manager —"
              />
            </Field>
            <Field label="Status">
              <Select name="status" defaultValue={person.status} disabled={locked}>
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
