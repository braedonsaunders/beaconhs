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
import { inspectionTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Edit inspection type' }

const CADENCES = [
  { value: '', label: '— No default —' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'year', label: 'Yearly' },
]

async function updateType(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'inspections')
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const description = String(formData.get('description') ?? '').trim() || null
  const requiresForeman = String(formData.get('requiresForeman') ?? '') === 'on'
  const requiresCustomerSignature = String(formData.get('requiresCustomerSignature') ?? '') === 'on'
  const enableCorrectiveActions = String(formData.get('enableCorrectiveActions') ?? '') === 'on'
  const allowCompliantNotes = String(formData.get('allowCompliantNotes') ?? '') === 'on'
  const isPublished = String(formData.get('isPublished') ?? '') === 'on'
  const defaultCadence = String(formData.get('defaultCadence') ?? '').trim() || null

  await ctx.db((tx) =>
    tx
      .update(inspectionTypes)
      .set({
        name,
        description,
        requiresForeman,
        requiresCustomerSignature,
        enableCorrectiveActions,
        allowCompliantNotes,
        defaultCadence,
        isPublished,
      })
      .where(eq(inspectionTypes.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'inspection_type',
    entityId: id,
    action: 'update',
    summary: 'Type details updated',
    after: {
      name,
      requiresForeman,
      requiresCustomerSignature,
      enableCorrectiveActions,
      isPublished,
    },
  })
  revalidatePath(`/inspections/types/${id}`)
  revalidatePath('/inspections/types')
  redirect(`/inspections/types/${id}`)
}

export default async function EditInspectionTypePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireModuleManage('inspections')
  const type = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(inspectionTypes).where(eq(inspectionTypes.id, id)).limit(1)
    return row ?? null
  })
  if (!type) notFound()

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: `/inspections/types/${id}`, label: 'Back to type' }}
          title={`Edit ${type.name}`}
        />
        <Card>
          <CardContent className="pt-6">
            <form action={updateType} className="space-y-4">
              <input type="hidden" name="id" value={id} />
              <Field label="Name" required>
                <Input name="name" required defaultValue={type.name} />
              </Field>
              <Field label="Description">
                <Textarea name="description" rows={3} defaultValue={type.description ?? ''} />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Default cadence">
                  <Select name="defaultCadence" defaultValue={type.defaultCadence ?? ''}>
                    {CADENCES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="space-y-2 pt-7 text-sm">
                  <Toggle
                    name="requiresForeman"
                    label="Requires foreman"
                    defaultChecked={type.requiresForeman}
                  />
                  <Toggle
                    name="requiresCustomerSignature"
                    label="Requires customer signature"
                    defaultChecked={type.requiresCustomerSignature}
                  />
                  <Toggle
                    name="enableCorrectiveActions"
                    label="Auto-spawn corrective actions on fail (severity ≥ high)"
                    defaultChecked={type.enableCorrectiveActions}
                  />
                  <Toggle
                    name="allowCompliantNotes"
                    label="Allow compliant notes"
                    defaultChecked={type.allowCompliantNotes}
                  />
                  <Toggle name="isPublished" label="Published" defaultChecked={type.isPublished} />
                </div>
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

function Toggle({
  name,
  label,
  defaultChecked,
}: {
  name: string
  label: string
  defaultChecked?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
      />
      <span>{label}</span>
    </label>
  )
}
