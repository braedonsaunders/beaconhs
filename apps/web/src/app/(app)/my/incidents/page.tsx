import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
// "My incidents" — incidents reported by the current user.
//
// Filter is hard-pinned to reportedByTenantUserId = ctx.membership.id. All
// other list-page primitives are reused as-is (SearchInput, FilterChips,
// SortableTh, Pagination) so the UX matches the global /incidents page.

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
import {
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
import { incidents, orgUnits } from '@beaconhs/db/schema'
import { SeverityBadge, StatusBadge } from '../../incidents/_badges'
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
  return { title: tGenerated('m_1c1da2222b5316') }
}
export const dynamic = 'force-dynamic'

const SORTS = ['reference', 'occurred_at', 'severity', 'status', 'type'] as const

const TYPE_OPTIONS = [
  { value: 'injury', label: 'Injury' },
  { value: 'illness', label: 'Illness' },
  { value: 'near_miss', label: 'Near-miss' },
  { value: 'property_damage', label: 'Property damage' },
  { value: 'environmental', label: 'Environmental' },
  { value: 'security', label: 'Security' },
]

const STATUS_OPTIONS = [
  { value: 'reported', label: 'Reported' },
  { value: 'under_investigation', label: 'Investigating' },
  { value: 'pending_review', label: 'Pending review' },
  { value: 'closed', label: 'Closed' },
  { value: 'reopened', label: 'Reopened' },
]

export default async function MyIncidentsPage({
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
  const typeParam = pickString(sp.type)
  const typeFilter = typeParam && TYPE_OPTIONS.some((o) => o.value === typeParam) ? typeParam : null
  const statusParam = pickString(sp.status)
  const statusFilter =
    statusParam && STATUS_OPTIONS.some((o) => o.value === statusParam) ? statusParam : null

  const ctx = await requireRequestContext()
  const membershipId = ctx.membership?.id ?? null

  // Without a membership (super-admin viewing-as) there's nothing to scope
  // to — render an empty state with a friendly explanation instead of
  // silently showing zero rows.
  if (!membershipId) {
    return (
      <ListPageLayout
        header={
          <PageHeader
            back={{ href: '/my', label: 'Workspace' }}
            title={tGenerated('m_1c1da2222b5316')}
            description={tGenerated('m_1ac33e2abbdd1f')}
            actions={
              <Link href="/incidents">
                <Button variant="outline">
                  <GeneratedText id="m_17e7d54f75218e" />
                </Button>
              </Link>
            }
          />
        }
      >
        <WorkspaceNoIdentity reason="no-membership" noun="reported incidents" />
      </ListPageLayout>
    )
  }

  const { rows, total, typeCounts, statusCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [
      eq(incidents.reportedByTenantUserId, membershipId),
      isNull(incidents.deletedAt),
    ]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(incidents.reference, term),
        ilike(incidents.title, term),
        ilike(incidents.description, term),
      )
      if (cond) filters.push(cond)
    }
    if (typeFilter)
      filters.push(eq(incidents.type, typeFilter as typeof incidents.$inferSelect.type))
    if (statusFilter)
      filters.push(eq(incidents.status, statusFilter as typeof incidents.$inferSelect.status))
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'reference'
        ? [params.dir === 'asc' ? asc(incidents.reference) : desc(incidents.reference)]
        : params.sort === 'severity'
          ? [params.dir === 'asc' ? asc(incidents.severity) : desc(incidents.severity)]
          : params.sort === 'status'
            ? [params.dir === 'asc' ? asc(incidents.status) : desc(incidents.status)]
            : params.sort === 'type'
              ? [params.dir === 'asc' ? asc(incidents.type) : desc(incidents.type)]
              : [params.dir === 'asc' ? asc(incidents.occurredAt) : desc(incidents.occurredAt)]

    const [tot] = await tx.select({ c: count() }).from(incidents).where(whereClause)
    const data = await tx
      .select({ incident: incidents, site: orgUnits })
      .from(incidents)
      .leftJoin(orgUnits, eq(orgUnits.id, incidents.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    // For the chip counts we keep the user-scope filter but drop the type /
    // status filters so the user can see how many of *their* incidents fall
    // into each bucket regardless of what's currently selected.
    const userScopeOnly = and(
      eq(incidents.reportedByTenantUserId, membershipId),
      isNull(incidents.deletedAt),
    )
    const types = await tx
      .select({ type: incidents.type, c: count() })
      .from(incidents)
      .where(userScopeOnly)
      .groupBy(incidents.type)
    const statuses = await tx
      .select({ status: incidents.status, c: count() })
      .from(incidents)
      .where(userScopeOnly)
      .groupBy(incidents.status)

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      typeCounts: Object.fromEntries(types.map((t) => [t.type, Number(t.c)])),
      statusCounts: Object.fromEntries(statuses.map((s) => [s.status, Number(s.c)])),
    }
  })

  const sortProps = { basePath: '/my/incidents', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            back={{ href: '/my', label: 'Workspace' }}
            title={tGenerated('m_1c1da2222b5316')}
            description={tGenerated('m_1ac33e2abbdd1f')}
            actions={
              <div className="flex items-center gap-2">
                <Link href="/incidents">
                  <Button variant="outline">
                    <GeneratedText id="m_17e7d54f75218e" />
                  </Button>
                </Link>
                <Link href="/incidents/new">
                  <Button>
                    <GeneratedText id="m_0f2b150c1cc651" />
                  </Button>
                </Link>
              </div>
            }
          />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_0334d18b63b0b5')} />
            <FilterChips
              basePath="/my/incidents"
              currentParams={sp}
              paramKey="type"
              label={tGenerated('m_074ba2f160c506')}
              options={TYPE_OPTIONS.map((o) => ({ ...o, count: typeCounts[o.value] }))}
            />
            <FilterChips
              basePath="/my/incidents"
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
              icon={<AlertTriangle size={32} />}
              title={tGeneratedValue(
                params.q || typeFilter || statusFilter
                  ? tGenerated('m_0f2f6d26003080')
                  : tGenerated('m_0d2f583d2bd480'),
              )}
              description={tGenerated('m_0c0af94fc675d9')}
              action={
                <Link href="/incidents/new">
                  <Button>
                    <GeneratedText id="m_0f672c0489dd6d" />
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
                    <SortableTh {...sortProps} column="type" active={params.sort === 'type'}>
                      <GeneratedText id="m_074ba2f160c506" />
                    </SortableTh>
                    <SortableTh
                      {...sortProps}
                      column="severity"
                      active={params.sort === 'severity'}
                    >
                      <GeneratedText id="m_168b365cc671bf" />
                    </SortableTh>
                    <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                      <GeneratedText id="m_0b9da892d6faf0" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_0decefd558c355" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_020146dd3d3d5a" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map(({ incident, site }) => (
                      <TableRow key={incident.id}>
                        <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400">
                          <Link href={`/incidents/${incident.id}`} className="hover:underline">
                            <GeneratedValue value={incident.reference} />
                          </Link>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          <GeneratedValue
                            value={formatDate(
                              new Date(incident.occurredAt),
                              ctx.timezone,
                              ctx.locale,
                            )}
                          />
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          <GeneratedValue value={incident.type.replace('_', ' ')} />
                        </TableCell>
                        <TableCell>
                          <SeverityBadge severity={incident.severity} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={incident.status} />
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/incidents/${incident.id}`}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            <GeneratedValue value={incident.title} />
                          </Link>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          <GeneratedValue value={site?.name ?? '—'} />
                        </TableCell>
                      </TableRow>
                    ))}
                  />
                </TableBody>
              </Table>
              <Pagination
                basePath="/my/incidents"
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
