import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
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
import { inspectionBanks } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New inspection bank' }

const CATEGORIES = [
  { value: 'site_inspection', label: 'Site inspection' },
  { value: 'ppe_check', label: 'PPE check' },
  { value: 'equipment_check', label: 'Equipment check' },
  { value: 'vehicle_check', label: 'Vehicle check' },
  { value: 'workplace_audit', label: 'Workplace audit' },
  { value: 'other', label: 'Other' },
]

async function createBank(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'inspections')
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const description = String(formData.get('description') ?? '').trim() || null
  const category = String(formData.get('category') ?? '').trim() || null
  const isPublished = String(formData.get('isPublished') ?? '') === 'on'

  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .insert(inspectionBanks)
      .values({
        tenantId: ctx.tenantId,
        name,
        description,
        category,
        isPublished,
        createdBy: ctx.userId,
      })
      .returning()
    return r
  })
  if (row) {
    await recordAudit(ctx, {
      entityType: 'inspection_bank',
      entityId: row.id,
      action: 'create',
      summary: `Created bank "${name}"`,
      after: { name, category, isPublished },
    })
  }
  revalidatePath('/inspections/banks')
  if (row) redirect(`/inspections/banks/${row.id}?tab=criteria`)
  redirect('/inspections/banks')
}

export default async function NewInspectionBankPage() {
  await requireModuleManage('inspections')
  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/inspections/banks', label: 'Back to banks' }}
          title="New inspection bank"
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createBank} className="space-y-4">
              <Field label="Name" required>
                <Input name="name" required placeholder="e.g. Site Daily Walk-Through" />
              </Field>
              <Field label="Description">
                <Textarea
                  name="description"
                  rows={3}
                  placeholder="When to use this bank, who it's for"
                />
              </Field>
              <Field label="Category">
                <Select name="category" defaultValue="site_inspection">
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="isPublished"
                  id="isPublished"
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <Label htmlFor="isPublished" className="!m-0 cursor-pointer">
                  Publish immediately (otherwise saved as draft)
                </Label>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit">Create bank</Button>
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
