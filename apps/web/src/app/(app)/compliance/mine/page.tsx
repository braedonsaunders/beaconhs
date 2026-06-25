import Link from 'next/link'
import { and, eq, isNull } from 'drizzle-orm'
import { ChevronRight } from 'lucide-react'
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
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { kindLabel, personCompliance } from '../_hub'
import { complianceActionLabel, resolveComplianceLink } from '../_resolve-link'
import { StatusBadge, SummaryStrip } from '../_shared'
import { ComplianceSubNav } from '../_sub-nav'

export const metadata = { title: 'Compliance · Mine' }
export const dynamic = 'force-dynamic'

// Self-scoped: any authenticated user sees what THEY owe (no compliance.read
// gate). Cross-module due/expiring lives on its own "Due & expiring" tab — Mine
// shows only the obligations assigned to this person, each linking straight to
// where it is completed or reviewed.
export default async function MyCompliancePage() {
  const ctx = await requireRequestContext()
  const canReadAll = can(ctx, 'compliance.read')

  const [person] = await ctx.db((tx) =>
    tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.userId, ctx.userId), isNull(people.deletedAt)))
      .limit(1),
  )

  const rows = person ? await personCompliance(ctx, person.id) : []

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
            description="Obligations assigned to you. Open a row to complete or review it."
          />
          <ComplianceSubNav active="mine" canReadAll={canReadAll} />
        </>
      }
    >
      <div className="space-y-6">
        {!person ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            Your account is not linked to a person record, so there is nothing to show.
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
            Nothing assigned to you — you’re all caught up.
          </div>
        ) : (
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
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  const link = resolveComplianceLink(r.kind, r.targetRef, { personId: person.id })
                  const done = r.status === 'completed'
                  return (
                    <TableRow key={`${r.obligationId}:${i}`}>
                      <TableCell>
                        <Badge variant="secondary">{kindLabel(r.kind)}</Badge>
                      </TableCell>
                      <TableCell className="text-slate-900 dark:text-slate-100">
                        {link ? (
                          <Link
                            href={link.href as never}
                            prefetch={link.prefetch}
                            className="font-medium hover:underline"
                          >
                            {r.title}
                          </Link>
                        ) : (
                          r.title
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-slate-700 dark:text-slate-300">
                        {r.dueOn ?? '—'}
                      </TableCell>
                      <TableCell className="text-slate-700 dark:text-slate-300">
                        {r.completedOn ?? '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {link ? (
                          <Link
                            href={link.href as never}
                            prefetch={link.prefetch}
                            className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline dark:text-teal-300"
                          >
                            {done ? 'Review' : complianceActionLabel(r.kind)}
                            <ChevronRight size={14} />
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </ListPageLayout>
  )
}
