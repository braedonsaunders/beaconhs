import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { asc, count, eq, sql } from 'drizzle-orm'
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
import { csPermits, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New permit' }

async function createPermit(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const title = String(formData.get('title') ?? '').trim()
  if (!title) throw new Error('Title is required')
  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const spaceDescription = String(formData.get('spaceDescription') ?? '').trim()
  const rescuePlan = String(formData.get('rescuePlan') ?? '').trim() || null
  const hazardsRaw = String(formData.get('hazards') ?? '')
  const hazards = hazardsRaw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const validHours = Number(formData.get('validHours') ?? '8') || 8

  const [row] = await ctx.db(async (tx) => {
    const year = new Date().getFullYear()
    const [{ c } = { c: 0 }] = await tx
      .select({ c: count() })
      .from(csPermits)
      .where(sql`extract(year from ${csPermits.issuedAt}) = ${year}`)
    const reference = `CS-${year}-${String(Number(c ?? 0) + 1).padStart(4, '0')}`
    return tx
      .insert(csPermits)
      .values({
        tenantId: ctx.tenantId,
        reference,
        title,
        siteOrgUnitId,
        spaceDescription,
        rescuePlan,
        hazardIdentification: hazards,
        status: 'open',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + validHours * 3600 * 1000),
        issuedByTenantUserId: ctx.membership?.id,
      })
      .returning()
  })
  revalidatePath('/confined-space')
  if (row) {
    await recordAudit(ctx, {
      entityType: 'cs_permit',
      entityId: row.id,
      action: 'create',
      summary: `Issued ${row.reference}: ${title}`,
      after: { reference: row.reference, siteOrgUnitId, hazardIdentification: hazards },
    })
    redirect(`/confined-space/${row.id}`)
  }
  redirect('/confined-space')
}

export default async function NewPermitPage() {
  const ctx = await requireRequestContext()
  const sites = await ctx.db((tx) =>
    tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name)),
  )

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/confined-space', label: 'Back to permits' }}
          title="New confined-space permit"
        />
        <Alert variant="info">
          <AlertTitle>About confined-space permits</AlertTitle>
          <AlertDescription>
            The permit lifecycle is open → active → closed. Atmospheric readings out of spec (O₂
            &lt; 19.5% or &gt; 23%, LEL ≥ 10%, H₂S ≥ 10 ppm, CO ≥ 25 ppm) raise a critical alarm on
            the permit page.
          </AlertDescription>
        </Alert>
        <Card>
          <CardContent className="pt-6">
            <form action={createPermit} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Title" required className="sm:col-span-2">
                  <Input name="title" required placeholder="e.g. Tank 3 internal inspection" />
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
                <Field label="Valid for (hours)">
                  <Input name="validHours" type="number" min="1" max="24" defaultValue="8" />
                </Field>
                <Field label="Space description" required className="sm:col-span-2">
                  <Textarea
                    name="spaceDescription"
                    rows={3}
                    required
                    placeholder="Type, location, manway access, ventilation"
                  />
                </Field>
                <Field label="Hazards identified (one per line)" className="sm:col-span-2">
                  <Textarea
                    name="hazards"
                    rows={3}
                    placeholder={`H2S\nLow oxygen\nMechanical entrapment`}
                  />
                </Field>
                <Field label="Rescue plan" className="sm:col-span-2">
                  <Textarea
                    name="rescuePlan"
                    rows={3}
                    placeholder="Attendant location, communication method, retrieval plan"
                  />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button type="submit">Open permit</Button>
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
