import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
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
import {
  customFieldDefinitions,
  ppeItems,
  ppeTypeInspectionCriteria,
  ppeTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule, requireModuleManage } from '@/lib/module-admin/guard'
import { recordAuditInTransaction } from '@/lib/audit'
import { deletePpeTypeInTransaction } from '@/lib/ppe-type-deletion'
import { parseListParams } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { PpeSubNav } from '@/components/ppe-sub-nav'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0f5423f9b22ae3') }
}
export const dynamic = 'force-dynamic'

const BASE = '/ppe/types'
const SORTS = ['name', 'category', 'criteria', 'items'] as const

async function deleteType(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'ppe')
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return
  await ctx.db(async (tx) => {
    await deletePpeTypeInTransaction(tx, ctx.tenantId, id)
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'ppe_type',
      entityId: id,
      action: 'delete',
      summary: 'Deleted PPE type',
    })
  })
  revalidatePath(BASE)
}

export default async function PpeTypesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
    const fieldCount = sql<number>`count(distinct ${customFieldDefinitions.id})`.mapWith(Number)

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
      .select({ type: ppeTypes, itemCount, criteriaCount, fieldCount })
      .from(ppeTypes)
      .leftJoin(ppeItems, eq(ppeItems.typeId, ppeTypes.id))
      .leftJoin(ppeTypeInspectionCriteria, eq(ppeTypeInspectionCriteria.ppeTypeId, ppeTypes.id))
      .leftJoin(
        customFieldDefinitions,
        and(
          eq(customFieldDefinitions.entityKind, 'ppe'),
          eq(customFieldDefinitions.subtypeId, ppeTypes.id),
          isNull(customFieldDefinitions.deletedAt),
        ),
      )
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
            title={tGenerated('m_0f5423f9b22ae3')}
            description={tGenerated('m_1f13ad253e1349')}
            actions={
              <Link href="/ppe/types/new">
                <Button>
                  <GeneratedText id="m_06547ec49998fb" />
                </Button>
              </Link>
            }
          />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_11a12aae7257b0')} />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck size={32} />}
              title={tGeneratedValue(
                params.q
                  ? tGenerated('m_059fe4da628141', { value0: params.q })
                  : tGenerated('m_0086db99e47e15'),
              )}
              description={tGenerated('m_029fde17f662ff')}
              action={
                <Link href="/ppe/types/new">
                  <Button>
                    <GeneratedText id="m_06547ec49998fb" />
                  </Button>
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
                        <GeneratedText id="m_02b18d5c7f6f2d" />
                      </SortableTh>
                      <SortableTh
                        {...sortProps}
                        column="category"
                        active={params.sort === 'category'}
                      >
                        <GeneratedText id="m_108b41637f364f" />
                      </SortableTh>
                      <TableHead>
                        <GeneratedText id="m_17f3fef7e62178" />
                      </TableHead>
                      <SortableTh
                        {...sortProps}
                        column="criteria"
                        active={params.sort === 'criteria'}
                        className="text-right"
                      >
                        <GeneratedText id="m_1a1ce62686f0b8" />
                      </SortableTh>
                      <SortableTh
                        {...sortProps}
                        column="items"
                        active={params.sort === 'items'}
                        className="text-right"
                      >
                        <GeneratedText id="m_16f8d81a1560d8" />
                      </SortableTh>
                      <TableHead className="text-right">
                        <GeneratedText id="m_164d658c8fd29c" />
                      </TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <GeneratedValue
                      value={rows.map(({ type: t, itemCount, criteriaCount, fieldCount }) => (
                        <TableRow key={t.id}>
                          <TableCell>
                            <Link
                              href={`/ppe/types/${t.id}`}
                              className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                            >
                              <GeneratedValue value={t.name} />
                            </Link>
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            <GeneratedValue value={t.category ?? '—'} />
                          </TableCell>
                          <TableCell>
                            <GeneratedValue
                              value={
                                t.isInspectable ? (
                                  <Badge variant="success">
                                    <GeneratedText id="m_1b34c7d70d09bd" />
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary">
                                    <GeneratedText id="m_117d1a5e1ef440" />
                                  </Badge>
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={criteriaCount > 0 ? 'secondary' : 'warning'}>
                              <GeneratedValue value={criteriaCount} />
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="secondary">
                              <GeneratedValue value={itemCount} />
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="secondary">
                              <GeneratedValue value={fieldCount} />
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Link href={`/ppe/types/${t.id}`}>
                                <Button size="sm" variant="outline">
                                  <Pencil size={12} /> <GeneratedText id="m_03a66f9d34ac7b" />
                                </Button>
                              </Link>
                              <form action={deleteType}>
                                <input type="hidden" name="id" value={t.id} />
                                <Button
                                  type="submit"
                                  size="sm"
                                  variant="outline"
                                  disabled={itemCount > 0 || fieldCount > 0}
                                  title={tGeneratedValue(
                                    itemCount > 0 || fieldCount > 0
                                      ? tGenerated('m_0ec08428d4f01b', {
                                          value0: [
                                            itemCount > 0 ? `${itemCount} item(s)` : null,
                                            fieldCount > 0
                                              ? `${fieldCount} scoped custom field(s)`
                                              : null,
                                          ]
                                            .filter(Boolean)
                                            .join(' and '),
                                        })
                                      : tGenerated('m_12fda1066d2e96'),
                                  )}
                                >
                                  <Trash2 size={12} />
                                </Button>
                              </form>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    />
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
          )
        }
      />
    </ListPageLayout>
  )
}
