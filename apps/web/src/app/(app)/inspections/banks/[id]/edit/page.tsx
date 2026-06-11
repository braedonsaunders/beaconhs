import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
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

export const metadata = { title: 'Edit inspection bank' }

const CATEGORIES = [
  { value: 'site_inspection', label: 'Site inspection' },
  { value: 'ppe_check', label: 'PPE check' },
  { value: 'equipment_check', label: 'Equipment check' },
  { value: 'vehicle_check', label: 'Vehicle check' },
  { value: 'workplace_audit', label: 'Workplace audit' },
  { value: 'other', label: 'Other' },
]

async function updateBank(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'inspections')
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const description = String(formData.get('description') ?? '').trim() || null
  const category = String(formData.get('category') ?? '').trim() || null
  const isPublished = String(formData.get('isPublished') ?? '') === 'on'

  await ctx.db((tx) =>
    tx
      .update(inspectionBanks)
      .set({ name, description, category, isPublished })
      .where(eq(inspectionBanks.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'inspection_bank',
    entityId: id,
    action: 'update',
    summary: 'Bank details updated',
    after: { name, category, isPublished },
  })
  revalidatePath(`/inspections/banks/${id}`)
  revalidatePath('/inspections/banks')
  redirect(`/inspections/banks/${id}`)
}

export default async function EditInspectionBankPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireModuleManage('inspections')
  const bank = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(inspectionBanks).where(eq(inspectionBanks.id, id)).limit(1)
    return row ?? null
  })
  if (!bank) notFound()

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: `/inspections/banks/${id}`, label: 'Back to bank' }}
          title={`Edit ${bank.name}`}
        />
        <Card>
          <CardContent className="pt-6">
            <form action={updateBank} className="space-y-4">
              <input type="hidden" name="id" value={id} />
              <Field label="Name" required>
                <Input name="name" required defaultValue={bank.name} />
              </Field>
              <Field label="Description">
                <Textarea name="description" rows={3} defaultValue={bank.description ?? ''} />
              </Field>
              <Field label="Category">
                <Select name="category" defaultValue={bank.category ?? 'site_inspection'}>
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
                  defaultChecked={bank.isPublished}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <Label htmlFor="isPublished" className="!m-0 cursor-pointer">
                  Published
                </Label>
              </div>
              <div className="flex items-center justify-end gap-2">
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
