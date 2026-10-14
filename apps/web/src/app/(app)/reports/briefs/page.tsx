import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, asc, count, desc, eq, ilike, or, sql, type AnyColumn } from 'drizzle-orm'
import { Plus, Sparkles } from 'lucide-react'
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
import { briefs } from '@beaconhs/db/schema'
import { getBriefSource } from '@beaconhs/briefs'
import { ListPageLayout } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { FilterChips } from '@/components/filter-bar'
import { TableToolbar } from '@/components/table-toolbar'
import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { requireRequestContext } from '@/lib/auth'
import { formatDateTime } from '@/lib/datetime'
import { parseListParams, pickString } from '@/lib/list-params'
import { canManageBriefs, canReadBriefs } from '@/lib/briefs/access'
import { latestBriefRuns } from '@/lib/briefs/data'
import { ReportsSubNav } from '../_nav'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_13b7eb67d8d34a') }
}

const BASE = '/reports/briefs'
const SORTS = ['name', 'updated'] as const
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
]

export default async function BriefsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  if (!canReadBriefs(ctx)) redirect('/reports')
  const canManage = canManageBriefs(ctx)
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'updated',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusParam = pickString(sp.status) ?? 'active'
  const status = statusParam === 'archived' || statusParam === 'active' ? statusParam : null
  const term = `%${params.q}%`
  const where = and(
    status ? eq(briefs.status, status) : undefined,
    params.q ? or(ilike(briefs.name, term), ilike(briefs.description, term)) : undefined,
  )
  const sortColumn: Record<(typeof SORTS)[number], AnyColumn> = {
    name: briefs.name,
    updated: briefs.updatedAt,
  }
  const { rows, total } = await ctx.db(async (tx) => {
    const [tot] = await tx.select({ n: count() }).from(briefs).where(where)
    const rows = await tx
      .select({
        brief: briefs,
        // Qualified explicitly: a join-free select renders bare column names.
        schedules: sql<number>`(
          select count(*)::int from brief_schedules bs
          where bs.brief_id = "briefs"."id" and bs.tenant_id = "briefs"."tenant_id" and bs.active
        )`,
      })
      .from(briefs)
      .where(where)
      .orderBy(
        params.dir === 'asc' ? asc(sortColumn[params.sort]) : desc(sortColumn[params.sort]),
        asc(briefs.id),
      )
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    return { rows, total: Number(tot?.n ?? 0) }
  })
  const latest = await latestBriefRuns(
    ctx,
    rows.map((r) => r.brief.id),
  )
  const sortProps = { basePath: BASE, currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_13b7eb67d8d34a')}
            description={tGenerated('m_0c9676a113744f')}
            actions={
              canManage ? (
                <Link href="/reports/briefs/new">
                  <Button>
                    <Plus size={14} /> <GeneratedText id="m_0a24326f168c54" />
                  </Button>
                </Link>
              ) : undefined
            }
          />
          <ReportsSubNav active="briefs" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_0be1210f8b9705')} />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              defaultValue="active"
              options={STATUS_OPTIONS}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={32} />}
          title={params.q ? tGenerated('m_191b28e4c0da66') : tGenerated('m_138975b7c21cfb')}
          description={tGenerated('m_1e39105efabaa8')}
          action={
            canManage ? (
              <Link href="/reports/briefs/new">
                <Button>
                  <Plus size={14} /> <GeneratedText id="m_0a24326f168c54" />
                </Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                    <GeneratedText id="m_01ca3ac47ca58d" />
                  </SortableTh>
                  <TableHead>
                    <GeneratedText id="m_0c52b7d0d875d5" />
                  </TableHead>
                  <TableHead>
                    <GeneratedText id="m_0cc86809d4118c" />
                  </TableHead>
                  <TableHead>
                    <GeneratedText id="m_17a3bc1f0886e1" />
                  </TableHead>
                  <SortableTh {...sortProps} column="updated" active={params.sort === 'updated'}>
                    <GeneratedText id="m_014ca61c68ab13" />
                  </SortableTh>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ brief, schedules }) => {
                  const run = latest.get(brief.id)
                  return (
                    <TableRow key={brief.id}>
                      <TableCell>
                        <Link
                          href={`/reports/briefs/${brief.id}`}
                          className="font-medium text-teal-700 hover:underline dark:text-teal-400"
                        >
                          <GeneratedValue value={brief.name} />
                        </Link>
                        {brief.description ? (
                          <p className="line-clamp-1 text-xs text-slate-500">
                            <GeneratedValue value={brief.description} />
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600 dark:text-slate-300">
                        <GeneratedValue
                          value={brief.spec.sources
                            .map((s) => getBriefSource(s.key)?.label ?? s.key)
                            .join(', ')}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant={schedules > 0 ? 'success' : 'secondary'}>{schedules}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {run ? (
                          <Link
                            href={`/reports/briefs/${brief.id}/runs/${run.id}`}
                            className="text-teal-700 hover:underline dark:text-teal-400"
                          >
                            <GeneratedValue value={run.windowLabel} />
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap text-slate-500">
                        <GeneratedValue
                          value={formatDateTime(brief.updatedAt, ctx.timezone, ctx.locale)}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
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
