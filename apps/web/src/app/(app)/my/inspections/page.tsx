import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
// "My inspections" — inspection_records performed by the current user (as the
// inspector). Mirrors the columns from /inspections/records but pinned to
// inspectorTenantUserId = ctx.membership.id.

import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
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
import { inspectionRecords, inspectionTypes, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { WorkspaceNoIdentity } from '../_no-identity'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1c7449eea10aa1') }
}
export const dynamic = 'force-dynamic'

const SORTS = ['reference', 'occurred_at', 'status'] as const

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'closed', label: 'Closed' },
]

export default async function MyInspectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'occurred_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  // Unknown enum values from the URL are dropped rather than passed to
  // Postgres (invalid enum input → 500).
  const statusParam = pickString(sp.status)
  const statusFilter =
    statusParam && STATUS_OPTIONS.some((o) => o.value === statusParam) ? statusParam : null

  const ctx = await requireRequestContext()
  const membershipId = ctx.membership?.id ?? null

  if (!membershipId) {
    return (
      <ListPageLayout
        header={
          <PageHeader
            back={{ href: '/my', label: 'Workspace' }}
            title={tGenerated('m_1c7449eea10aa1')}
            description={tGenerated('m_13a257b1a83d33')}
            actions={
              <Link href="/inspections">
                <Button variant="outline">
                  <GeneratedText id="m_17d8d7d44e5ef7" />
                </Button>
              </Link>
            }
          />
        }
      >
        <WorkspaceNoIdentity reason="no-membership" noun="inspections" />
      </ListPageLayout>
    )
  }

  const { rows, total, statusCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [
      eq(inspectionRecords.inspectorTenantUserId, membershipId),
      isNull(inspectionRecords.deletedAt),
    ]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(inspectionRecords.reference, term),
        ilike(inspectionRecords.notes, term),
      )
      if (cond) filters.push(cond)
    }
    if (statusFilter)
      filters.push(
        eq(inspectionRecords.status, statusFilter as typeof inspectionRecords.$inferSelect.status),
      )
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'reference'
        ? [
            params.dir === 'asc'
              ? asc(inspectionRecords.reference)
              : desc(inspectionRecords.reference),
          ]
        : params.sort === 'status'
          ? [params.dir === 'asc' ? asc(inspectionRecords.status) : desc(inspectionRecords.status)]
          : [
              params.dir === 'asc'
                ? asc(inspectionRecords.occurredAt)
                : desc(inspectionRecords.occurredAt),
            ]

    const [tot] = await tx.select({ c: count() }).from(inspectionRecords).where(whereClause)
    const data = await tx
      .select({ rec: inspectionRecords, type: inspectionTypes, site: orgUnits })
      .from(inspectionRecords)
      .leftJoin(inspectionTypes, eq(inspectionTypes.id, inspectionRecords.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, inspectionRecords.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const ss = await tx
      .select({ s: inspectionRecords.status, c: count() })
      .from(inspectionRecords)
      .where(
        and(
          eq(inspectionRecords.inspectorTenantUserId, membershipId),
          isNull(inspectionRecords.deletedAt),
        ),
      )
      .groupBy(inspectionRecords.status)

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
    }
  })

  const sortProps = { basePath: '/my/inspections', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            back={{ href: '/my', label: 'Workspace' }}
            title={tGenerated('m_1c7449eea10aa1')}
            description={tGenerated('m_08798427ccca06')}
            actions={
              <div className="flex items-center gap-2">
                <Link href="/inspections/records">
                  <Button variant="outline">
                    <GeneratedText id="m_17d8d7d44e5ef7" />
                  </Button>
                </Link>
                <Link href="/inspections/records?drawer=new">
                  <Button>
                    <GeneratedText id="m_0f060bce7a52ef" />
                  </Button>
                </Link>
              </div>
            }
          />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_0326a39f690c7c')} />
            <FilterChips
              basePath="/my/inspections"
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
                params.q || statusFilter
                  ? tGenerated('m_0bb6621f58446d')
                  : tGenerated('m_126c2564fdaabf'),
              )}
              description={tGenerated('m_00d9035db6bbab')}
              action={
                <Link href="/inspections/records?drawer=new">
                  <Button>
                    <GeneratedText id="m_1edf2b8e0e3013" />
                  </Button>
                </Link>
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh
                      {...sortProps}
                      column="reference"
                      active={params.sort === 'reference'}
                    >
                      <GeneratedText id="m_036b564bb88dfe" />
                    </SortableTh>
                    <SortableTh
                      {...sortProps}
                      column="occurred_at"
                      active={params.sort === 'occurred_at'}
                    >
                      <GeneratedText id="m_14a5e97535a15a" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_074ba2f160c506" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_020146dd3d3d5a" />
                    </TableHead>
                    <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                      <GeneratedText id="m_0b9da892d6faf0" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_011c62a541c44d" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map(({ rec, type, site }) => (
                      <TableRow key={rec.id}>
                        <TableCell className="font-mono text-xs">
                          <Link href={`/inspections/records/${rec.id}`} className="hover:underline">
                            <GeneratedValue value={rec.reference} />
                          </Link>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          <GeneratedValue
                            value={formatDate(new Date(rec.occurredAt), ctx.timezone, ctx.locale)}
                          />
                        </TableCell>
                        <TableCell>
                          <GeneratedValue value={type?.name ?? '—'} />
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          <GeneratedValue value={site?.name ?? '—'} />
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              rec.status === 'closed'
                                ? 'success'
                                : rec.status === 'submitted'
                                  ? 'default'
                                  : rec.status === 'in_progress'
                                    ? 'warning'
                                    : 'secondary'
                            }
                          >
                            <GeneratedValue value={rec.status.replace('_', ' ')} />
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <GeneratedValue
                            value={
                              rec.customerSignedAt ? (
                                <Badge variant="success">
                                  <GeneratedText id="m_142c80b0b4c3f4" />
                                </Badge>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  />
                </TableBody>
              </Table>
              <Pagination
                basePath="/my/inspections"
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
