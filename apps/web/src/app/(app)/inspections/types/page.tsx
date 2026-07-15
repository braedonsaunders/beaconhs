import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { ClipboardList } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, sql, type SQL } from 'drizzle-orm'
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
import { inspectionTypeCriteria, inspectionTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { InspectionsSubNav } from '../_sub-nav'
import { InspectionTypesDrawers } from './_drawers'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0f249c3ac894e6') }
}
export const dynamic = 'force-dynamic'

async function createTypeAction(input: {
  name: string
  description: string | null
  requiresForeman: boolean
  requiresCustomerSignature: boolean
  enableCorrectiveActions: boolean
  allowCompliantNotes: boolean
  isPublished: boolean
  defaultCadence: string | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'inspections')
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required' }
  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .insert(inspectionTypes)
      .values({
        tenantId: ctx.tenantId,
        name,
        description: input.description,
        requiresForeman: input.requiresForeman,
        requiresCustomerSignature: input.requiresCustomerSignature,
        enableCorrectiveActions: input.enableCorrectiveActions,
        allowCompliantNotes: input.allowCompliantNotes,
        defaultCadence: input.defaultCadence,
        isPublished: input.isPublished,
        createdBy: ctx.userId,
      })
      .returning()
    return r
  })
  if (!row) return { ok: false, error: 'Failed to create inspection type' }
  await recordAudit(ctx, {
    entityType: 'inspection_type',
    entityId: row.id,
    action: 'create',
    summary: `Created inspection type "${name}"`,
    after: {
      name,
      requiresForeman: input.requiresForeman,
      requiresCustomerSignature: input.requiresCustomerSignature,
      enableCorrectiveActions: input.enableCorrectiveActions,
      defaultCadence: input.defaultCadence,
      isPublished: input.isPublished,
    },
  })
  revalidatePath('/inspections/types')
  return { ok: true, id: row.id }
}

const SORTS = ['name', 'created_at', 'status'] as const

const STATUS_OPTIONS = [
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
]

export default async function InspectionTypesPage({
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
  const statusFilter = pickString(sp.status)
  const ctx = await requireModuleManage('inspections')

  const { rows, total, statusCounts } = await ctx.db(async (tx) => {
    // Types are soft-deleted; keep deleted rows out of the list and its counts.
    const filters: SQL<unknown>[] = [isNull(inspectionTypes.deletedAt)]
    if (params.q) {
      const term = `%${params.q}%`
      const c = ilike(inspectionTypes.name, term)
      if (c) filters.push(c)
    }
    if (statusFilter === 'published') filters.push(eq(inspectionTypes.isPublished, true))
    if (statusFilter === 'draft') filters.push(eq(inspectionTypes.isPublished, false))
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'created_at'
        ? [params.dir === 'asc' ? asc(inspectionTypes.createdAt) : desc(inspectionTypes.createdAt)]
        : params.sort === 'status'
          ? [
              params.dir === 'asc'
                ? asc(inspectionTypes.isPublished)
                : desc(inspectionTypes.isPublished),
            ]
          : [params.dir === 'asc' ? asc(inspectionTypes.name) : desc(inspectionTypes.name)]

    const [tot] = await tx.select({ c: count() }).from(inspectionTypes).where(whereClause)

    const data = await tx
      .select({
        type: inspectionTypes,
        criteriaCount: sql<number>`count(${inspectionTypeCriteria.id})`.mapWith(Number),
      })
      .from(inspectionTypes)
      .leftJoin(inspectionTypeCriteria, eq(inspectionTypeCriteria.typeId, inspectionTypes.id))
      .where(whereClause)
      .groupBy(inspectionTypes.id)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const ss = await tx
      .select({ p: inspectionTypes.isPublished, c: count() })
      .from(inspectionTypes)
      .where(isNull(inspectionTypes.deletedAt))
      .groupBy(inspectionTypes.isPublished)
    const sc: Record<string, number> = {}
    for (const r of ss) sc[r.p ? 'published' : 'draft'] = Number(r.c)

    return { rows: data, total: Number(tot?.c ?? 0), statusCounts: sc }
  })

  const sortProps = { basePath: '/inspections/types', currentParams: sp, dir: params.dir }
  const openDrawer = pickString(sp.drawer) === 'new-type' ? 'new-type' : null

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_0f249c3ac894e6')}
            description={tGenerated('m_1171eac37d70af')}
            actions={
              <Link href="/inspections/types?drawer=new-type" scroll={false}>
                <Button>
                  <GeneratedText id="m_1271751c2db342" />
                </Button>
              </Link>
            }
          />
          <InspectionsSubNav active="types" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_17162c28f0af92')} />
            <FilterChips
              basePath="/inspections/types"
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<ClipboardList size={32} />}
              title={tGeneratedValue(
                params.q
                  ? tGenerated('m_0f9cefd4725839', { value0: params.q })
                  : tGenerated('m_10158d03ab60b5'),
              )}
              description={tGenerated('m_12d7bb0c651be6')}
              action={
                <Link href="/inspections/types?drawer=new-type" scroll={false}>
                  <Button>
                    <GeneratedText id="m_1271751c2db342" />
                  </Button>
                </Link>
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                      <GeneratedText id="m_02b18d5c7f6f2d" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_1a1ce62686f0b8" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_101f13d8360e0f" />
                    </TableHead>
                    <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                      <GeneratedText id="m_0b9da892d6faf0" />
                    </SortableTh>
                    <SortableTh
                      {...sortProps}
                      column="created_at"
                      active={params.sort === 'created_at'}
                    >
                      <GeneratedText id="m_10cbe051fb5e05" />
                    </SortableTh>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map(({ type, criteriaCount }) => (
                      <TableRow key={type.id}>
                        <TableCell>
                          <Link
                            href={`/inspections/types/${type.id}`}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            <GeneratedValue value={type.name} />
                          </Link>
                          <GeneratedValue
                            value={
                              type.description ? (
                                <div className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                                  <GeneratedValue value={type.description} />
                                </div>
                              ) : null
                            }
                          />
                        </TableCell>
                        <TableCell className="text-slate-600 tabular-nums dark:text-slate-400">
                          <GeneratedValue value={criteriaCount} />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <GeneratedValue
                              value={
                                type.requiresForeman ? (
                                  <Badge variant="secondary">
                                    <GeneratedText id="m_184fa8d9234543" />
                                  </Badge>
                                ) : null
                              }
                            />
                            <GeneratedValue
                              value={
                                type.requiresCustomerSignature ? (
                                  <Badge variant="secondary">
                                    <GeneratedText id="m_12c2155683c76d" />
                                  </Badge>
                                ) : null
                              }
                            />
                            <GeneratedValue
                              value={
                                type.enableCorrectiveActions ? (
                                  <Badge variant="secondary">
                                    <GeneratedText id="m_16c0a67486fac3" />
                                  </Badge>
                                ) : null
                              }
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={type.isPublished ? 'success' : 'secondary'}>
                            <GeneratedValue
                              value={
                                type.isPublished ? (
                                  <GeneratedText id="m_0a65097103ae1b" />
                                ) : (
                                  <GeneratedText id="m_13f3db1d0ca2fe" />
                                )
                              }
                            />
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          <GeneratedValue
                            value={formatDate(new Date(type.createdAt), ctx.timezone, ctx.locale)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  />
                </TableBody>
              </Table>
              <Pagination
                basePath="/inspections/types"
                currentParams={sp}
                total={total}
                page={params.page}
                perPage={params.perPage}
              />
            </>
          )
        }
      />
      <InspectionTypesDrawers
        openDrawer={openDrawer}
        closeHref="/inspections/types"
        createTypeAction={createTypeAction}
      />
    </ListPageLayout>
  )
}
