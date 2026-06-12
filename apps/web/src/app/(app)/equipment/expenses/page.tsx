import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { Receipt, Trash2 } from 'lucide-react'
import { and, asc, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm'
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
import { equipmentExpenses, equipmentItems, equipmentTypes, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { TableToolbar } from '@/components/table-toolbar'
import { ListPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'

export const metadata = { title: 'Equipment expenses' }
export const dynamic = 'force-dynamic'

const SORTS = ['incurred_on', 'category', 'amount', 'vendor'] as const
const CATEGORY_OPTIONS = [
  { value: 'fuel', label: 'Fuel' },
  { value: 'repair', label: 'Repair' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'registration', label: 'Registration' },
  { value: 'parts', label: 'Parts' },
  { value: 'tires', label: 'Tires' },
  { value: 'oil_change', label: 'Oil change' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'other', label: 'Other' },
]

function fmtMoney(value: string | number | null | undefined, currency = 'CAD'): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(n)
}

async function createExpense(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('equipmentItemId') ?? '').trim()
  const incurredOn = String(formData.get('incurredOn') ?? '').trim()
  const category = String(formData.get('category') ?? 'other').trim() || 'other'
  const vendor = String(formData.get('vendor') ?? '').trim() || null
  const description = String(formData.get('description') ?? '').trim() || null
  const amount = String(formData.get('amount') ?? '').trim()
  const chargedToOrgUnitId = String(formData.get('chargedToOrgUnitId') ?? '').trim() || null
  if (!itemId || !incurredOn || !amount) return
  const amountNum = Number(amount)
  if (!Number.isFinite(amountNum)) return

  const inserted = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(equipmentExpenses)
      .values({
        tenantId: ctx.tenantId,
        equipmentItemId: itemId,
        incurredOn,
        category,
        vendor,
        description,
        amount: amountNum.toFixed(2),
        chargedToOrgUnitId,
        createdByTenantUserId: ctx.membership?.id,
      })
      .returning({ id: equipmentExpenses.id })
    return row
  })
  if (inserted?.id) {
    await recordAudit(ctx, {
      entityType: 'equipment_expense',
      entityId: inserted.id,
      action: 'create',
      summary: `Logged ${fmtMoney(amountNum)} expense (${category})`,
      after: { itemId, incurredOn, category, vendor, amount: amountNum, chargedToOrgUnitId },
    })
  }
  revalidatePath('/equipment/expenses')
  revalidatePath(`/equipment/${itemId}`)
}

async function deleteExpense(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return
  const removed = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ itemId: equipmentExpenses.equipmentItemId })
      .from(equipmentExpenses)
      .where(eq(equipmentExpenses.id, id))
      .limit(1)
    await tx.delete(equipmentExpenses).where(eq(equipmentExpenses.id, id))
    return row
  })
  await recordAudit(ctx, {
    entityType: 'equipment_expense',
    entityId: id,
    action: 'delete',
    summary: 'Deleted equipment expense',
  })
  revalidatePath('/equipment/expenses')
  if (removed?.itemId) revalidatePath(`/equipment/${removed.itemId}`)
}

export default async function EquipmentExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'incurred_on',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const categoryFilter = pickString(sp.category)
  const itemFilter = pickString(sp.item)
  const fromDate = pickString(sp.from)
  const toDate = pickString(sp.to)
  const ctx = await requireRequestContext()

  const { rows, total, items, catCounts, totalAmount } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(equipmentExpenses.vendor, term),
        ilike(equipmentExpenses.description, term),
      )
      if (cond) filters.push(cond)
    }
    if (categoryFilter) filters.push(eq(equipmentExpenses.category, categoryFilter))
    if (itemFilter) filters.push(eq(equipmentExpenses.equipmentItemId, itemFilter))
    if (fromDate) filters.push(gte(equipmentExpenses.incurredOn, fromDate))
    if (toDate) filters.push(lte(equipmentExpenses.incurredOn, toDate))
    const where = filters.length ? and(...filters) : undefined

    const orderBy =
      params.sort === 'category'
        ? [
            params.dir === 'asc'
              ? asc(equipmentExpenses.category)
              : desc(equipmentExpenses.category),
          ]
        : params.sort === 'amount'
          ? [params.dir === 'asc' ? asc(equipmentExpenses.amount) : desc(equipmentExpenses.amount)]
          : params.sort === 'vendor'
            ? [
                params.dir === 'asc'
                  ? asc(equipmentExpenses.vendor)
                  : desc(equipmentExpenses.vendor),
              ]
            : [
                params.dir === 'asc'
                  ? asc(equipmentExpenses.incurredOn)
                  : desc(equipmentExpenses.incurredOn),
              ]

    const [tot] = await tx
      .select({ c: count(), sum: sql<string>`COALESCE(SUM(${equipmentExpenses.amount}), 0)::text` })
      .from(equipmentExpenses)
      .where(where)
    const data = await tx
      .select({
        e: equipmentExpenses,
        item: equipmentItems,
        type: equipmentTypes,
        site: orgUnits,
      })
      .from(equipmentExpenses)
      .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentExpenses.equipmentItemId))
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentExpenses.chargedToOrgUnitId))
      .where(where)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const allItems = await tx
      .select({ id: equipmentItems.id, name: equipmentItems.name, tag: equipmentItems.assetTag })
      .from(equipmentItems)
      .orderBy(asc(equipmentItems.assetTag))
      .limit(500)
    const cats = await tx
      .select({ category: equipmentExpenses.category, c: count() })
      .from(equipmentExpenses)
      .groupBy(equipmentExpenses.category)
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      items: allItems,
      catCounts: Object.fromEntries(cats.map((x) => [x.category, Number(x.c)])),
      totalAmount: Number(tot?.sum ?? 0),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="expenses" />
          <PageHeader
            title="Equipment expenses"
            description="Per-item expense ledger across the fleet — fuel, repairs, registration, insurance, and more."
            actions={
              <Link href={buildExportHref('/equipment/expenses/export.csv', sp)}>
                <Button variant="outline">Export CSV</Button>
              </Link>
            }
          />
          <TableToolbar>
            <SearchInput placeholder="Search vendor or description…" />
            <form className="flex items-center gap-2 text-xs text-slate-600">
              <input type="hidden" name="page" value="1" />
              {categoryFilter ? (
                <input type="hidden" name="category" value={categoryFilter} />
              ) : null}
              {itemFilter ? <input type="hidden" name="item" value={itemFilter} /> : null}
              <Label className="text-xs">From</Label>
              <Input type="date" name="from" defaultValue={fromDate ?? ''} className="h-8 w-36" />
              <Label className="text-xs">To</Label>
              <Input type="date" name="to" defaultValue={toDate ?? ''} className="h-8 w-36" />
              <Button type="submit" variant="outline" size="sm">
                Apply
              </Button>
            </form>
            <FilterChips
              basePath="/equipment/expenses"
              currentParams={sp}
              paramKey="category"
              label="Category"
              options={CATEGORY_OPTIONS.map((o) => ({ ...o, count: catCounts[o.value] }))}
            />
          </TableToolbar>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge variant="secondary">{total} entries</Badge>
            <Badge variant="warning">{fmtMoney(totalAmount.toFixed(2))} total</Badge>
          </div>
        </>
      }
    >
      <div className="space-y-6">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Receipt size={32} />}
            title={
              params.q || categoryFilter || itemFilter || fromDate || toDate
                ? 'No expenses match these filters'
                : 'No expenses logged'
            }
            description="Log an expense below to track spend per asset."
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Equipment</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Charged to</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ e, item, type, site }) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-xs">{e.incurredOn}</TableCell>
                      <TableCell>
                        {item ? (
                          <Link
                            href={`/equipment/${item.id}?tab=expenses`}
                            className="hover:underline"
                          >
                            <div className="font-mono text-xs text-slate-500">{item.assetTag}</div>
                            <div className="text-sm font-medium">{item.name}</div>
                            {type ? (
                              <div className="text-xs text-slate-500">{type.name}</div>
                            ) : null}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{e.category}</Badge>
                      </TableCell>
                      <TableCell className="text-slate-600">{e.vendor ?? '—'}</TableCell>
                      <TableCell className="max-w-xs truncate text-slate-600">
                        {e.description ?? '—'}
                      </TableCell>
                      <TableCell className="text-slate-600">{site?.name ?? '—'}</TableCell>
                      <TableCell className="text-right font-medium">
                        {fmtMoney(e.amount, e.currency)}
                      </TableCell>
                      <TableCell>
                        <form action={deleteExpense}>
                          <input type="hidden" name="id" value={e.id} />
                          <Button type="submit" size="sm" variant="outline">
                            <Trash2 size={12} />
                          </Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination
              basePath="/equipment/expenses"
              currentParams={sp}
              total={total}
              page={params.page}
              perPage={params.perPage}
            />
          </>
        )}

        <Section title="Log a new expense" defaultOpen={false}>
          <form action={createExpense} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Equipment *</Label>
              <Select name="equipmentItemId" required defaultValue={itemFilter ?? ''}>
                <option value="">— Select —</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.tag} — {i.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Date *</Label>
              <Input
                name="incurredOn"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <Select name="category" defaultValue="other">
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Vendor</Label>
              <Input name="vendor" placeholder="e.g. Petro-Canada" />
            </div>
            <div className="space-y-1.5">
              <Label>Amount *</Label>
              <Input name="amount" type="number" step="0.01" required min="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input name="description" />
            </div>
            <div className="flex justify-end sm:col-span-3">
              <Button type="submit">Log expense</Button>
            </div>
          </form>
        </Section>
      </div>
    </ListPageLayout>
  )
}
