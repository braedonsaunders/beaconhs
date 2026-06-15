import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { Notebook, Trash2 } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
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
import { equipmentItems, equipmentLogEntries, equipmentTypes, people } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { Section } from '@/components/section'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { PersonSelectField } from '@/components/person-select-field'

export const metadata = { title: 'Equipment log' }
export const dynamic = 'force-dynamic'

const SORTS = ['entry_date', 'kind'] as const
const KIND_OPTIONS = [
  { value: 'note', label: 'Note' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'incident', label: 'Incident' },
  { value: 'modification', label: 'Modification' },
]

async function createEntry(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('equipmentItemId') ?? '').trim()
  const entryDate = String(formData.get('entryDate') ?? '').trim()
  const kind = String(formData.get('kind') ?? 'note').trim() || 'note'
  const title = String(formData.get('title') ?? '').trim() || null
  const details = String(formData.get('details') ?? '').trim()
  const personPersonId = String(formData.get('personPersonId') ?? '').trim() || null
  if (!itemId || !entryDate || !details) return

  const inserted = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(equipmentLogEntries)
      .values({
        tenantId: ctx.tenantId,
        equipmentItemId: itemId,
        entryDate,
        kind,
        title,
        details,
        personPersonId,
        createdByTenantUserId: ctx.membership?.id,
      })
      .returning({ id: equipmentLogEntries.id })
    return row
  })
  if (inserted?.id) {
    await recordAudit(ctx, {
      entityType: 'equipment_log_entry',
      entityId: inserted.id,
      action: 'create',
      summary: `Logged ${kind} entry`,
      after: { itemId, entryDate, kind, title, details: details.slice(0, 200) },
    })
  }
  revalidatePath('/equipment/log')
  revalidatePath(`/equipment/${itemId}`)
}

async function deleteEntry(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return
  const removed = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ itemId: equipmentLogEntries.equipmentItemId })
      .from(equipmentLogEntries)
      .where(eq(equipmentLogEntries.id, id))
      .limit(1)
    await tx.delete(equipmentLogEntries).where(eq(equipmentLogEntries.id, id))
    return row
  })
  await recordAudit(ctx, {
    entityType: 'equipment_log_entry',
    entityId: id,
    action: 'delete',
    summary: 'Deleted equipment log entry',
  })
  revalidatePath('/equipment/log')
  if (removed?.itemId) revalidatePath(`/equipment/${removed.itemId}`)
}

export default async function EquipmentLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'entry_date',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const kindFilter = pickString(sp.kind)
  const itemFilter = pickString(sp.item)
  const ctx = await requireRequestContext()

  const { rows, total, items, peopleList, kindCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(equipmentLogEntries.title, term),
        ilike(equipmentLogEntries.details, term),
      )
      if (cond) filters.push(cond)
    }
    if (kindFilter) filters.push(eq(equipmentLogEntries.kind, kindFilter))
    if (itemFilter) filters.push(eq(equipmentLogEntries.equipmentItemId, itemFilter))
    const where = filters.length ? and(...filters) : undefined

    const orderBy =
      params.sort === 'kind'
        ? [params.dir === 'asc' ? asc(equipmentLogEntries.kind) : desc(equipmentLogEntries.kind)]
        : [
            params.dir === 'asc'
              ? asc(equipmentLogEntries.entryDate)
              : desc(equipmentLogEntries.entryDate),
          ]

    const [tot] = await tx.select({ c: count() }).from(equipmentLogEntries).where(where)
    const data = await tx
      .select({
        log: equipmentLogEntries,
        item: equipmentItems,
        type: equipmentTypes,
        person: people,
      })
      .from(equipmentLogEntries)
      .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentLogEntries.equipmentItemId))
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(people, eq(people.id, equipmentLogEntries.personPersonId))
      .where(where)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const allItems = await tx
      .select({ id: equipmentItems.id, name: equipmentItems.name, tag: equipmentItems.assetTag })
      .from(equipmentItems)
      .orderBy(asc(equipmentItems.assetTag))
      .limit(500)
    const allPeople = await tx
      .select({
        id: people.id,
        first: people.firstName,
        last: people.lastName,
        employeeNo: people.employeeNo,
      })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
      .limit(500)
    const kinds = await tx
      .select({ kind: equipmentLogEntries.kind, c: count() })
      .from(equipmentLogEntries)
      .groupBy(equipmentLogEntries.kind)
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      items: allItems,
      peopleList: allPeople,
      kindCounts: Object.fromEntries(kinds.map((x) => [x.kind, Number(x.c)])),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="log" />
          <PageHeader
            title="Equipment log"
            description="Fleet notes log, separate from work orders."
          />
          <TableToolbar>
            <SearchInput placeholder="Search title or details…" />
            <FilterChips
              basePath="/equipment/log"
              currentParams={sp}
              paramKey="kind"
              label="Kind"
              options={KIND_OPTIONS.map((o) => ({ ...o, count: kindCounts[o.value] }))}
            />
          </TableToolbar>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Badge variant="secondary">{total} entries</Badge>
          </div>
        </>
      }
    >
      <div className="space-y-6">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Notebook size={32} />}
            title={
              params.q || kindFilter || itemFilter
                ? 'No log entries match these filters'
                : 'No log entries'
            }
            description="Add a new entry below to record an observation against a piece of equipment."
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Equipment</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Title / details</TableHead>
                    <TableHead>Person</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ log, item, type, person }) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs">{log.entryDate}</TableCell>
                      <TableCell>
                        {item ? (
                          <Link href={`/equipment/${item.id}?tab=log`} className="hover:underline">
                            <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                              {item.assetTag}
                            </div>
                            <div className="text-sm font-medium">{item.name}</div>
                            {type ? (
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                {type.name}
                              </div>
                            ) : null}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{log.kind}</Badge>
                      </TableCell>
                      <TableCell>
                        {log.title ? <div className="font-medium">{log.title}</div> : null}
                        <div className="max-w-xl text-xs whitespace-pre-wrap text-slate-600 dark:text-slate-400">
                          {log.details}
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-400">
                        {person ? `${person.firstName} ${person.lastName}` : '—'}
                      </TableCell>
                      <TableCell>
                        <form action={deleteEntry}>
                          <input type="hidden" name="id" value={log.id} />
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
              basePath="/equipment/log"
              currentParams={sp}
              total={total}
              page={params.page}
              perPage={params.perPage}
            />
          </>
        )}

        <Section title="Add a log entry" defaultOpen={false}>
          <form action={createEntry} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                name="entryDate"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Kind *</Label>
              <Select name="kind" defaultValue="note">
                {KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Title</Label>
              <Input name="title" placeholder="Short summary (optional)" />
            </div>
            <div className="space-y-1.5">
              <Label>Person</Label>
              <PersonSelectField
                name="personPersonId"
                defaultValue=""
                options={peopleList.map((p) => ({
                  value: p.id,
                  label: `${p.last}, ${p.first}`,
                  hint: p.employeeNo ?? undefined,
                }))}
                placeholder="Select a person…"
                clearable
                emptyLabel="—"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <Label>Details *</Label>
              <Textarea name="details" rows={3} required placeholder="What did you observe?" />
            </div>
            <div className="flex justify-end sm:col-span-3">
              <Button type="submit">Add entry</Button>
            </div>
          </form>
        </Section>
      </div>
    </ListPageLayout>
  )
}
