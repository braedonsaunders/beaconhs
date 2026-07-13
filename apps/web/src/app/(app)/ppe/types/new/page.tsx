// /ppe/types/new — admin form to define a new PPE type.
//
// The form mirrors the /ppe/types/[id]/edit form but starts blank. After
// creating, the user is redirected to the type detail page so they can
// configure the criteria + sizing scheme in dedicated sub-tabs.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { Button, Input, Label, PageHeader, Select } from '@beaconhs/ui'
import { ppeTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule, requireModuleManage } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New PPE type' }
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

async function createType(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'ppe')
  const name = String(formData.get('name') ?? '').trim()
  const category = String(formData.get('category') ?? '').trim() || null
  const isInspectable = formData.get('isInspectable') === 'on'
  const everyDaysRaw = String(formData.get('everyDays') ?? '').trim()
  const sizingRaw = String(formData.get('sizingScheme') ?? '').trim()
  if (!name) return

  const sizingScheme = sizingRaw
    ? sizingRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null

  const inspectionSchedule =
    isInspectable && everyDaysRaw ? { everyDays: Number(everyDaysRaw) } : null

  const typeId = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(ppeTypes)
      .values({
        tenantId: ctx.tenantId,
        name,
        category,
        isInspectable,
        sizingScheme: sizingScheme && sizingScheme.length > 0 ? sizingScheme : null,
        inspectionSchedule,
      })
      .returning({ id: ppeTypes.id })
    return row?.id
  })
  if (!typeId) return

  await recordAudit(ctx, {
    entityType: 'ppe_type',
    entityId: typeId,
    action: 'create',
    summary: `Created PPE type "${name}"`,
    after: { name, category, isInspectable, sizingScheme, inspectionSchedule },
  })
  revalidatePath('/ppe/types')
  redirect(`/ppe/types/${typeId}`)
}

export default async function NewPpeTypePage() {
  await requireModuleManage('ppe')
  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="New PPE type"
          description="Define a new PPE type. Inspection criteria and sizing scheme can be added after creation."
          back={{ href: '/ppe/types', label: 'Back to PPE types' }}
        />
        <form
          action={createType}
          className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" name="name" required placeholder="e.g. Full-body harness" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Select id="category" name="category" defaultValue="">
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="everyDays">Inspection cadence (days)</Label>
              <Input id="everyDays" name="everyDays" type="number" min={1} placeholder="e.g. 30" />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Only used when the type is marked inspectable.
              </p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sizingScheme">Sizing scheme</Label>
              <Input id="sizingScheme" name="sizingScheme" placeholder="S, M, L, XL" />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Comma-separated list of valid sizes for this type.
              </p>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                id="isInspectable"
                name="isInspectable"
                type="checkbox"
                defaultChecked
                className="h-4 w-4 rounded border-slate-300"
              />
              <Label htmlFor="isInspectable" className="!mb-0">
                This PPE type requires periodic inspection
              </Label>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Link href="/ppe/types">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit">Create type</Button>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}
