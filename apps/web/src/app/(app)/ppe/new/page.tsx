import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { asc } from 'drizzle-orm'
import { Button, Input, Label, PageHeader, Select, Textarea } from '@beaconhs/ui'
import { ppeItems, ppeTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New PPE item' }

export const dynamic = 'force-dynamic'

async function createPpe(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  const typeId = String(formData.get('typeId') ?? '').trim()
  const serialNumber = String(formData.get('serialNumber') ?? '').trim() || null
  const size = String(formData.get('size') ?? '').trim() || null
  const purchaseDate = String(formData.get('purchaseDate') ?? '').trim() || null
  const expiresOn = String(formData.get('expiresOn') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!typeId) return

  const itemId = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(ppeItems)
      .values({
        tenantId: ctx.tenantId,
        typeId,
        serialNumber,
        size,
        purchaseDate,
        expiresOn,
        notes,
        status: 'in_stock',
      })
      .returning({ id: ppeItems.id })
    return row?.id
  })
  if (!itemId) return

  await recordAudit(ctx, {
    entityType: 'ppe_item',
    entityId: itemId,
    action: 'create',
    summary: `Added PPE item${serialNumber ? ` ${serialNumber}` : ''}`,
    after: { typeId, serialNumber, size, purchaseDate, expiresOn },
  })
  revalidatePath('/ppe')
  redirect(`/ppe/${itemId}`)
}

export default async function NewPpePage() {
  const ctx = await requireRequestContext()
  const types = await ctx.db((tx) => tx.select().from(ppeTypes).orderBy(asc(ppeTypes.name)))

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="New PPE item"
          description="Add a single piece of PPE to the register. To issue it to a person, use the detail page after creation."
          back={{ href: '/ppe', label: 'Back to PPE' }}
        />
        {types.length === 0 ? (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            No PPE types defined yet. Add one in <strong>Admin → Tenant settings</strong> (or
            directly insert via seed) before creating items.
          </div>
        ) : null}
        <form
          action={createPpe}
          className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-6"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="typeId">PPE type *</Label>
              <Select id="typeId" name="typeId" defaultValue="" required>
                <option value="">— Select type —</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.category ? ` (${t.category})` : ''}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="serialNumber">Serial number</Label>
              <Input
                id="serialNumber"
                name="serialNumber"
                placeholder="manufacturer or in-house tag"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="size">Size</Label>
              <Input id="size" name="size" placeholder="S / M / L / 10 / etc." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="purchaseDate">Purchase date</Label>
              <Input id="purchaseDate" name="purchaseDate" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expiresOn">Expires on</Label>
              <Input id="expiresOn" name="expiresOn" type="date" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              placeholder="Anything reviewers should know."
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Link href="/ppe">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={types.length === 0}>
              Add PPE item
            </Button>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}
