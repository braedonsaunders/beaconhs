import { asc, eq } from 'drizzle-orm'
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
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { kindLabel, personCompliance } from '../_hub'
import { StatusBadge, SummaryStrip } from '../_shared'
import { ComplianceSubNav } from '../_sub-nav'
import { PersonPicker } from './_person-picker'

export const metadata = { title: 'Compliance · By person' }
export const dynamic = 'force-dynamic'

export default async function ByPersonPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.read')
  const personId = pickString(sp.person)

  const peopleOptions = await ctx.db((tx) =>
    tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        jobTitle: people.jobTitle,
      })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
      .limit(2000),
  )
  const personOptions = peopleOptions.map((p) => ({
    value: p.id,
    label: `${p.lastName ?? ''}${p.lastName ? ', ' : ''}${p.firstName ?? ''}`.trim() || '(unnamed)',
    hint: p.jobTitle ?? undefined,
  }))

  const rows = personId ? await personCompliance(ctx, personId) : []
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
            title="Compliance"
            description="Every obligation one person is responsible for, across every kind."
          />
          <ComplianceSubNav active="by-person" />
        </>
      }
    >
      <div className="space-y-6">
        <PersonPicker people={personOptions} selected={personId ?? ''} />

        {!personId ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500">
            Pick a person above to see every obligation they are scoped into.
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-700">
            This person isn&apos;t a subject of any active obligation.
          </div>
        ) : (
          <div className="space-y-4">
            <SummaryStrip percent={percent} totals={totals} title="Across all kinds" />
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
        )}
      </div>
    </ListPageLayout>
  )
}
