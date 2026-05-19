// /ppe/types/[id]/edit — edit name / category / inspectable / cadence.
//
// Sizing scheme + criteria are managed in dedicated sub-tabs of the detail
// page rather than in this edit form, so this page stays focused on the
// short list of "general" attributes.

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { Button, Input, Label, PageHeader, Select } from '@beaconhs/ui'
import { ppeTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Edit PPE type' }
export const dynamic = 'force-dynamic'

const CATEGORY_OPTIONS = [
  { value: '', label: '— None —' },
  { value: 'head', label: 'Head protection' },
  { value: 'eye', label: 'Eye protection' },
  { value: 'hand', label: 'Hand protection' },
  { value: 'foot', label: 'Foot protection' },
  { value: 'fall', label: 'Fall protection' },
  { value: 'respiratory', label: 'Respiratory protection' },
  { value: 'hearing', label: 'Hearing protection' },
  { value: 'high_vis', label: 'High visibility' },
  { value: 'other', label: 'Other' },
]

async function updateType(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '').trim()
  const name = String(formData.get('name') ?? '').trim()
  const category = String(formData.get('category') ?? '').trim() || null
  const isInspectable = formData.get('isInspectable') === 'on'
  const everyDaysRaw = String(formData.get('everyDays') ?? '').trim()
  if (!id || !name) return
  await ctx.db((tx) =>
    tx
      .update(ppeTypes)
      .set({
        name,
        category,
        isInspectable,
        inspectionSchedule:
          isInspectable && everyDaysRaw ? { everyDays: Number(everyDaysRaw) } : null,
      })
      .where(eq(ppeTypes.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'ppe_type',
    entityId: id,
    action: 'update',
    summary: `Updated PPE type "${name}"`,
    after: { name, category, isInspectable, everyDays: everyDaysRaw || null },
  })
  revalidatePath(`/ppe/types/${id}`)
  revalidatePath('/ppe/types')
  redirect(`/ppe/types/${id}`)
}

export default async function EditPpeTypePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const [type] = await ctx.db((tx) =>
    tx.select().from(ppeTypes).where(eq(ppeTypes.id, id)).limit(1),
  )
  if (!type) notFound()
  const everyDays = type.inspectionSchedule?.everyDays ?? ''

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title={`Edit "${type.name}"`}
          description="Tweak the basic properties of this PPE type. Use the sub-tabs on the detail page to manage criteria and sizing."
          back={{ href: `/ppe/types/${id}`, label: 'Back to PPE type' }}
        />
        <form
          action={updateType}
          className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-6"
        >
          <input type="hidden" name="id" value={id} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" name="name" required defaultValue={type.name} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Select id="category" name="category" defaultValue={type.category ?? ''}>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="everyDays">Inspection cadence (days)</Label>
              <Input
                id="everyDays"
                name="everyDays"
                type="number"
                min={1}
                defaultValue={everyDays}
              />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                id="isInspectable"
                name="isInspectable"
                type="checkbox"
                defaultChecked={type.isInspectable}
                className="h-4 w-4 rounded border-slate-300"
              />
              <Label htmlFor="isInspectable" className="!mb-0">
                This PPE type requires periodic inspection
              </Label>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Link href={`/ppe/types/${id}`}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit">Save changes</Button>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}
