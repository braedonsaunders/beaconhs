import Link from 'next/link'
import { LinkIcon, ListChecks } from 'lucide-react'
import { and, count, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { Badge, EmptyState, PageHeader } from '@beaconhs/ui'
import { correctiveActions, incidents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { ListPageLayout } from '@/components/page-layout'
import { CorrectiveActionsSubNav } from '@/components/corrective-actions-sub-nav'

export const metadata = { title: 'Corrective actions by source' }
export const dynamic = 'force-dynamic'

type SourceRow = {
  sourceEntityType: string
  sourceEntityId: string | null
  total: number
  open: number
  closed: number
  costImpact: number
  sourceLabel: string
  sourceHref: string | null
}

/**
 * "By source" report — counts CAs grouped by their originating record so
 * the user can see which incidents / inspections / audits keep producing
 * fix-its. Incident sources resolve to their reference + link; other
 * source types fall back to the raw ID.
 */
export default async function BySourceReport() {
  const ctx = await requireRequestContext()

  const grouped = await ctx.db(async (tx) => {
    // Per-user record visibility — same predicate as the /corrective-actions
    // list page, so a self/site-tier user only aggregates their slice here too.
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'ca',
      ownerCols: [correctiveActions.ownerTenantUserId],
      siteCol: correctiveActions.siteOrgUnitId,
    })
    return tx
      .select({
        sourceEntityType: correctiveActions.sourceEntityType,
        sourceEntityId: correctiveActions.sourceEntityId,
        total: count().mapWith(Number),
        open: sql<number>`SUM(CASE WHEN ${correctiveActions.status} IN ('open','in_progress','pending_verification') THEN 1 ELSE 0 END)`.mapWith(
          Number,
        ),
        closed:
          sql<number>`SUM(CASE WHEN ${correctiveActions.status} = 'closed' THEN 1 ELSE 0 END)`.mapWith(
            Number,
          ),
        costImpact: sql<string>`COALESCE(SUM(${correctiveActions.costImpact}), 0)`,
      })
      .from(correctiveActions)
      .where(
        and(
          isNull(correctiveActions.deletedAt),
          isNotNull(correctiveActions.sourceEntityType),
          vis,
        ),
      )
      .groupBy(correctiveActions.sourceEntityType, correctiveActions.sourceEntityId)
      .orderBy(sql`COUNT(*) DESC`)
  })

  const incidentIds = grouped
    .filter((g) => g.sourceEntityType === 'incident' && g.sourceEntityId)
    .map((g) => g.sourceEntityId as string)
  const incidentLookup = new Map<string, { reference: string; title: string }>()
  if (incidentIds.length > 0) {
    const incRows = await ctx.db(async (tx) => {
      // Incident references/titles are themselves tier-scoped: an incident the
      // caller cannot see falls back to the anonymous "Incident <id>" label.
      const incVis = await moduleScopeWhere(ctx, tx, {
        prefix: 'incidents',
        ownerCols: [incidents.reportedByTenantUserId],
        siteCol: incidents.siteOrgUnitId,
      })
      return tx
        .select({ id: incidents.id, reference: incidents.reference, title: incidents.title })
        .from(incidents)
        .where(and(inArray(incidents.id, incidentIds), isNull(incidents.deletedAt), incVis))
    })
    for (const i of incRows) incidentLookup.set(i.id, { reference: i.reference, title: i.title })
  }

  const rows: SourceRow[] = grouped.map((g) => {
    let sourceLabel = 'Unlinked'
    let sourceHref: string | null = null
    const type = (g.sourceEntityType ?? '').replace(/_/g, ' ')
    if (g.sourceEntityType === 'incident' && g.sourceEntityId) {
      const inc = incidentLookup.get(g.sourceEntityId)
      sourceLabel = inc
        ? `${inc.reference} · ${inc.title}`
        : `Incident ${g.sourceEntityId.slice(0, 8)}`
      sourceHref = `/incidents/${g.sourceEntityId}`
    } else if (g.sourceEntityId) {
      sourceLabel = `${type} ${g.sourceEntityId.slice(0, 8)}`
    } else {
      sourceLabel = type
    }
    return {
      sourceEntityType: g.sourceEntityType ?? '',
      sourceEntityId: g.sourceEntityId,
      total: Number(g.total ?? 0),
      open: Number(g.open ?? 0),
      closed: Number(g.closed ?? 0),
      costImpact: Number(g.costImpact ?? 0),
      sourceLabel,
      sourceHref,
    }
  })

  // Roll up per-source-type totals for the header strip.
  const typeTotals = new Map<string, number>()
  for (const r of rows) {
    typeTotals.set(r.sourceEntityType, (typeTotals.get(r.sourceEntityType) ?? 0) + r.total)
  }

  return (
    <ListPageLayout
      header={
        <>
          <CorrectiveActionsSubNav active="by-source" />
          <PageHeader
            title="Corrective actions by source"
            description="Sources producing the most corrective actions."
            back={{ href: '/corrective-actions', label: 'Back to records' }}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {Array.from(typeTotals.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([t, n]) => (
                <Badge key={t} variant="secondary">
                  {t.replace(/_/g, ' ')}: {n}
                </Badge>
              ))}
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ListChecks size={32} />}
          title="No source-linked corrective actions"
          description="CAs created without a source record won't appear here."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                <th className="px-4 py-2">Source type</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2 text-right">Open</th>
                <th className="px-4 py-2 text-right">Closed</th>
                <th className="px-4 py-2 text-right">Cost impact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <tr
                  key={`${r.sourceEntityType}:${r.sourceEntityId ?? '_'}`}
                  className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60"
                >
                  <td className="px-4 py-2">
                    <Badge variant="outline">{r.sourceEntityType.replace(/_/g, ' ')}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    {r.sourceHref ? (
                      <Link
                        href={r.sourceHref as any}
                        className="inline-flex items-center gap-1 text-teal-700 hover:underline dark:text-teal-400"
                      >
                        <LinkIcon size={11} />
                        {r.sourceLabel}
                      </Link>
                    ) : (
                      <span className="text-slate-700 dark:text-slate-300">{r.sourceLabel}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{r.total}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-amber-700 dark:text-amber-400">
                    {r.open}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-emerald-700 dark:text-emerald-400">
                    {r.closed}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-slate-700 dark:text-slate-300">
                    {r.costImpact > 0 ? formatMoney(r.costImpact) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ListPageLayout>
  )
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}
