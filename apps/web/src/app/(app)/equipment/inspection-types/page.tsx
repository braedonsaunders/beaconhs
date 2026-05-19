import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { ClipboardCheck, Plus, Trash2 } from 'lucide-react'
import { asc, count, eq } from 'drizzle-orm'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import {
  equipmentInspectionCriteria,
  equipmentInspectionTypes,
  equipmentTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { ListPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'

export const metadata = { title: 'Equipment inspection types' }
export const dynamic = 'force-dynamic'

const INTERVAL_OPTIONS = [
  { value: 'pre_use', label: 'Pre-use' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
  { value: 'five_year', label: 'Every 5 years' },
  { value: 'on_demand', label: 'On demand' },
]

async function createType(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const interval = String(formData.get('interval') ?? 'on_demand').trim() || 'on_demand'
  const appliesToTypeId = String(formData.get('appliesToTypeId') ?? '').trim() || null
  const allowPassAll = formData.get('allowPassAll') === 'on'
  const failsSpawnWorkOrders = formData.get('failsSpawnWorkOrders') === 'on'
  if (!name) return

  const inserted = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(equipmentInspectionTypes)
      .values({
        tenantId: ctx.tenantId,
        name,
        description,
        interval: interval as any,
        appliesToTypeId,
        allowPassAll,
        failsSpawnWorkOrders,
      })
      .returning({ id: equipmentInspectionTypes.id })
    return row
  })
  if (inserted?.id) {
    await recordAudit(ctx, {
      entityType: 'equipment_inspection_type',
      entityId: inserted.id,
      action: 'create',
      summary: `Created inspection type "${name}"`,
      after: {
        name,
        description,
        interval,
        appliesToTypeId,
        allowPassAll,
        failsSpawnWorkOrders,
      },
    })
  }
  revalidatePath('/equipment/inspection-types')
}

async function deleteType(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return
  await ctx.db((tx) =>
    tx.delete(equipmentInspectionTypes).where(eq(equipmentInspectionTypes.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'equipment_inspection_type',
    entityId: id,
    action: 'delete',
    summary: 'Deleted inspection type',
  })
  revalidatePath('/equipment/inspection-types')
}

export default async function InspectionTypesPage() {
  const ctx = await requireRequestContext()
  const { rows, types, counts } = await ctx.db(async (tx) => {
    const data = await tx
      .select({
        t: equipmentInspectionTypes,
        applies: equipmentTypes,
      })
      .from(equipmentInspectionTypes)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentInspectionTypes.appliesToTypeId))
      .orderBy(asc(equipmentInspectionTypes.name))
    const types = await tx
      .select({ id: equipmentTypes.id, name: equipmentTypes.name })
      .from(equipmentTypes)
      .orderBy(asc(equipmentTypes.name))
    const tally = await tx
      .select({
        inspectionTypeId: equipmentInspectionCriteria.inspectionTypeId,
        c: count(),
      })
      .from(equipmentInspectionCriteria)
      .groupBy(equipmentInspectionCriteria.inspectionTypeId)
    return {
      rows: data,
      types,
      counts: Object.fromEntries(tally.map((x) => [x.inspectionTypeId, Number(x.c)])),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="inspection-types" />
          <PageHeader
            title="Inspection types"
            description="Reusable inspection templates with pass/fail criteria. Items of the same equipment type share these templates. Failed answers can auto-spawn a work order."
          />
        </>
      }
    >
      <div className="space-y-6">
        <Section title={`Templates (${rows.length})`} defaultOpen>
          {rows.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck size={28} />}
              title="No inspection templates yet"
              description="Add a template below — then add pass/fail criteria from the template detail page."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Applies to type</TableHead>
                    <TableHead>Interval</TableHead>
                    <TableHead className="text-right">Criteria</TableHead>
                    <TableHead>Auto-WO on fail</TableHead>
                    <TableHead>Pass-all</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ t, applies }) => {
                    const n = counts[t.id] ?? 0
                    return (
                      <TableRow key={t.id}>
                        <TableCell>
                          <Link
                            href={`/equipment/inspection-types/${t.id}`}
                            className="font-medium hover:underline"
                          >
                            {t.name}
                          </Link>
                          {t.description ? (
                            <div className="text-xs text-slate-500">{t.description}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-slate-600">
                          {applies?.name ?? <span className="italic text-slate-400">any</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{t.interval.replace('_', ' ')}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={n > 0 ? 'success' : 'warning'}>{n}</Badge>
                        </TableCell>
                        <TableCell>
                          {t.failsSpawnWorkOrders ? (
                            <Badge variant="success">Yes</Badge>
                          ) : (
                            <Badge variant="secondary">No</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {t.allowPassAll ? (
                            <Badge variant="success">Yes</Badge>
                          ) : (
                            <Badge variant="secondary">No</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Link href={`/equipment/inspection-types/${t.id}`}>
                              <Button size="sm" variant="outline">
                                <Plus size={12} /> Criteria
                              </Button>
                            </Link>
                            <form action={deleteType}>
                              <input type="hidden" name="id" value={t.id} />
                              <Button type="submit" size="sm" variant="outline">
                                <Trash2 size={12} />
                              </Button>
                            </form>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>

        <Section title="Create a new inspection template" defaultOpen>
          <form action={createType} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Name *</Label>
              <Input name="name" required placeholder="e.g. Pickup truck — Annual safety" />
            </div>
            <div className="space-y-1.5">
              <Label>Applies to equipment type</Label>
              <Select name="appliesToTypeId" defaultValue="">
                <option value="">— Any —</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Interval</Label>
              <Select name="interval" defaultValue="on_demand">
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Description</Label>
              <Textarea name="description" rows={2} />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="allowPassAll" defaultChecked />
                <span>Allow "pass all" shortcut</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="failsSpawnWorkOrders" defaultChecked />
                <span>Failed criterion auto-creates a work order</span>
              </label>
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit">Create template</Button>
            </div>
          </form>
        </Section>
      </div>
    </ListPageLayout>
  )
}
