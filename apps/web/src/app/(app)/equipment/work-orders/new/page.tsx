import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { asc, eq, sql } from 'drizzle-orm'
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
import { equipmentItems, equipmentWorkOrders, people, tenantUsers, user } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { PersonSelectField } from '@/components/person-select-field'

export const metadata = { title: 'New work order' }
export const dynamic = 'force-dynamic'

const PRIORITIES = ['low', 'med', 'high'] as const

async function createWorkOrder(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '').trim()
  const summary = String(formData.get('summary') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const priority = String(formData.get('priority') ?? 'med') as (typeof PRIORITIES)[number]
  const assignedToTenantUserId = String(formData.get('assignedToTenantUserId') ?? '').trim() || null
  const reportedByPersonId = String(formData.get('reportedByPersonId') ?? '').trim() || null
  if (!itemId || !summary) throw new Error('Equipment and summary are required.')
  if (!PRIORITIES.includes(priority)) throw new Error('Invalid priority.')

  const row = await ctx.db(async (tx) => {
    const year = new Date().getFullYear()
    const counts = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(equipmentWorkOrders)
      .where(sql`extract(year from ${equipmentWorkOrders.openedAt}) = ${year}`)
    const c = counts[0]?.c ?? 0
    const reference = `WO-${year}-${String(Number(c) + 1).padStart(4, '0')}`
    const [inserted] = await tx
      .insert(equipmentWorkOrders)
      .values({
        tenantId: ctx.tenantId,
        itemId,
        reference,
        summary,
        description,
        priority,
        status: 'open',
        reportedByPersonId,
        assignedToTenantUserId,
        openedByTenantUserId: ctx.membership?.id,
      } as any)
      .returning()
    return inserted
  })

  if (!row) redirect('/equipment/work-orders')
  await recordAudit(ctx, {
    entityType: 'equipment_work_order',
    entityId: row.id,
    action: 'create',
    summary: `Opened work order ${row.reference}: ${summary}`,
    after: { reference: row.reference, itemId, priority, summary, status: 'open' },
  })
  revalidatePath('/equipment/work-orders')
  revalidatePath(`/equipment/${itemId}`)
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

  const { items, assignees, reporters } = await ctx.db(async (tx) => {
    const [i, a, r] = await Promise.all([
      tx
        .select({
          id: equipmentItems.id,
          assetTag: equipmentItems.assetTag,
          name: equipmentItems.name,
        })
        .from(equipmentItems)
        .orderBy(asc(equipmentItems.assetTag))
        .limit(500),
      tx
        .select({
          id: tenantUsers.id,
          displayName: tenantUsers.displayName,
          userName: user.name,
          email: user.email,
        })
        .from(tenantUsers)
        .leftJoin(user, eq(user.id, tenantUsers.userId))
        .where(eq(tenantUsers.status, 'active'))
        .orderBy(asc(tenantUsers.displayName))
        .limit(500),
      tx
        .select({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          employeeNo: people.employeeNo,
        })
        .from(people)
        .where(eq(people.status, 'active'))
        .orderBy(asc(people.lastName), asc(people.firstName))
        .limit(500),
    ])
    return { items: i, assignees: a, reporters: r }
  })

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
                <Select name="itemId" defaultValue={presetItemId} required>
                  <option value="">— Select equipment —</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.assetTag} · {it.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Summary" required>
                <Input name="summary" required placeholder="e.g. Brake lights inoperative" />
              </Field>
              <Field label="Description">
                <Textarea
                  name="description"
                  rows={4}
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
                  <PersonSelectField
                    name="assignedToTenantUserId"
                    defaultValue=""
                    options={assignees.map((a) => ({
                      value: a.id,
                      label: a.userName ?? a.displayName ?? a.id.slice(0, 6),
                      hint: a.email ?? undefined,
                    }))}
                    placeholder="Select an assignee..."
                    searchPlaceholder="Search people..."
                    sheetTitle="Assign to"
                    emptyLabel="Unassigned"
                  />
                </Field>
                <Field label="Reported by" className="sm:col-span-2">
                  <PersonSelectField
                    name="reportedByPersonId"
                    defaultValue=""
                    options={reporters.map((p) => ({
                      value: p.id,
                      label: `${p.lastName}, ${p.firstName}`,
                      hint: p.employeeNo ?? undefined,
                    }))}
                    placeholder="Select a person…"
                    clearable
                    emptyLabel="— Not specified —"
                  />
                </Field>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                <a href="/equipment/work-orders">
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </a>
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
