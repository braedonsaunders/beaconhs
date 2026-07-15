import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import {
  Badge,
  Button,
  DetailHeader,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { db, withSuperAdmin } from '@beaconhs/db'
import { incidents, people, tenantUsers, tenants } from '@beaconhs/db/schema'
import { getCurrentUserId } from '@/lib/auth'
import { setActiveTenant } from '@/lib/actions'
import { PageContainer } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { parseListParams, pickString } from '@/lib/list-params'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_081f25902e5502') }
}
export const dynamic = 'force-dynamic'

const BASE = '/platform/tenants'
const SORTS = ['name', 'slug', 'status', 'region', 'members', 'people', 'incidents'] as const

async function viewAs(formData: FormData) {
  'use server'
  const tenantId = String(formData.get('tenantId') ?? '')
  await setActiveTenant(tenantId)
  redirect('/dashboard')
}

export default async function AdminTenantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const userId = await getCurrentUserId()
  if (!userId) redirect('/login')
  const sp = await searchParams
  const statusParam = pickString(sp.status)
  const statusFilter =
    statusParam === 'active' || statusParam === 'suspended' || statusParam === 'archived'
      ? statusParam
      : undefined
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })

  const { rows, total, statusCounts } = await withSuperAdmin(db, async (tx) => {
    const search: SQL<unknown> | undefined = params.q
      ? or(
          ilike(tenants.name, `%${params.q}%`),
          ilike(tenants.slug, `%${params.q}%`),
          ilike(tenants.region, `%${params.q}%`),
        )
      : undefined
    const where = and(search, statusFilter ? eq(tenants.status, statusFilter) : undefined)
    const memberCount = sql<number>`(select count(*) from ${tenantUsers} where ${tenantUsers.tenantId} = ${tenants.id})`
    const peopleCount = sql<number>`(select count(*) from ${people} where ${people.tenantId} = ${tenants.id})`
    const incidentCount = sql<number>`(select count(*) from ${incidents} where ${incidents.tenantId} = ${tenants.id})`
    const dirFn = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'slug'
        ? [dirFn(tenants.slug)]
        : params.sort === 'status'
          ? [dirFn(tenants.status), asc(tenants.name)]
          : params.sort === 'region'
            ? [dirFn(tenants.region), asc(tenants.name)]
            : params.sort === 'members'
              ? [dirFn(memberCount), asc(tenants.name)]
              : params.sort === 'people'
                ? [dirFn(peopleCount), asc(tenants.name)]
                : params.sort === 'incidents'
                  ? [dirFn(incidentCount), asc(tenants.name)]
                  : [dirFn(tenants.name)]
    const [totalRow, counts, result] = await Promise.all([
      tx.select({ c: count() }).from(tenants).where(where),
      tx
        .select({ status: tenants.status, c: count() })
        .from(tenants)
        .where(search)
        .groupBy(tenants.status),
      tx
        .select({ tenant: tenants, memberCount, peopleCount, incidentCount })
        .from(tenants)
        .where(where)
        .orderBy(...orderBy)
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage),
    ])
    return {
      rows: result,
      total: Number(totalRow[0]?.c ?? 0),
      statusCounts: Object.fromEntries(counts.map((row) => [row.status, Number(row.c)])),
    }
  })

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/platform', label: 'Back to platform' }}
          title={tGenerated('m_081f25902e5502')}
          subtitle={tGenerated('m_05fdc03a84e6dd')}
          actions={
            <div className="flex items-center gap-2">
              <Link href="/platform/tenants/seed-templates">
                <Button variant="outline">
                  <GeneratedText id="m_1571c4300b11d6" />
                </Button>
              </Link>
              <Link href="/platform/tenants/new">
                <Button>
                  <GeneratedText id="m_0329d412717ff5" />
                </Button>
              </Link>
            </div>
          }
        />

        <TableToolbar>
          <SearchInput placeholder={tGenerated('m_08a94e8cabaf07')} />
          <FilterChips
            basePath={BASE}
            currentParams={sp}
            paramKey="status"
            label={tGenerated('m_0b9da892d6faf0')}
            options={[
              { value: 'active', label: 'Active', count: statusCounts.active ?? 0 },
              { value: 'suspended', label: 'Suspended', count: statusCounts.suspended ?? 0 },
              { value: 'archived', label: 'Archived', count: statusCounts.archived ?? 0 },
            ]}
          />
        </TableToolbar>

        <GeneratedValue
          value={
            rows.length === 0 ? (
              <EmptyState
                title={tGeneratedValue(
                  !params.q && !statusFilter
                    ? tGenerated('m_06b223bea455fa')
                    : tGenerated('m_12656153c52a54'),
                )}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <GeneratedValue
                      value={[
                        ['name', 'Name'],
                        ['slug', 'Slug'],
                        ['status', 'Status'],
                        ['region', 'Region'],
                        ['members', 'Members'],
                        ['people', 'People'],
                        ['incidents', 'Incidents'],
                      ].map(([column, label]) => (
                        <SortableTh
                          key={column}
                          basePath={BASE}
                          currentParams={sp}
                          dir={params.dir}
                          column={column!}
                          active={params.sort === column}
                        >
                          <GeneratedValue value={label} />
                        </SortableTh>
                      ))}
                    />
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map(({ tenant, memberCount, peopleCount, incidentCount }) => (
                      <TableRow key={tenant.id}>
                        <TableCell className="font-medium">
                          <GeneratedValue value={tenant.name} />
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <GeneratedValue value={tenant.slug} />
                        </TableCell>
                        <TableCell>
                          <Badge variant={tenant.status === 'active' ? 'success' : 'secondary'}>
                            <GeneratedValue value={tenant.status} />
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <GeneratedValue value={tenant.region} />
                        </TableCell>
                        <TableCell>
                          <GeneratedValue value={Number(memberCount)} />
                        </TableCell>
                        <TableCell>
                          <GeneratedValue value={Number(peopleCount)} />
                        </TableCell>
                        <TableCell>
                          <GeneratedValue value={Number(incidentCount)} />
                        </TableCell>
                        <TableCell>
                          <GeneratedValue
                            value={
                              tenant.status === 'active' ? (
                                <form action={viewAs}>
                                  <input type="hidden" name="tenantId" value={tenant.id} />
                                  <Button type="submit" size="sm" variant="outline">
                                    <GeneratedText id="m_1583ec793bd336" />
                                  </Button>
                                </form>
                              ) : (
                                <span className="text-xs text-slate-400">
                                  <GeneratedText id="m_134f2adcabdf96" />
                                </span>
                              )
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  />
                </TableBody>
              </Table>
            )
          }
        />
        <Pagination
          basePath={BASE}
          currentParams={sp}
          total={total}
          page={params.page}
          perPage={params.perPage}
        />
      </div>
    </PageContainer>
  )
}
