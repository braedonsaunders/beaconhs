import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirect } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
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
import {
  crews,
  departments,
  people,
  personTitleAssignments,
  personTitles,
  trades,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { materializeIdentityAudienceObligations } from '@beaconhs/compliance'
import { assertCanManageModule, requireModuleManage } from '@/lib/module-admin/guard'
import { recordAuditInTransaction } from '@/lib/audit'
import {
  lockJobTitleObligations,
  materializeLockedJobTitleObligations,
} from '@/lib/job-title-compliance'
import { revalidatePath } from 'next/cache'
import { PageContainer } from '@/components/page-layout'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0b26bbc21acc0c') }
}

async function createPerson(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const firstName = String(formData.get('firstName') ?? '').trim()
  const lastName = String(formData.get('lastName') ?? '').trim()
  const employeeNo = String(formData.get('employeeNo') ?? '').trim() || null
  const email = String(formData.get('email') ?? '').trim() || null
  const phone = String(formData.get('phone') ?? '').trim() || null
  const hireDate = String(formData.get('hireDate') ?? '').trim() || null
  const departmentId = String(formData.get('departmentId') ?? '').trim() || null
  const tradeId = String(formData.get('tradeId') ?? '').trim() || null
  const crewId = String(formData.get('crewId') ?? '').trim() || null
  const primaryTitleId = String(formData.get('primaryTitleId') ?? '').trim() || null

  if (!firstName || !lastName) throw new Error('First and last name are required')

  const row = await ctx.db(async (tx) => {
    let lockedTitleObligations: Awaited<ReturnType<typeof lockJobTitleObligations>> = []
    if (primaryTitleId) {
      const [title] = await tx
        .select({ id: personTitles.id })
        .from(personTitles)
        .where(and(eq(personTitles.id, primaryTitleId), isNull(personTitles.deletedAt)))
        .limit(1)
        .for('key share')
      if (!title) throw new Error('Selected job title is unavailable')
      lockedTitleObligations = await lockJobTitleObligations(tx, ctx.tenantId, [primaryTitleId])
    }

    const [created] = await tx
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
        titleIds: primaryTitleId ? [primaryTitleId] : [],
      })
      .returning()
    if (!created) throw new Error('Person could not be created')
    if (primaryTitleId) {
      await tx.insert(personTitleAssignments).values({
        tenantId: ctx.tenantId,
        personId: created.id,
        titleId: primaryTitleId,
        isPrimary: true,
      })
      await materializeLockedJobTitleObligations(tx, ctx.tenantId, lockedTitleObligations)
    }
    await materializeIdentityAudienceObligations(tx, ctx.tenantId, [created.id])
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'person',
      entityId: created.id,
      action: 'create',
      summary: `Added person ${firstName} ${lastName}`,
      after: {
        firstName,
        lastName,
        employeeNo,
        email,
        hireDate,
        departmentId,
        tradeId,
        crewId,
        primaryTitleId,
      },
    })
    return created
  })
  revalidatePath('/people')
  if (row) {
    redirect(`/people/${row.id}`)
  }
  redirect('/people')
}

export default async function NewPersonPage() {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireModuleManage('people')
  const [depts, allTrades, allCrews, allTitles] = await ctx.db(async (tx) => {
    const d = await tx.select().from(departments).orderBy(asc(departments.name))
    const t = await tx.select().from(trades).orderBy(asc(trades.name))
    const c = await tx.select().from(crews).orderBy(asc(crews.name))
    const titles = await tx
      .select()
      .from(personTitles)
      .where(isNull(personTitles.deletedAt))
      .orderBy(asc(personTitles.name))
    return [d, t, c, titles] as const
  })

  return (
    <PageContainer>
      <div className="max-w-2xl space-y-6">
        <DetailHeader
          back={{ href: '/people', label: 'Back to people' }}
          title={tGenerated('m_12634c941f2fb6')}
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createPerson} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={tGenerated('m_07cc2555a1b765')} required>
                  <Input name="firstName" required autoComplete="given-name" />
                </Field>
                <Field label={tGenerated('m_0e7d90a2ba2038')} required>
                  <Input name="lastName" required autoComplete="family-name" />
                </Field>
                <Field label={tGenerated('m_0230d1a18b5206')}>
                  <Input name="employeeNo" />
                </Field>
                <Field label={tGenerated('m_1bd874d72669b8')}>
                  <Input name="hireDate" type="date" />
                </Field>
                <Field label={tGenerated('m_1a4bbe2908d1a5')}>
                  <Select name="primaryTitleId" defaultValue="">
                    <option value="">—</option>
                    {allTitles.map((title) => (
                      <option key={title.id} value={title.id}>
                        {title.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={tGenerated('m_00a0ba9938bdff')}>
                  <Input name="email" type="email" autoComplete="email" />
                </Field>
                <Field label={tGenerated('m_129b102b56bf3a')}>
                  <Input name="phone" type="tel" autoComplete="tel" />
                </Field>
                <Field label={tGenerated('m_1af68228b8305a')}>
                  <Select name="departmentId" defaultValue="">
                    <option value="">—</option>
                    {depts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={tGenerated('m_1f1e634a4380dc')}>
                  <Select name="tradeId" defaultValue="">
                    <option value="">—</option>
                    {allTrades.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={tGenerated('m_13fc63a82a07d0')}>
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
                <AlertTitle>
                  <GeneratedText id="m_18a6f6f76adf7e" />
                </AlertTitle>
                <AlertDescription>
                  <GeneratedText id="m_143fbba3ff0af7" />
                </AlertDescription>
              </Alert>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit">
                  <GeneratedText id="m_1b83752940084d" />
                </Button>
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
        <GeneratedValue value={label} />
        <GeneratedValue value={required ? <span className="text-red-600"> *</span> : null} />
      </Label>
      <GeneratedValue value={children} />
    </div>
  )
}
