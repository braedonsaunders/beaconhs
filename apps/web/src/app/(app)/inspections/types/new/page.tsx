import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
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
import { inspectionTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New inspection type' }

const CADENCES = [
  { value: '', label: '— No default —' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'year', label: 'Yearly' },
]

async function createType(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const description = String(formData.get('description') ?? '').trim() || null
  const requiresForeman = String(formData.get('requiresForeman') ?? '') === 'on'
  const requiresCustomerSignature = String(formData.get('requiresCustomerSignature') ?? '') === 'on'
  const enableCorrectiveActions = String(formData.get('enableCorrectiveActions') ?? '') === 'on'
  const allowCompliantNotes = String(formData.get('allowCompliantNotes') ?? '') === 'on'
  const isPublished = String(formData.get('isPublished') ?? '') === 'on'
  const defaultCadence = String(formData.get('defaultCadence') ?? '').trim() || null

  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .insert(inspectionTypes)
      .values({
        tenantId: ctx.tenantId,
        name,
        description,
        requiresForeman,
        requiresCustomerSignature,
        enableCorrectiveActions,
        allowCompliantNotes,
        defaultCadence,
        isPublished,
        createdBy: ctx.userId,
      })
      .returning()
    return r
  })

  if (row) {
    await recordAudit(ctx, {
      entityType: 'inspection_type',
      entityId: row.id,
      action: 'create',
      summary: `Created inspection type "${name}"`,
      after: {
        name,
        requiresForeman,
        requiresCustomerSignature,
        enableCorrectiveActions,
        defaultCadence,
        isPublished,
      },
    })
  }
  revalidatePath('/inspections/types')
  if (row) redirect(`/inspections/types/${row.id}?tab=banks`)
  redirect('/inspections/types')
}

export default async function NewInspectionTypePage() {
  await requireRequestContext()
  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/inspections/types', label: 'Back to inspection types' }}
          title="New inspection type"
        />
        <Alert variant="info">
          <AlertTitle>Two-step</AlertTitle>
          <AlertDescription>
            Create the shell here, then link the criteria banks (your question pool) on the
            detail page that opens after save.
          </AlertDescription>
        </Alert>
        <Card>
          <CardContent className="pt-6">
            <form action={createType} className="space-y-4">
              <Field label="Name" required>
                <Input name="name" required placeholder="e.g. Site Daily Walk-Through" />
              </Field>
              <Field label="Description">
                <Textarea
                  name="description"
                  rows={3}
                  placeholder="When to use this type, who it's for"
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Default cadence (hint for assignments)">
                  <Select name="defaultCadence" defaultValue="">
                    {CADENCES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="space-y-2 pt-7 text-sm">
                  <Toggle name="requiresForeman" label="Requires foreman" />
                  <Toggle name="requiresCustomerSignature" label="Requires customer signature" />
                  <Toggle
                    name="enableCorrectiveActions"
                    label="Auto-spawn corrective actions on fail (severity ≥ high)"
                    defaultChecked
                  />
                  <Toggle
                    name="allowCompliantNotes"
                    label="Allow compliant notes (per-criterion comments)"
                    defaultChecked
                  />
                  <Toggle name="isPublished" label="Publish immediately" defaultChecked />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit">Create type</Button>
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
