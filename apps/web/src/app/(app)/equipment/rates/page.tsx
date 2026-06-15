import { revalidatePath } from 'next/cache'
import { Coins, DollarSign } from 'lucide-react'
import { asc, eq } from 'drizzle-orm'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { equipmentCategories, equipmentRates, equipmentTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { ListPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'

export const metadata = { title: 'Equipment rates' }
export const dynamic = 'force-dynamic'

function fmtMoney(value: string | null | undefined, currency = 'CAD'): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(n)
}

function numOrNull(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? '').trim()
  if (v === '') return null
  const n = Number(v)
  if (Number.isNaN(n)) return null
  return n.toFixed(2)
}

async function upsertRate(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const typeId = String(formData.get('typeId') ?? '').trim()
  if (!typeId) return
  const currency = String(formData.get('currency') ?? 'CAD').trim() || 'CAD'
  const category = String(formData.get('category') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  const hourly = numOrNull(formData, 'hourly')
  const daily = numOrNull(formData, 'daily')
  const weekly = numOrNull(formData, 'weekly')
  const monthly = numOrNull(formData, 'monthly')

  await ctx.db(async (tx) => {
    const [existing] = await tx
      .select()
      .from(equipmentRates)
      .where(eq(equipmentRates.typeId, typeId))
      .limit(1)
    if (existing) {
      await tx
        .update(equipmentRates)
        .set({ category, hourly, daily, weekly, monthly, currency, notes })
        .where(eq(equipmentRates.id, existing.id))
      await recordAudit(ctx, {
        entityType: 'equipment_rate',
        entityId: existing.id,
        action: 'update',
        summary: 'Updated equipment rate',
        before: {
          hourly: existing.hourly,
          daily: existing.daily,
          weekly: existing.weekly,
          monthly: existing.monthly,
        },
        after: { hourly, daily, weekly, monthly, category },
      })
    } else {
      const [row] = await tx
        .insert(equipmentRates)
        .values({
          tenantId: ctx.tenantId,
          typeId,
          category,
          hourly,
          daily,
          weekly,
          monthly,
          currency,
          notes,
        })
        .returning({ id: equipmentRates.id })
      if (row?.id) {
        await recordAudit(ctx, {
          entityType: 'equipment_rate',
          entityId: row.id,
          action: 'create',
          summary: 'Created equipment rate',
          after: { typeId, hourly, daily, weekly, monthly, category },
        })
      }
    }
  })
  revalidatePath('/equipment/rates')
}

export default async function EquipmentRatesPage() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx
      .select({
        type: equipmentTypes,
        cat: equipmentCategories,
        rate: equipmentRates,
      })
      .from(equipmentTypes)
      .leftJoin(equipmentCategories, eq(equipmentCategories.id, equipmentTypes.categoryId))
      .leftJoin(equipmentRates, eq(equipmentRates.typeId, equipmentTypes.id))
      .orderBy(asc(equipmentTypes.name)),
  )

  // Aggregate metrics for the header.
  const filled = rows.filter((r) => r.rate !== null).length
  const totalMonthly = rows.reduce((sum, r) => {
    const n = Number(r.rate?.monthly ?? 0)
    return sum + (Number.isFinite(n) ? n : 0)
  }, 0)
  const currency = rows.find((r) => r.rate?.currency)?.rate?.currency ?? 'CAD'

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="rates" />
          <PageHeader
            title="Equipment rates"
            description="Billing rates by equipment type. Drives the ROI and monthly charges reports."
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Badge variant="secondary">{rows.length} types</Badge>
            <Badge variant={filled > 0 ? 'success' : 'warning'}>{filled} with rates set</Badge>
            <Badge variant="secondary">
              {fmtMoney(totalMonthly.toFixed(2), currency)} total monthly
            </Badge>
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Coins size={32} />}
          title="No equipment types"
          description="Create equipment types first to set per-type billing rates."
        />
      ) : (
        <Section title="Rate matrix" defaultOpen>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Hourly</TableHead>
                  <TableHead className="text-right">Daily</TableHead>
                  <TableHead className="text-right">Weekly</TableHead>
                  <TableHead className="text-right">Monthly</TableHead>
                  <TableHead className="text-right">Currency</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ type, cat, rate }) => (
                  <TableRow key={type.id}>
                    <TableCell>
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {type.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">
                      {cat?.name ?? type.category ?? '—'}
                    </TableCell>
                    <TableCell className="text-right text-slate-700 dark:text-slate-300">
                      {fmtMoney(rate?.hourly, rate?.currency ?? 'CAD')}
                    </TableCell>
                    <TableCell className="text-right text-slate-700 dark:text-slate-300">
                      {fmtMoney(rate?.daily, rate?.currency ?? 'CAD')}
                    </TableCell>
                    <TableCell className="text-right text-slate-700 dark:text-slate-300">
                      {fmtMoney(rate?.weekly, rate?.currency ?? 'CAD')}
                    </TableCell>
                    <TableCell className="text-right text-slate-700 dark:text-slate-300">
                      {fmtMoney(rate?.monthly, rate?.currency ?? 'CAD')}
                    </TableCell>
                    <TableCell className="text-right text-xs text-slate-500 dark:text-slate-400">
                      {rate?.currency ?? '—'}
                    </TableCell>
                    <TableCell>
                      <details className="relative">
                        <summary className="cursor-pointer list-none text-xs text-teal-700 hover:underline dark:text-teal-400">
                          <DollarSign size={12} className="inline" /> Edit
                        </summary>
                        <div className="absolute right-0 z-10 mt-1 w-[28rem] rounded-md border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-800 dark:bg-slate-900">
                          <form action={upsertRate} className="space-y-3">
                            <input type="hidden" name="typeId" value={type.id} />
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label>Hourly</Label>
                                <Input
                                  name="hourly"
                                  type="number"
                                  step="0.01"
                                  defaultValue={rate?.hourly ?? ''}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Daily</Label>
                                <Input
                                  name="daily"
                                  type="number"
                                  step="0.01"
                                  defaultValue={rate?.daily ?? ''}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Weekly</Label>
                                <Input
                                  name="weekly"
                                  type="number"
                                  step="0.01"
                                  defaultValue={rate?.weekly ?? ''}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Monthly</Label>
                                <Input
                                  name="monthly"
                                  type="number"
                                  step="0.01"
                                  defaultValue={rate?.monthly ?? ''}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Currency</Label>
                                <Input
                                  name="currency"
                                  defaultValue={rate?.currency ?? 'CAD'}
                                  maxLength={3}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Category override</Label>
                                <Input
                                  name="category"
                                  defaultValue={rate?.category ?? ''}
                                  placeholder="optional"
                                />
                              </div>
                              <div className="col-span-2 space-y-1.5">
                                <Label>Notes</Label>
                                <Input
                                  name="notes"
                                  defaultValue={rate?.notes ?? ''}
                                  placeholder="e.g. fuel surcharge applied"
                                />
                              </div>
                            </div>
                            <div className="flex justify-end">
                              <Button size="sm" type="submit">
                                Save rate
                              </Button>
                            </div>
                          </form>
                        </div>
                      </details>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      )}
    </ListPageLayout>
  )
}
