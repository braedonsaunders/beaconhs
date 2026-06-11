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
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { obligationRollup, kindLabel } from './_hub'
import { PercentBar } from './_shared'
import { ComplianceSubNav } from './_sub-nav'

export const metadata = { title: 'Compliance' }
export const dynamic = 'force-dynamic'

export default async function ComplianceOverviewPage() {
  const ctx = await requireRequestContext()
  const rollup = await obligationRollup(ctx)

  const totalSubjects = rollup.reduce((s, r) => s + r.total, 0)
  const totalCompleted = rollup.reduce((s, r) => s + r.completed, 0)
  const totalOverdue = rollup.reduce((s, r) => s + r.overdue, 0)
  const overall = totalSubjects === 0 ? 0 : Math.round((totalCompleted / totalSubjects) * 100)

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Compliance"
            description="The unified home for every compliance obligation — across inspections, documents, training, apps, journals, certifications, equipment, PPE and job-title sign-offs."
            actions={
              <Link href="/compliance/obligations/new">
                <Button>New obligation</Button>
              </Link>
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
          />
          <Kpi label="Overall compliance" value={`${overall}%`} />
        </div>

        {rollup.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500">
            No obligations yet.{' '}
            <Link href="/compliance/obligations/new" className="text-teal-700 hover:underline">
              Create your first one
            </Link>
            .
          </div>
        ) : (
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
              {rollup.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge variant="secondary">{kindLabel(r.kind)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/compliance/obligations/${r.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {r.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-700 tabular-nums">
                    {r.completed.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-slate-700 tabular-nums">
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
                      <span className="min-w-[3rem] text-right text-xs text-slate-600 tabular-nums">
                        {r.percent}%
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </ListPageLayout>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: 'danger' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs tracking-wide text-slate-500 uppercase">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold ${tone === 'danger' ? 'text-red-700' : 'text-slate-900'}`}
      >
        {value}
      </div>
    </div>
  )
}
