import Link from 'next/link'
import {
  Badge,
  Button,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { Pagination } from '@/components/pagination'
import { obligationRollup, kindLabel } from './_hub'
import { PercentBar } from './_shared'
import { ComplianceSubNav } from './_sub-nav'

export const metadata = { title: 'Compliance' }
export const dynamic = 'force-dynamic'

const BASE = '/compliance'

export default async function ComplianceOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.read')
  const canAssign = can(ctx, 'compliance.assign')
  const params = parseListParams(sp, { sort: 'overdue', allowedSorts: ['overdue'] as const })
  const rollup = await obligationRollup(ctx)

  // KPIs are the org-wide scoreboard — always over every obligation, never the
  // searched/paged subset.
  const totalSubjects = rollup.reduce((s, r) => s + r.total, 0)
  const totalCompleted = rollup.reduce((s, r) => s + r.completed, 0)
  const totalOverdue = rollup.reduce((s, r) => s + r.overdue, 0)
  const overall = totalSubjects === 0 ? 0 : Math.round((totalCompleted / totalSubjects) * 100)

  const q = params.q?.toLowerCase()
  const filtered = q ? rollup.filter((r) => r.title.toLowerCase().includes(q)) : rollup
  const total = filtered.length
  const pageCount = Math.max(1, Math.ceil(total / params.perPage))
  const page = Math.min(params.page, pageCount)
  const rows = filtered.slice((page - 1) * params.perPage, page * params.perPage)

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Compliance"
            description="Every compliance obligation — inspections, documents, training, apps, journals, certifications, equipment, PPE, and job-title sign-offs — in one place."
            actions={
              canAssign ? (
                <Link href="/compliance/obligations/new">
                  <Button>New obligation</Button>
                </Link>
              ) : undefined
            }
          />
          <ComplianceSubNav active="overview" />
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi label="Obligations" value={rollup.length} />
          <Kpi label="Subjects tracked" value={totalSubjects.toLocaleString()} />
          <Kpi
            label="Overdue / expiring"
            value={totalOverdue.toLocaleString()}
            tone={totalOverdue > 0 ? 'danger' : undefined}
            href="/compliance/expiring"
          />
          <Kpi label="Overall compliance" value={`${overall}%`} />
        </div>

        <TableToolbar>
          <SearchInput placeholder="Search obligations by title…" />
        </TableToolbar>

        {rollup.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
            No obligations.
            {canAssign ? (
              <>
                {' '}
                <Link href="/compliance/obligations/new" className="text-teal-700 hover:underline">
                  Create one
                </Link>
                .
              </>
            ) : null}
          </div>
        ) : total === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
            No obligations match your search.
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>Obligation</TableHead>
                  <TableHead className="w-28">Completed</TableHead>
                  <TableHead className="w-28">Subjects</TableHead>
                  <TableHead className="w-28">Overdue</TableHead>
                  <TableHead>Compliance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge variant="secondary">{kindLabel(r.kind)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/compliance/obligations/${r.id}`}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {r.title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-700 tabular-nums dark:text-slate-300">
                      {r.completed.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-slate-700 tabular-nums dark:text-slate-300">
                      {r.total.toLocaleString()}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {r.overdue > 0 ? (
                        <Badge variant="destructive">{r.overdue}</Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="max-w-xs flex-1">
                          <PercentBar percent={r.percent} />
                        </div>
                        <span className="min-w-[3rem] text-right text-xs text-slate-600 tabular-nums dark:text-slate-400">
                          {r.percent}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              basePath={BASE}
              currentParams={sp}
              total={total}
              page={page}
              perPage={params.perPage}
            />
          </>
        )}
      </div>
    </ListPageLayout>
  )
}

function Kpi({
  label,
  value,
  tone,
  href,
}: {
  label: string
  value: string | number
  tone?: 'danger'
  href?: string
}) {
  const inner = (
    <>
      <div className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold ${tone === 'danger' ? 'text-red-700 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}
      >
        {value}
      </div>
    </>
  )
  const cls =
    'block rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900'
  if (href) {
    return (
      <Link
        href={href as any}
        className={`${cls} transition-colors hover:border-slate-300 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800/60`}
      >
        {inner}
      </Link>
    )
  }
  return <div className={cls}>{inner}</div>
}
