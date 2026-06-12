import { and, eq, isNull } from 'drizzle-orm'
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
import { people } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { kindLabel, personCompliance } from '../_hub'
import { SIGNAL_MODULE_LABELS, listDueSignals } from '../_signals'
import { StatusBadge, SummaryStrip } from '../_shared'
import { ComplianceSubNav } from '../_sub-nav'

export const metadata = { title: 'Compliance · Mine' }
export const dynamic = 'force-dynamic'

// Self-scoped: any authenticated user sees what THEY owe (no compliance.read gate).
export default async function MyCompliancePage() {
  const ctx = await requireRequestContext()

  const [person] = await ctx.db((tx) =>
    tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.userId, ctx.userId), isNull(people.deletedAt)))
      .limit(1),
  )

  const rows = person ? await personCompliance(ctx, person.id) : []
  const signals = person ? await listDueSignals(ctx, { personId: person.id }) : []

  const isOverdue = (s: string) => s === 'overdue' || s === 'expiring'
  const totals = {
    total: rows.length,
    completed: rows.filter((r) => r.status === 'completed').length,
    overdue: rows.filter((r) => isOverdue(r.status)).length,
    pending: rows.filter((r) => r.status === 'pending' || r.status === 'in_progress').length,
  }
  const percent = totals.total === 0 ? 0 : Math.round((totals.completed / totals.total) * 100)

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="My compliance"
            description="Obligations assigned to you, plus due and expiring items."
          />
          <ComplianceSubNav active="mine" />
        </>
      }
    >
      <div className="space-y-6">
        {!person ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-700">
            Your account is not linked to a person record, so there is nothing to show.
          </div>
        ) : rows.length === 0 && signals.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500">
            Nothing assigned, due, or expiring.
          </div>
        ) : (
          <>
            {rows.length > 0 ? (
              <div className="space-y-3">
                <SummaryStrip percent={percent} totals={totals} title="My obligations" />
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kind</TableHead>
                      <TableHead>Obligation</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Completed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => (
                      <TableRow key={`${r.obligationId}:${i}`}>
                        <TableCell>
                          <Badge variant="secondary">{kindLabel(r.kind)}</Badge>
                        </TableCell>
                        <TableCell className="text-slate-900">{r.title}</TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="text-slate-700">{r.dueOn ?? '—'}</TableCell>
                        <TableCell className="text-slate-700">{r.completedOn ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}

            {signals.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-900">Due &amp; expiring</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Module</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {signals.map((sig, i) => (
                      <TableRow key={`${sig.module}:${i}`}>
                        <TableCell>
                          <Badge variant="secondary">{SIGNAL_MODULE_LABELS[sig.module]}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">{sig.family}</TableCell>
                        <TableCell className="text-slate-900">{sig.subject}</TableCell>
                        <TableCell className="text-slate-700">{sig.dueOn ?? '—'}</TableCell>
                        <TableCell>
                          {sig.status === 'overdue' || sig.status === 'expired' ? (
                            <Badge variant="destructive">
                              {sig.status === 'expired' ? 'Expired' : 'Overdue'}
                            </Badge>
                          ) : sig.status === 'due_soon' ? (
                            <Badge variant="warning">Due soon</Badge>
                          ) : (
                            <Badge variant="secondary">Open</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            ) : null}
          </>
        )}
      </div>
    </ListPageLayout>
  )
}
