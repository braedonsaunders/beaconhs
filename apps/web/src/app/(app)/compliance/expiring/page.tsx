import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_00ff656ab7f5a3') }
}
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
  if (status === 'overdue')
    return (
      <Badge variant="destructive">
        <GeneratedText id="m_1e40bdcf2d1ba1" />
      </Badge>
    )
  if (status === 'expired')
    return (
      <Badge variant="destructive">
        <GeneratedText id="m_13f7150c94b182" />
      </Badge>
    )
  if (status === 'due_soon')
    return (
      <Badge variant="warning">
        <GeneratedText id="m_0971fcc40acc3d" />
      </Badge>
    )
  return (
    <Badge variant="secondary">
      <GeneratedText id="m_107ab58c3c38bc" />
    </Badge>
  )
}

export default async function ExpiringPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
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
            title={tGenerated('m_096d47f60747b3')}
            description={tGenerated('m_08b47a2a64f061')}
          />
          <ComplianceSubNav active="expiring" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_09a108f65ff92f')} />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              options={STATUS_OPTIONS}
            />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="module"
              label={tGenerated('m_065b964e065bf7')}
              options={MODULE_OPTIONS}
            />
          </TableToolbar>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-4">
          <SummaryCard
            label={tGenerated('m_1e40bdcf2d1ba1')}
            value={counts.overdue}
            tone="danger"
          />
          <SummaryCard
            label={tGenerated('m_13f7150c94b182')}
            value={counts.expired}
            tone="danger"
          />
          <SummaryCard label={tGenerated('m_0940472e630286')} value={counts.due_soon} tone="warn" />
          <SummaryCard label={tGenerated('m_082fbc548bd97d')} value={counts.open} tone="muted" />
        </div>

        <GeneratedValue
          value={
            total === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                <GeneratedValue
                  value={
                    allCount === 0 ? (
                      <GeneratedText id="m_0d4e1e302235be" />
                    ) : (
                      <GeneratedText id="m_03f142850f1679" />
                    )
                  }
                />
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
                        <GeneratedText id="m_065b964e065bf7" />
                      </SortableTh>
                      <TableHead>
                        <GeneratedText id="m_074ba2f160c506" />
                      </TableHead>
                      <SortableTh
                        basePath={BASE}
                        currentParams={sp}
                        dir={params.dir}
                        column="item"
                        active={params.sort === 'item'}
                      >
                        <GeneratedText id="m_02fb6dc94e4dca" />
                      </SortableTh>
                      <SortableTh
                        basePath={BASE}
                        currentParams={sp}
                        dir={params.dir}
                        column="person"
                        active={params.sort === 'person'}
                      >
                        <GeneratedText id="m_12e926c9216094" />
                      </SortableTh>
                      <SortableTh
                        basePath={BASE}
                        currentParams={sp}
                        dir={params.dir}
                        column="due"
                        active={params.sort === 'due'}
                      >
                        <GeneratedText id="m_0c2eb92551e08b" />
                      </SortableTh>
                      <SortableTh
                        basePath={BASE}
                        currentParams={sp}
                        dir={params.dir}
                        column="status"
                        active={params.sort === 'status'}
                      >
                        <GeneratedText id="m_0b9da892d6faf0" />
                      </SortableTh>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <GeneratedValue
                      value={rows.map((s, i) => (
                        <SignalRow key={`${s.module}:${s.family}:${i}`} signal={s} />
                      ))}
                    />
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
            )
          }
        />
      </div>
    </ListPageLayout>
  )
}

function SignalRow({ signal: s }: { signal: ComplianceSignal }) {
  const subject = s.href ? (
    <Link href={s.href as never} className="text-slate-900 hover:underline dark:text-slate-100">
      <GeneratedValue value={s.subject} />
    </Link>
  ) : (
    <span className="text-slate-900 dark:text-slate-100">
      <GeneratedValue value={s.subject} />
    </span>
  )
  return (
    <TableRow>
      <TableCell>
        <Badge variant="secondary">
          <GeneratedValue value={SIGNAL_MODULE_LABELS[s.module]} />
        </Badge>
      </TableCell>
      <TableCell className="text-xs text-slate-600 dark:text-slate-400">
        <GeneratedValue value={s.family} />
      </TableCell>
      <TableCell>
        <GeneratedValue value={subject} />
      </TableCell>
      <TableCell className="text-slate-700 dark:text-slate-300">
        <GeneratedValue value={s.personName ?? '—'} />
      </TableCell>
      <TableCell className="text-slate-700 dark:text-slate-300">
        <GeneratedValue value={s.dueOn ?? '—'} />
      </TableCell>
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
        <GeneratedValue value={label} />
      </div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>
        <GeneratedValue value={value} />
      </div>
    </div>
  )
}
