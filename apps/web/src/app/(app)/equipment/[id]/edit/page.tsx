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
import { equipmentItems, equipmentTypes, orgUnits, people } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Edit equipment' }
export const dynamic = 'force-dynamic'

async function updateEquipment(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return

  const before = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(equipmentItems).where(eq(equipmentItems.id, id)).limit(1)
    return r
  })

  const patch = {
    name: String(formData.get('name') ?? '').trim(),
    assetTag: String(formData.get('assetTag') ?? '').trim(),
    serialNumber: String(formData.get('serialNumber') ?? '').trim() || null,
    description: String(formData.get('description') ?? '').trim() || null,
    typeId: String(formData.get('typeId') ?? '').trim() || null,
    status: String(formData.get('status') ?? 'in_service') as
      | 'in_service'
      | 'out_of_service'
      | 'in_repair'
      | 'lost'
      | 'retired',
    currentSiteOrgUnitId: String(formData.get('currentSiteOrgUnitId') ?? '').trim() || null,
    currentHolderPersonId: String(formData.get('currentHolderPersonId') ?? '').trim() || null,
    billingRateCategory: String(formData.get('billingRateCategory') ?? '').trim() || null,
    purchaseDate: String(formData.get('purchaseDate') ?? '').trim() || null,
    warrantyExpiresOn: String(formData.get('warrantyExpiresOn') ?? '').trim() || null,
    requiresPreUseInspection: formData.get('requiresPreUseInspection') === 'on',
    requiresAnnualInspection: formData.get('requiresAnnualInspection') === 'on',
  }
  await ctx.db((tx) => tx.update(equipmentItems).set(patch).where(eq(equipmentItems.id, id)))
  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: id,
    action: 'update',
    summary: 'Equipment edited',
    before: before as unknown as Record<string, unknown>,
    after: patch as unknown as Record<string, unknown>,
  })
  revalidatePath(`/equipment/${id}`)
  revalidatePath('/equipment')
  redirect(`/equipment/${id}`)
}

export default async function EditEquipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const [item, types, sites, allPeople] = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(equipmentItems).where(eq(equipmentItems.id, id)).limit(1)
    if (!r) return [null, [], [], []] as const
    const t = await tx.select().from(equipmentTypes).orderBy(asc(equipmentTypes.name))
    const s = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    const p = await tx
      .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
      .from(people)
      .orderBy(asc(people.lastName))
    return [r, t, s, p] as const
  })
  if (!item) notFound()

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: `/equipment/${id}`, label: 'Back to asset' }}
          title="Edit equipment"
          subtitle={`${item.assetTag} · ${item.name}`}
        />
        <Card>
          <CardContent className="pt-6">
            <form action={updateEquipment} className="space-y-4">
              <input type="hidden" name="id" value={id} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Asset tag" required>
                  <Input name="assetTag" required defaultValue={item.assetTag} />
                </Field>
                <Field label="Name" required>
                  <Input name="name" required defaultValue={item.name} />
                </Field>
                <Field label="Serial #">
                  <Input name="serialNumber" defaultValue={item.serialNumber ?? ''} />
                </Field>
                <Field label="Type">
                  <Select name="typeId" defaultValue={item.typeId ?? ''}>
                    <option value="">—</option>
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status">
                  <Select name="status" defaultValue={item.status}>
                    {['in_service', 'out_of_service', 'in_repair', 'lost', 'retired'].map((s) => (
                      <option key={s} value={s}>{s.replace('_', ' ')}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Billing category">
                  <Input name="billingRateCategory" defaultValue={item.billingRateCategory ?? ''} />
                </Field>
                <Field label="Current site">
                  <Select name="currentSiteOrgUnitId" defaultValue={item.currentSiteOrgUnitId ?? ''}>
                    <option value="">—</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Current holder">
                  <Select name="currentHolderPersonId" defaultValue={item.currentHolderPersonId ?? ''}>
                    <option value="">—</option>
                    {allPeople.map((p) => (
                      <option key={p.id} value={p.id}>{p.lastName}, {p.firstName}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Purchase date">
                  <Input name="purchaseDate" type="date" defaultValue={item.purchaseDate ?? ''} />
                </Field>
                <Field label="Warranty expires">
                  <Input name="warrantyExpiresOn" type="date" defaultValue={item.warrantyExpiresOn ?? ''} />
                </Field>
                <Field label="Description" className="sm:col-span-2">
                  <Textarea name="description" rows={3} defaultValue={item.description ?? ''} />
                </Field>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    name="requiresPreUseInspection"
                    defaultChecked={item.requiresPreUseInspection}
                  />
                  Requires pre-use inspection
                </label>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    name="requiresAnnualInspection"
                    defaultChecked={item.requiresAnnualInspection}
                  />
                  Requires annual inspection
                </label>
              </div>
              <div className="flex justify-end">
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
