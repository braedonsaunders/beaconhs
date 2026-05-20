import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { ClipboardList } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, sql, type SQL } from 'drizzle-orm'
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
import { inspectionTypeBanks, inspectionTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { InspectionsSubNav } from '../_sub-nav'
import { InspectionTypesDrawers } from './_drawers'

export const metadata = { title: 'Inspection Types' }
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
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const c = ilike(inspectionTypes.name, term)
      if (c) filters.push(c)
    }
    if (statusFilter === 'published') filters.push(eq(inspectionTypes.isPublished, true))
    if (statusFilter === 'draft') filters.push(eq(inspectionTypes.isPublished, false))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'created_at'
        ? [params.dir === 'asc' ? asc(inspectionTypes.createdAt) : desc(inspectionTypes.createdAt)]
        : params.sort === 'status'
          ? [params.dir === 'asc' ? asc(inspectionTypes.isPublished) : desc(inspectionTypes.isPublished)]
          : [params.dir === 'asc' ? asc(inspectionTypes.name) : desc(inspectionTypes.name)]

    const [tot] = await tx.select({ c: count() }).from(inspectionTypes).where(whereClause)

    const data = await tx
      .select({
        type: inspectionTypes,
        bankCount: sql<number>`count(distinct ${inspectionTypeBanks.bankId})`.mapWith(Number),
      })
      .from(inspectionTypes)
      .leftJoin(inspectionTypeBanks, eq(inspectionTypeBanks.typeId, inspectionTypes.id))
      .where(whereClause)
      .groupBy(inspectionTypes.id)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const ss = await tx
      .select({ p: inspectionTypes.isPublished, c: count() })
      .from(inspectionTypes)
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
            title="Inspection Types"
            description="Admin-defined inspection templates. Each type bundles N criteria banks and toggles foreman / customer-signature requirements."
            actions={
              <Link href="/inspections/types?drawer=new-type" scroll={false}>
                <Button>New type</Button>
              </Link>
            }
          />
          <InspectionsSubNav active="types" />
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search by type name" />
          </div>
          <FilterChips
            basePath="/inspections/types"
            currentParams={sp}
            paramKey="status"
            label="Status"
            options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={32} />}
          title={params.q ? `No types match "${params.q}"` : 'No inspection types yet'}
          description="Create a type, link a few criteria banks, and reuse it for every inspection of that kind."
          action={
            <Link href="/inspections/types?drawer=new-type" scroll={false}>
              <Button>New type</Button>
            </Link>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                  Name
                </SortableTh>
                <TableHead>Banks</TableHead>
                <TableHead>Requires</TableHead>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                  Status
                </SortableTh>
                <SortableTh {...sortProps} column="created_at" active={params.sort === 'created_at'}>
                  Created
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ type, bankCount }) => (
                <TableRow key={type.id}>
                  <TableCell>
                    <Link
                      href={`/inspections/types/${type.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {type.name}
                    </Link>
                    {type.description ? (
                      <div className="mt-0.5 text-xs text-slate-500 line-clamp-1">
                        {type.description}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-slate-600 tabular-nums">{bankCount}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {type.requiresForeman ? (
                        <Badge variant="secondary">Foreman</Badge>
                      ) : null}
                      {type.requiresCustomerSignature ? (
                        <Badge variant="secondary">Customer sig</Badge>
                      ) : null}
                      {type.enableCorrectiveActions ? (
                        <Badge variant="secondary">CA auto-spawn</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={type.isPublished ? 'success' : 'secondary'}>
                      {type.isPublished ? 'Published' : 'Draft'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {new Date(type.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
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
      )}
      <InspectionTypesDrawers
        openDrawer={openDrawer}
        closeHref="/inspections/types"
        createTypeAction={createTypeAction}
      />
    </ListPageLayout>
  )
}
