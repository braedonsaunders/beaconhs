import Link from 'next/link'
import { Hourglass } from 'lucide-react'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { Badge, EmptyState, PageHeader } from '@beaconhs/ui'
import { correctiveActions, orgUnits, tenantUsers, user } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { CorrectiveActionsSubNav } from '@/components/corrective-actions-sub-nav'

export const metadata = { title: 'Corrective action aging' }
export const dynamic = 'force-dynamic'

type Bucket = '<7d' | '7-30d' | '30-60d' | '60+d'

const BUCKETS: { key: Bucket; label: string; tone: string; help: string }[] = [
  {
    key: '<7d',
    label: '< 7 days',
    tone: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-900 dark:text-emerald-200',
    help: 'Fresh',
  },
  {
    key: '7-30d',
    label: '7–30 days',
    tone: 'bg-amber-100 dark:bg-amber-500/15 text-amber-900 dark:text-amber-200',
    help: 'Warming up',
  },
  {
    key: '30-60d',
    label: '30–60 days',
    tone: 'bg-orange-100 dark:bg-orange-500/15 text-orange-900 dark:text-orange-200',
    help: 'Getting stale',
  },
  {
    key: '60+d',
    label: '60+ days',
    tone: 'bg-red-100 dark:bg-red-500/15 text-red-900 dark:text-red-200',
    help: 'Hot potato',
  },
]

type Row = {
  id: string
  reference: string
  title: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: 'open' | 'in_progress' | 'pending_verification' | 'closed' | 'cancelled'
  ageDays: number
  bucket: Bucket
  ownerName: string | null
  siteName: string | null
  dueOn: string | null
  assignedOn: string | null
}

function bucketForAge(days: number): Bucket {
  if (days < 7) return '<7d'
  if (days < 30) return '7-30d'
  if (days < 60) return '30-60d'
  return '60+d'
}

/**
 * Aging report — open CAs bucketed by how long they've been on the books
 * (today − assignedOn, falling back to today − createdAt). Header tiles
 * show the counts per bucket; the table is grouped per bucket so the
 * "60+ days" stuff is front-and-centre.
 */
export default async function AgingReport() {
  const ctx = await requireRequestContext()
  const today = new Date().toISOString().slice(0, 10)

  const rows = await ctx.db((tx) =>
    tx
      .select({
        ca: correctiveActions,
        owner: tenantUsers,
        ownerAccount: user,
        site: orgUnits,
      })
      .from(correctiveActions)
      .leftJoin(tenantUsers, eq(tenantUsers.id, correctiveActions.ownerTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .leftJoin(orgUnits, eq(orgUnits.id, correctiveActions.siteOrgUnitId))
      .where(inArray(correctiveActions.status, ['open', 'in_progress', 'pending_verification']))
      .orderBy(asc(correctiveActions.assignedOn)),
  )

  const enriched: Row[] = rows.map((r) => {
    const baseline = r.ca.assignedOn
      ? Date.parse(r.ca.assignedOn)
      : r.ca.createdAt
        ? new Date(r.ca.createdAt).getTime()
        : Date.now()
    const ageDays = Math.max(0, Math.round((Date.parse(today) - baseline) / 86_400_000))
    return {
      id: r.ca.id,
      reference: r.ca.reference,
      title: r.ca.title,
      severity: r.ca.severity,
      status: r.ca.status,
      ageDays,
      bucket: bucketForAge(ageDays),
      ownerName: r.ownerAccount?.name ?? r.owner?.displayName ?? null,
      siteName: r.site?.name ?? null,
      dueOn: r.ca.dueOn,
      assignedOn: r.ca.assignedOn,
    }
  })

  const counts: Record<Bucket, number> = { '<7d': 0, '7-30d': 0, '30-60d': 0, '60+d': 0 }
  for (const r of enriched) counts[r.bucket]++
  const grouped: Record<Bucket, Row[]> = {
    '<7d': [],
    '7-30d': [],
    '30-60d': [],
    '60+d': [],
  }
  for (const r of enriched) grouped[r.bucket].push(r)
  // Within each bucket sort oldest-first so the worst rows are at the top.
  for (const k of Object.keys(grouped) as Bucket[]) {
    grouped[k].sort((a, b) => b.ageDays - a.ageDays)
  }

  return (
    <ListPageLayout
      header={
        <>
          <CorrectiveActionsSubNav active="aging" />
          <PageHeader
            title="Corrective action aging"
            description="Open work bucketed by age — find what's been sitting around too long."
            back={{ href: '/corrective-actions', label: 'Back to records' }}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {BUCKETS.map((b) => (
              <div
                key={b.key}
                className="rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                    {b.label}
                  </span>
                  <Badge className={b.tone} variant="default">
                    {counts[b.key]}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{b.help}</div>
              </div>
            ))}
          </div>
        </>
      }
    >
      {enriched.length === 0 ? (
        <EmptyState
          icon={<Hourglass size={32} />}
          title="No open corrective actions"
          description="Nothing to age — the backlog is empty."
        />
      ) : (
        <div className="space-y-5">
          {BUCKETS.map((b) => {
            const rowsInBucket = grouped[b.key]
            if (rowsInBucket.length === 0) return null
            return (
              <section
                key={b.key}
                className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
              >
                <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/80">
                  <div className="flex items-center gap-2">
                    <Badge className={b.tone} variant="default">
                      {b.label}
                    </Badge>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{b.help}</span>
                  </div>
                  <Badge variant="secondary">{rowsInBucket.length} open</Badge>
                </header>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:text-slate-400">
                      <th className="px-4 py-2">Ref</th>
                      <th className="px-4 py-2">Title</th>
                      <th className="px-4 py-2">Severity</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Owner</th>
                      <th className="px-4 py-2">Site</th>
                      <th className="px-4 py-2">Assigned</th>
                      <th className="px-4 py-2 text-right">Age (days)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rowsInBucket.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60">
                        <td className="px-4 py-2 font-mono text-xs">
                          <Link
                            href={`/corrective-actions/${r.id}` as any}
                            className="hover:underline"
                          >
                            {r.reference}
                          </Link>
                        </td>
                        <td className="px-4 py-2">
                          <Link
                            href={`/corrective-actions/${r.id}` as any}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            {r.title}
                          </Link>
                        </td>
                        <td className="px-4 py-2">
                          <Badge
                            variant={
                              r.severity === 'critical' || r.severity === 'high'
                                ? 'destructive'
                                : r.severity === 'medium'
                                  ? 'warning'
                                  : 'secondary'
                            }
                          >
                            {r.severity}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="warning">{r.status.replace('_', ' ')}</Badge>
                        </td>
                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                          {r.ownerName ?? '—'}
                        </td>
                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                          {r.siteName ?? '—'}
                        </td>
                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                          {r.assignedOn ?? '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs font-medium text-slate-900 dark:text-slate-100">
                          {r.ageDays}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )
          })}
        </div>
      )}
    </ListPageLayout>
  )
}
