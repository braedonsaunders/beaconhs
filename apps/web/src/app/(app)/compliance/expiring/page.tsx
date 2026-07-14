import Link from 'next/link'
import {
  Badge,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { TableToolbar } from '@/components/table-toolbar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { ComplianceSubNav } from '../_sub-nav'
import {
  SIGNAL_MODULE_LABELS,
  type ComplianceSignal,
  type SignalModule,
  type SignalStatus,
  listDueSignals,
} from '../_signals'

export const metadata = { title: 'Compliance · Due & expiring' }
export const dynamic = 'force-dynamic'

const BASE = '/compliance/expiring'
const SORTS = ['module', 'item', 'person', 'due', 'status'] as const

const STATUS_OPTIONS = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'expired', label: 'Expired' },
  { value: 'due_soon', label: 'Due soon' },
  { value: 'open', label: 'Open' },
]
const MODULE_OPTIONS = (Object.keys(SIGNAL_MODULE_LABELS) as SignalModule[]).map((m) => ({
  value: m,
  label: SIGNAL_MODULE_LABELS[m],
}))

function SignalStatusBadge({ status }: { status: SignalStatus }) {
  if (status === 'overdue') return <Badge variant="destructive">Overdue</Badge>
  if (status === 'expired') return <Badge variant="destructive">Expired</Badge>
  if (status === 'due_soon') return <Badge variant="warning">Due soon</Badge>
  return <Badge variant="secondary">Open</Badge>
}

export default async function ExpiringPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.read')
  const moduleParam = pickString(sp.module)
  const moduleFilter = MODULE_OPTIONS.find((option) => option.value === moduleParam)?.value
  const statusParam = pickString(sp.status)
  const statusFilter = STATUS_OPTIONS.find((option) => option.value === statusParam)?.value as
    SignalStatus | undefined
  const params = parseListParams(sp, {
    sort: 'status',
    dir: 'asc',
    allowedSorts: SORTS,
    perPage: 50,
  })

  const request = {
    q: params.q,
    module: moduleFilter,
    status: statusFilter,
    sort: params.sort,
    dir: params.dir,
    page: params.page,
    perPage: params.perPage,
  }
  let result = await listDueSignals(ctx, request)
  // A stale shared URL can point beyond the last page after filters change.
  // Re-read the actual last page rather than rendering an empty phantom page.
  const requestedPageCount = Math.max(1, Math.ceil(result.total / params.perPage))
  if (result.rows.length === 0 && result.total > 0 && params.page > requestedPageCount) {
    result = await listDueSignals(ctx, { ...request, page: requestedPageCount })
  }
  const counts = result.counts
  const total = result.total
  const pageCount = Math.max(1, Math.ceil(total / params.perPage))
  const page = Math.min(params.page, pageCount)
  const rows = result.rows
  const allCount = counts.overdue + counts.expired + counts.due_soon + counts.open

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Compliance"
            description="Everything coming due, expiring, or overdue across every module — certifications, permits, equipment, PPE, monitored sessions, document reviews, and corrective actions."
          />
          <ComplianceSubNav active="expiring" />
          <TableToolbar>
            <SearchInput placeholder="Search item, person, module, or status…" />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={STATUS_OPTIONS}
            />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="module"
              label="Module"
              options={MODULE_OPTIONS}
            />
          </TableToolbar>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-4">
          <SummaryCard label="Overdue" value={counts.overdue} tone="danger" />
          <SummaryCard label="Expired" value={counts.expired} tone="danger" />
          <SummaryCard label="Due soon (30d)" value={counts.due_soon} tone="warn" />
          <SummaryCard label="Open tasks" value={counts.open} tone="muted" />
        </div>

        {total === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
            {allCount === 0
              ? 'Nothing due or expiring in the next 30 days — nice work.'
              : 'No items match these filters.'}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTh
                    basePath={BASE}
                    currentParams={sp}
                    dir={params.dir}
                    column="module"
                    active={params.sort === 'module'}
                  >
                    Module
                  </SortableTh>
                  <TableHead>Type</TableHead>
                  <SortableTh
                    basePath={BASE}
                    currentParams={sp}
                    dir={params.dir}
                    column="item"
                    active={params.sort === 'item'}
                  >
                    Item
                  </SortableTh>
                  <SortableTh
                    basePath={BASE}
                    currentParams={sp}
                    dir={params.dir}
                    column="person"
                    active={params.sort === 'person'}
                  >
                    Person
                  </SortableTh>
                  <SortableTh
                    basePath={BASE}
                    currentParams={sp}
                    dir={params.dir}
                    column="due"
                    active={params.sort === 'due'}
                  >
                    Due
                  </SortableTh>
                  <SortableTh
                    basePath={BASE}
                    currentParams={sp}
                    dir={params.dir}
                    column="status"
                    active={params.sort === 'status'}
                  >
                    Status
                  </SortableTh>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s, i) => (
                  <SignalRow key={`${s.module}:${s.family}:${i}`} signal={s} />
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

function SignalRow({ signal: s }: { signal: ComplianceSignal }) {
  const subject = s.href ? (
    <Link href={s.href as never} className="text-slate-900 hover:underline dark:text-slate-100">
      {s.subject}
    </Link>
  ) : (
    <span className="text-slate-900 dark:text-slate-100">{s.subject}</span>
  )
  return (
    <TableRow>
      <TableCell>
        <Badge variant="secondary">{SIGNAL_MODULE_LABELS[s.module]}</Badge>
      </TableCell>
      <TableCell className="text-xs text-slate-600 dark:text-slate-400">{s.family}</TableCell>
      <TableCell>{subject}</TableCell>
      <TableCell className="text-slate-700 dark:text-slate-300">{s.personName ?? '—'}</TableCell>
      <TableCell className="text-slate-700 dark:text-slate-300">{s.dueOn ?? '—'}</TableCell>
      <TableCell>
        <SignalStatusBadge status={s.status} />
      </TableCell>
    </TableRow>
  )
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'danger' | 'warn' | 'muted'
}) {
  const color =
    tone === 'danger'
      ? 'text-red-700 dark:text-red-400'
      : tone === 'warn'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-slate-900 dark:text-slate-100'
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  )
}
