import { notFound } from 'next/navigation'
import {
  Badge,
  DetailHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { SummaryStrip } from '../../_shared'
import { kindLabel } from '../_meta'
import { obligationCompliance } from '../_data'
import { ObligationDetailActions } from './_detail-actions'

export const metadata = { title: 'Obligation' }
export const dynamic = 'force-dynamic'

function StatusBadge({ status }: { status: string }) {
  if (status === 'completed') return <Badge variant="success">Completed</Badge>
  if (status === 'overdue') return <Badge variant="destructive">Overdue</Badge>
  if (status === 'expiring') return <Badge variant="destructive">Expiring</Badge>
  if (status === 'in_progress') return <Badge variant="warning">In progress</Badge>
  return <Badge variant="secondary">Pending</Badge>
}

function cadence(rec: {
  kind: string
  frequency?: string
  quantity?: number
  cron?: string
  dueOn?: string
}): string {
  if (rec.kind === 'frequency') return `${rec.quantity ?? 1}/${rec.frequency ?? 'week'}`
  if (rec.kind === 'cron') return rec.cron ? `cron ${rec.cron}` : '—'
  if (rec.kind === 'one_time') return rec.dueOn ? `due ${rec.dueOn}` : 'one-off'
  if (rec.kind === 'expiry') return 'continuous'
  return rec.kind
}

export default async function ObligationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.read')
  const data = await obligationCompliance(ctx, id)
  if (!data) notFound()
  const { obligation: ob, audience, result } = data
  const hasCounts = result.rows.some((r) => r.expected != null)
  const subjectNoun =
    ob.subjectKind === 'per_record'
      ? 'Record'
      : ob.subjectKind === 'per_task'
        ? 'Sign-off'
        : 'Person'

  return (
    <PageContainer>
      <div className="space-y-6">
        <DetailHeader
          back={{ href: '/compliance/obligations', label: 'Back to obligations' }}
          title={ob.title}
          subtitle={`${kindLabel(ob.sourceModule)} · ${cadence(ob.recurrence)}${
            ob.subjectKind === 'per_person'
              ? ` · ${audience.length || 'everyone'} audience target(s)`
              : ''
          }`}
          actions={
            <ObligationDetailActions
              id={ob.id}
              enabled={ob.status === 'active'}
              canManage={can(ctx, 'compliance.manage')}
            />
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{kindLabel(ob.sourceModule)}</Badge>
          <Badge variant={ob.status === 'active' ? 'success' : 'secondary'}>
            {ob.status === 'active' ? 'Active' : ob.status === 'paused' ? 'Disabled' : ob.status}
          </Badge>
        </div>

        {ob.notes ? <p className="text-sm text-slate-600">{ob.notes}</p> : null}

        <SummaryStrip percent={result.percent} totals={result.totals} title="Compliance" />

        {result.rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500">
            No subjects resolved for this obligation.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>{subjectNoun}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Completed</TableHead>
                {hasCounts ? (
                  <>
                    <TableHead>Count</TableHead>
                    <TableHead>Expected</TableHead>
                  </>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((r, i) => (
                <TableRow key={r.key}>
                  <TableCell className="text-slate-500">{i + 1}</TableCell>
                  <TableCell className="text-slate-900">{r.label}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-slate-700">{r.dueOn ?? '—'}</TableCell>
                  <TableCell className="text-slate-700">{r.completedOn ?? '—'}</TableCell>
                  {hasCounts ? (
                    <>
                      <TableCell className="text-slate-700">{r.count ?? '—'}</TableCell>
                      <TableCell className="text-slate-700">{r.expected ?? '—'}</TableCell>
                    </>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </PageContainer>
  )
}
