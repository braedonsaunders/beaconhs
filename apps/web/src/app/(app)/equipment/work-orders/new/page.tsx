import Link from 'next/link'
import { redirect } from 'next/navigation'
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
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { RemoteSelectField } from '@/components/remote-search-select'
import { createEquipmentWorkOrder } from '../_lib'

export const metadata = { title: 'New work order' }
export const dynamic = 'force-dynamic'

const PRIORITIES = ['low', 'med', 'high'] as const

async function createWorkOrder(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.workorder.create')
  const itemId = String(formData.get('itemId') ?? '').trim()
  const summary = String(formData.get('summary') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const priority = String(formData.get('priority') ?? 'med') as (typeof PRIORITIES)[number]
  const assignedToTenantUserId = String(formData.get('assignedToTenantUserId') ?? '').trim() || null
  const reportedByPersonId = String(formData.get('reportedByPersonId') ?? '').trim() || null
  if (!itemId || !summary) throw new Error('Equipment and summary are required.')
  if (!PRIORITIES.includes(priority)) throw new Error('Invalid priority.')

  const row = await createEquipmentWorkOrder(ctx, {
    itemId,
    summary,
    description,
    priority,
    assignedToTenantUserId,
    reportedByPersonId,
  })
  if (!row) redirect('/equipment/work-orders')
  redirect(`/equipment/work-orders/${row.id}`)
}

export default async function NewWorkOrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const presetItemId = pickString(sp.itemId) ?? ''
  // If we already know the equipment item, prefer the drawer on the parent
  // detail page. The full-page route stays around as a fallback when there
  // is no item context (e.g. linked from the work-orders list).
  if (presetItemId) {
    redirect(`/equipment/${presetItemId}?tab=work_orders&drawer=new-work-order`)
  }
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.workorder.create')

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl space-y-6">
        <DetailHeader
          back={{ href: '/equipment/work-orders', label: 'Back to work orders' }}
          title="New work order"
          subtitle="Track a repair, inspection follow-up, or scheduled service."
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createWorkOrder} className="space-y-4">
              <Field label="Equipment" required>
                <RemoteSelectField
                  name="itemId"
                  defaultValue={presetItemId}
                  lookup="equipment-work-order-items"
                  placeholder="Select equipment…"
                  searchPlaceholder="Search asset tag or equipment…"
                  sheetTitle="Select equipment"
                  clearable={false}
                />
              </Field>
              <Field label="Summary" required>
                <Input
                  name="summary"
                  required
                  maxLength={500}
                  placeholder="e.g. Brake lights inoperative"
                />
              </Field>
              <Field label="Description">
                <Textarea
                  name="description"
                  rows={4}
                  maxLength={10000}
                  placeholder="What's wrong? Steps to reproduce, smell, sound, error code…"
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Priority" required>
                  <Select name="priority" defaultValue="med">
                    <option value="low">Low</option>
                    <option value="med">Medium</option>
                    <option value="high">High</option>
                  </Select>
                </Field>
                <Field label="Assign to">
                  <RemoteSelectField
                    name="assignedToTenantUserId"
                    defaultValue=""
                    lookup="equipment-work-order-assignees"
                    placeholder="Select an assignee..."
                    searchPlaceholder="Search active members..."
                    sheetTitle="Assign to"
                    emptyLabel="Unassigned"
                  />
                </Field>
                <Field label="Reported by" className="sm:col-span-2">
                  <RemoteSelectField
                    name="reportedByPersonId"
                    defaultValue=""
                    lookup="equipment-work-order-reporters"
                    placeholder="Select a person…"
                    searchPlaceholder="Search active people…"
                    sheetTitle="Reported by"
                    clearable
                    emptyLabel="— Not specified —"
                  />
                </Field>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                <Link href="/equipment/work-orders">
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Link>
                <Button type="submit">Create work order</Button>
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
