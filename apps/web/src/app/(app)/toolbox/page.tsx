import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
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
} from '@beaconhs/ui'
import {
  orgUnits,
  tenantUsers,
  toolboxJournalAttendees,
  toolboxJournals,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { ToolboxSubNav } from '@/components/toolbox-sub-nav'
import { ToolboxStatusBadge } from './_status-badge'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Toolbox talks' }

const SORTS = ['reference', 'occurred_on', 'title', 'status'] as const

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'closed', label: 'Closed' },
]

export default async function ToolboxIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'occurred_on',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const fromFilter = pickString(sp.from)
  const toFilter = pickString(sp.to)
  const foremanFilter = pickString(sp.foreman)
  const siteFilter = pickString(sp.site)
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts, foremen, sites, attendeeCounts } = await ctx.db(
    async (tx) => {
      const filters: SQL<unknown>[] = []
      if (params.q) {
        const term = `%${params.q}%`
        const cond = or(
          ilike(toolboxJournals.reference, term),
          ilike(toolboxJournals.title, term),
          ilike(toolboxJournals.topic, term),
          ilike(toolboxJournals.discussionNotes, term),
        )
        if (cond) filters.push(cond)
      }
      if (statusFilter) filters.push(eq(toolboxJournals.status, statusFilter as any))
      if (fromFilter) filters.push(gte(toolboxJournals.occurredOn, fromFilter))
      if (toFilter) filters.push(lte(toolboxJournals.occurredOn, toFilter))
      if (foremanFilter) filters.push(eq(toolboxJournals.foremanTenantUserId, foremanFilter))
      if (siteFilter) filters.push(eq(toolboxJournals.siteOrgUnitId, siteFilter))
      const whereClause = filters.length > 0 ? and(...filters) : undefined

      const orderBy =
        params.sort === 'reference'
          ? [
              params.dir === 'asc'
                ? asc(toolboxJournals.reference)
                : desc(toolboxJournals.reference),
            ]
          : params.sort === 'title'
            ? [
                params.dir === 'asc'
                  ? asc(toolboxJournals.title)
                  : desc(toolboxJournals.title),
              ]
            : params.sort === 'status'
              ? [
                  params.dir === 'asc'
                    ? asc(toolboxJournals.status)
                    : desc(toolboxJournals.status),
                ]
              : [
                  params.dir === 'asc'
                    ? asc(toolboxJournals.occurredOn)
                    : desc(toolboxJournals.occurredOn),
                ]

      const [tot] = await tx
        .select({ c: count() })
        .from(toolboxJournals)
        .where(whereClause)
      const data = await tx
        .select({
          j: toolboxJournals,
          site: orgUnits,
          foremanMembership: tenantUsers,
          foremanUser: user,
        })
        .from(toolboxJournals)
        .leftJoin(orgUnits, eq(orgUnits.id, toolboxJournals.siteOrgUnitId))
        .leftJoin(tenantUsers, eq(tenantUsers.id, toolboxJournals.foremanTenantUserId))
        .leftJoin(user, eq(user.id, tenantUsers.userId))
        .where(whereClause)
        .orderBy(...orderBy)
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage)

      const ss = await tx
        .select({ s: toolboxJournals.status, c: count() })
        .from(toolboxJournals)
        .groupBy(toolboxJournals.status)

      const formn = await tx
        .selectDistinct({
          id: tenantUsers.id,
          name: user.name,
          displayName: tenantUsers.displayName,
        })
        .from(toolboxJournals)
        .innerJoin(tenantUsers, eq(tenantUsers.id, toolboxJournals.foremanTenantUserId))
        .leftJoin(user, eq(user.id, tenantUsers.userId))
        .orderBy(asc(user.name))
        .limit(200)

      const siteRows = await tx
        .select({ id: orgUnits.id, name: orgUnits.name })
        .from(orgUnits)
        .where(eq(orgUnits.level, 'site'))
        .orderBy(asc(orgUnits.name))

      // Attendee counts in this page
      const journalIds = data.map((d) => d.j.id)
      let counts: Record<string, number> = {}
      if (journalIds.length > 0) {
        const rows = await tx
          .select({
            journalId: toolboxJournalAttendees.journalId,
            c: count(),
          })
          .from(toolboxJournalAttendees)
          .where(sql`${toolboxJournalAttendees.journalId} = ANY(${journalIds})`)
          .groupBy(toolboxJournalAttendees.journalId)
        counts = Object.fromEntries(rows.map((r) => [r.journalId, Number(r.c)]))
      }

      return {
        rows: data,
        total: Number(tot?.c ?? 0),
        statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
        foremen: formn,
        sites: siteRows,
        attendeeCounts: counts,
      }
    },
  )

  const sortProps = { basePath: '/toolbox', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Toolbox talks"
            description="Daily and weekly toolbox talks with attendee sign-in, action items, and recurring assignments."
            actions={
              <div className="flex items-center gap-2">
                <Link href={buildExportHref('/toolbox/export.csv', sp)}>
                  <Button variant="outline">Export CSV</Button>
                </Link>
                <Link href="/toolbox/new">
                  <Button>New toolbox talk</Button>
                </Link>
              </div>
            }
          />
          <ToolboxSubNav active="records" />
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search reference, title, topic, notes…" />
          </div>
          <div className="space-y-2">
            <FilterChips
              basePath="/toolbox"
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
            <form className="flex flex-wrap items-end gap-3" action="/toolbox" method="get">
              {/* Preserve other params */}
              {params.q ? <input type="hidden" name="q" value={params.q} /> : null}
              {statusFilter ? <input type="hidden" name="status" value={statusFilter} /> : null}
              {params.sort !== 'occurred_on' ? (
                <input type="hidden" name="sort" value={params.sort} />
              ) : null}
              {params.dir !== 'desc' ? <input type="hidden" name="dir" value={params.dir} /> : null}
              <div className="space-y-1">
                <Label className="text-[11px] uppercase tracking-wide text-slate-500">From</Label>
                <Input
                  name="from"
                  type="date"
                  defaultValue={fromFilter ?? ''}
                  className="h-8 w-[150px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] uppercase tracking-wide text-slate-500">To</Label>
                <Input
                  name="to"
                  type="date"
                  defaultValue={toFilter ?? ''}
                  className="h-8 w-[150px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                  Foreman
                </Label>
                <Select name="foreman" defaultValue={foremanFilter ?? ''} className="h-8">
                  <option value="">All</option>
                  {foremen.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.displayName ?? f.name ?? f.id.slice(0, 8)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] uppercase tracking-wide text-slate-500">Site</Label>
                <Select name="site" defaultValue={siteFilter ?? ''} className="h-8">
                  <option value="">All</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" variant="outline" size="sm">
                Apply
              </Button>
              {(fromFilter || toFilter || foremanFilter || siteFilter) ? (
                <Link
                  href={mergeHref('/toolbox', sp, {
                    from: undefined,
                    to: undefined,
                    foreman: undefined,
                    site: undefined,
                    page: 1,
                  }) as any}
                  className="text-xs text-slate-500 hover:text-teal-700"
                >
                  Clear filters
                </Link>
              ) : null}
            </form>
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={32} />}
          title={
            params.q || statusFilter || fromFilter || toFilter || foremanFilter || siteFilter
              ? 'No toolbox talks match these filters'
              : 'No toolbox talks logged yet'
          }
          description="Log a toolbox talk to capture the topic, attendees, and any action items raised."
          action={
            <Link href="/toolbox/new">
              <Button>Log your first toolbox talk</Button>
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
                  Ref
                </SortableTh>
                <SortableTh
                  {...sortProps}
                  column="occurred_on"
                  active={params.sort === 'occurred_on'}
                >
                  Date
                </SortableTh>
                <SortableTh {...sortProps} column="title" active={params.sort === 'title'}>
                  Topic
                </SortableTh>
                <TableHead>Foreman</TableHead>
                <TableHead>Site</TableHead>
                <TableHead className="text-right">Attendees</TableHead>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                  Status
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ j, site, foremanMembership, foremanUser }) => (
                <TableRow key={j.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/toolbox/${j.id}`} className="hover:underline">
                      {j.reference}
                    </Link>
                  </TableCell>
                  <TableCell>{j.occurredOn}</TableCell>
                  <TableCell>
                    <Link
                      href={`/toolbox/${j.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {j.title}
                    </Link>
                    {j.topic ? (
                      <div className="text-xs text-slate-500">{j.topic}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-slate-700">
                    {foremanUser?.name ?? foremanMembership?.displayName ?? '—'}
                  </TableCell>
                  <TableCell className="text-slate-700">{site?.name ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">{attendeeCounts[j.id] ?? 0}</Badge>
                  </TableCell>
                  <TableCell>
                    <ToolboxStatusBadge status={j.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/toolbox"
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
