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
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
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
  const moduleFilter = pickString(sp.module) as SignalModule | undefined
  const statusFilter = pickString(sp.status) as SignalStatus | undefined

  const all = await listDueSignals(ctx)
  const rows = all.filter(
    (s) =>
      (!moduleFilter || s.module === moduleFilter) && (!statusFilter || s.status === statusFilter),
  )

  const counts = {
    overdue: all.filter((s) => s.status === 'overdue').length,
    expired: all.filter((s) => s.status === 'expired').length,
    due_soon: all.filter((s) => s.status === 'due_soon').length,
    open: all.filter((s) => s.status === 'open').length,
  }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Compliance"
            description="Everything coming due, expiring, or overdue across every module — certs, permits, equipment, PPE, lone-worker, document reviews, corrective actions and more."
          />
          <ComplianceSubNav active="expiring" />
          <div className="flex flex-col gap-2">
            <FilterChips
              basePath="/compliance/expiring"
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={STATUS_OPTIONS}
            />
            <FilterChips
              basePath="/compliance/expiring"
              currentParams={sp}
              paramKey="module"
              label="Module"
              options={MODULE_OPTIONS}
            />
          </div>
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

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500">
            Nothing due or expiring in the next 30 days — nice work.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Module</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s, i) => (
                <SignalRow key={`${s.module}:${s.family}:${i}`} signal={s} />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </ListPageLayout>
  )
}

function SignalRow({ signal: s }: { signal: ComplianceSignal }) {
  const subject = s.href ? (
    <Link href={s.href} className="text-slate-900 hover:underline">
      {s.subject}
    </Link>
  ) : (
    <span className="text-slate-900">{s.subject}</span>
  )
  return (
    <TableRow>
      <TableCell>
        <Badge variant="secondary">{SIGNAL_MODULE_LABELS[s.module]}</Badge>
      </TableCell>
      <TableCell className="text-xs text-slate-600">{s.family}</TableCell>
      <TableCell>{subject}</TableCell>
      <TableCell className="text-slate-700">{s.personName ?? '—'}</TableCell>
      <TableCell className="text-slate-700">{s.dueOn ?? '—'}</TableCell>
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
    tone === 'danger' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-900'
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  )
}
