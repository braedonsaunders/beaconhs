import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { asc } from 'drizzle-orm'
import { randomBytes } from 'crypto'
import { Button, Input, Label, PageHeader, Select, Textarea } from '@beaconhs/ui'
import { equipmentItems, equipmentTypes, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New equipment' }

export const dynamic = 'force-dynamic'

async function createEquipment(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  const name = String(formData.get('name') ?? '').trim()
  const assetTag = String(formData.get('assetTag') ?? '').trim()
  const serialNumber = String(formData.get('serialNumber') ?? '').trim() || null
  const description = String(formData.get('description') ?? '').trim() || null
  const typeId = String(formData.get('typeId') ?? '').trim() || null
  const siteId = String(formData.get('siteId') ?? '').trim() || null
  const purchaseDate = String(formData.get('purchaseDate') ?? '').trim() || null
  if (!name || !assetTag) return

  const qrToken = randomBytes(12).toString('base64url')

  const itemId = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(equipmentItems)
      .values({
        tenantId: ctx.tenantId,
        name,
        assetTag,
        serialNumber,
        description,
        typeId: typeId as any,
        currentSiteOrgUnitId: siteId as any,
        purchaseDate,
        qrToken,
        status: 'in_service',
      })
      .returning({ id: equipmentItems.id })
    return row?.id
  })
  if (!itemId) return

  await recordAudit(ctx, {
    entityType: 'equipment_item',
    entityId: itemId,
    action: 'create',
    summary: `Created equipment "${name}" (${assetTag})`,
    after: { name, assetTag, serialNumber, typeId, siteId },
  })
  revalidatePath('/equipment')
  redirect(`/equipment/${itemId}`)
}

export default async function NewEquipmentPage() {
  const ctx = await requireRequestContext()
  const { types, sites } = await ctx.db(async (tx) => {
    const [t, s] = await Promise.all([
      tx.select().from(equipmentTypes).orderBy(asc(equipmentTypes.name)),
      tx
        .select()
        .from(orgUnits)
        .where(/* level filter via SQL below */ asc(orgUnits.name) as any),
    ])
    return { types: t, sites: s }
  })

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="New equipment"
          description="Register a new piece of equipment. You'll be able to attach inspection schedules, transfer to a site, and assign a holder from the detail page."
          back={{ href: '/equipment', label: 'Back to equipment' }}
        />
        <form
          action={createEquipment}
          className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-6"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" name="name" required placeholder="e.g. Hilti TE-30 rotary hammer" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assetTag">Asset tag *</Label>
              <Input id="assetTag" name="assetTag" required placeholder="e.g. RSI-0142" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="serialNumber">Serial number</Label>
              <Input id="serialNumber" name="serialNumber" placeholder="manufacturer serial" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="typeId">Type</Label>
              <Select id="typeId" name="typeId" defaultValue="">
                <option value="">— Uncategorised —</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="siteId">Currently at site</Label>
              <Select id="siteId" name="siteId" defaultValue="">
                <option value="">— Unassigned —</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.level})
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="purchaseDate">Purchase date</Label>
              <Input id="purchaseDate" name="purchaseDate" type="date" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description / notes</Label>
            <Textarea id="description" name="description" rows={3} />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Link href="/equipment">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit">Create equipment</Button>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}
