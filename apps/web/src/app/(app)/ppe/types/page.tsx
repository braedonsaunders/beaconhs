// /ppe/types — admin CRUD list of PPE types.
//
// Each row shows the type name, category, the count of criteria configured, and
// the count of items in the register, with quick links to the type detail
// (sub-tabs: general / criteria / sizing) or to delete it. New types go through
// /ppe/types/new which renders the same form pattern as the rest of the
// platform (a wizard-like single-screen form with a sub-nav).

import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { Pencil, ShieldCheck, Trash2 } from 'lucide-react'
import { asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { ppeItems, ppeTypeInspectionCriteria, ppeTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule, requireModuleManage } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { parseListParams } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { PpeSubNav } from '@/components/ppe-sub-nav'

export const metadata = { title: 'PPE types' }
export const dynamic = 'force-dynamic'

const BASE = '/ppe/types'
const SORTS = ['name', 'category', 'criteria', 'items'] as const

async function deleteType(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'ppe')
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return
  await ctx.db((tx) => tx.delete(ppeTypes).where(eq(ppeTypes.id, id)))
  await recordAudit(ctx, {
    entityType: 'ppe_type',
    entityId: id,
    action: 'delete',
    summary: 'Deleted PPE type',
  })
  revalidatePath(BASE)
}

export default async function PpeTypesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const ctx = await requireModuleManage('ppe')

  const { rows, total } = await ctx.db(async (tx) => {
    const search: SQL<unknown> | undefined = params.q
      ? or(ilike(ppeTypes.name, `%${params.q}%`), ilike(ppeTypes.category, `%${params.q}%`))
      : undefined

    const itemCount = sql<number>`count(distinct ${ppeItems.id})`.mapWith(Number)
    const criteriaCount = sql<number>`count(distinct ${ppeTypeInspectionCriteria.id})`.mapWith(
      Number,
    )

    const dirFn = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'category'
        ? [dirFn(ppeTypes.category), asc(ppeTypes.name)]
        : params.sort === 'criteria'
          ? [dirFn(criteriaCount), asc(ppeTypes.name)]
          : params.sort === 'items'
            ? [dirFn(itemCount), asc(ppeTypes.name)]
            : [dirFn(ppeTypes.name)]

    const [tot] = await tx.select({ c: count() }).from(ppeTypes).where(search)

    const data = await tx
      .select({ type: ppeTypes, itemCount, criteriaCount })
      .from(ppeTypes)
      .leftJoin(ppeItems, eq(ppeItems.typeId, ppeTypes.id))
      .leftJoin(ppeTypeInspectionCriteria, eq(ppeTypeInspectionCriteria.ppeTypeId, ppeTypes.id))
      .where(search)
      .groupBy(ppeTypes.id)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    return { rows: data, total: Number(tot?.c ?? 0) }
  })

  const sortProps = { basePath: BASE, currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PpeSubNav active="types" />
          <PageHeader
            title="PPE types"
            description="PPE catalog with criteria, sizing, and cadence per type."
            actions={
              <Link href="/ppe/types/new">
                <Button>New PPE type</Button>
              </Link>
            }
          />
          <TableToolbar>
            <SearchInput placeholder="Search by name or category" />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={32} />}
          title={params.q ? `No PPE types match "${params.q}"` : 'No PPE types'}
          description="Add types like Hard hat, Harness, Safety glasses, Gloves — every PPE item must belong to a type."
          action={
            <Link href="/ppe/types/new">
              <Button>New PPE type</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                    Name
                  </SortableTh>
                  <SortableTh {...sortProps} column="category" active={params.sort === 'category'}>
                    Category
                  </SortableTh>
                  <TableHead>Inspectable</TableHead>
                  <SortableTh
                    {...sortProps}
                    column="criteria"
                    active={params.sort === 'criteria'}
                    className="text-right"
                  >
                    Criteria
                  </SortableTh>
                  <SortableTh
                    {...sortProps}
                    column="items"
                    active={params.sort === 'items'}
                    className="text-right"
                  >
                    Items
                  </SortableTh>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ type: t, itemCount, criteriaCount }) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link
                        href={`/ppe/types/${t.id}`}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {t.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">
                      {t.category ?? '—'}
                    </TableCell>
                    <TableCell>
                      {t.isInspectable ? (
                        <Badge variant="success">Yes</Badge>
                      ) : (
                        <Badge variant="secondary">No</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={criteriaCount > 0 ? 'secondary' : 'warning'}>
                        {criteriaCount}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{itemCount}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Link href={`/ppe/types/${t.id}`}>
                          <Button size="sm" variant="outline">
                            <Pencil size={12} /> Edit
                          </Button>
                        </Link>
                        <form action={deleteType}>
                          <input type="hidden" name="id" value={t.id} />
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            disabled={itemCount > 0}
                            title={
                              itemCount > 0
                                ? `Cannot delete — ${itemCount} item(s) reference this type`
                                : 'Delete type'
                            }
                          >
                            <Trash2 size={12} />
                          </Button>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            basePath={BASE}
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
    </ListPageLayout>
  )
}
