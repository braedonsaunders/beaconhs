import { redirect } from 'next/navigation'
import { asc } from 'drizzle-orm'
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
import { crews, departments, trades } from '@beaconhs/db/schema'
import { people } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { revalidatePath } from 'next/cache'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New person' }

async function createPerson(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const firstName = String(formData.get('firstName') ?? '').trim()
  const lastName = String(formData.get('lastName') ?? '').trim()
  const employeeNo = String(formData.get('employeeNo') ?? '').trim() || null
  const email = String(formData.get('email') ?? '').trim() || null
  const phone = String(formData.get('phone') ?? '').trim() || null
  const hireDate = String(formData.get('hireDate') ?? '').trim() || null
  const departmentId = String(formData.get('departmentId') ?? '').trim() || null
  const tradeId = String(formData.get('tradeId') ?? '').trim() || null
  const crewId = String(formData.get('crewId') ?? '').trim() || null

  if (!firstName || !lastName) throw new Error('First and last name are required')

  const [row] = await ctx.db((tx) =>
    tx
      .insert(people)
      .values({
        tenantId: ctx.tenantId,
        firstName,
        lastName,
        employeeNo,
        email,
        phone,
        hireDate,
        departmentId,
        tradeId,
        crewId,
      })
      .returning(),
  )
  revalidatePath('/people')
  if (row) {
    await recordAudit(ctx, {
      entityType: 'person',
      entityId: row.id,
      action: 'create',
      summary: `Added person ${firstName} ${lastName}`,
      after: { firstName, lastName, employeeNo, email, hireDate, departmentId, tradeId, crewId },
    })
    redirect(`/people/${row.id}`)
  }
  redirect('/people')
}

export default async function NewPersonPage() {
  const ctx = await requireRequestContext()
  const [depts, allTrades, allCrews] = await ctx.db(async (tx) => {
    const d = await tx.select().from(departments).orderBy(asc(departments.name))
    const t = await tx.select().from(trades).orderBy(asc(trades.name))
    const c = await tx.select().from(crews).orderBy(asc(crews.name))
    return [d, t, c] as const
  })

  return (
    <PageContainer>
      <div className="max-w-2xl space-y-6">
        <DetailHeader back={{ href: '/people', label: 'Back to people' }} title="Add person" />
        <Card>
          <CardContent className="pt-6">
            <form action={createPerson} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="First name" required>
                  <Input name="firstName" required autoComplete="given-name" />
                </Field>
                <Field label="Last name" required>
                  <Input name="lastName" required autoComplete="family-name" />
                </Field>
                <Field label="Employee #">
                  <Input name="employeeNo" />
                </Field>
                <Field label="Hire date">
                  <Input name="hireDate" type="date" />
                </Field>
                <Field label="Email">
                  <Input name="email" type="email" autoComplete="email" />
                </Field>
                <Field label="Phone">
                  <Input name="phone" type="tel" autoComplete="tel" />
                </Field>
                <Field label="Department">
                  <Select name="departmentId" defaultValue="">
                    <option value="">—</option>
                    {depts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Trade">
                  <Select name="tradeId" defaultValue="">
                    <option value="">—</option>
                    {allTrades.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Crew">
                  <Select name="crewId" defaultValue="">
                    <option value="">—</option>
                    {allCrews.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Alert variant="info">
                <AlertTitle>HRIS sync</AlertTitle>
                <AlertDescription>
                  For ongoing tenants this list is typically synced from NetSuite or BambooHR via the
                  plugin framework. Manual adds are for one-offs.
                </AlertDescription>
              </Alert>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit">Create person</Button>
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
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
