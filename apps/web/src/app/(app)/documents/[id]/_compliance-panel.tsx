// The Compliance tab body: which compliance obligations this document is part
// of. Mirrors the hub's rollup query (_compliance/_hub.ts obligationRollup) but
// scoped to one document via target_ref->>'documentId', and reads the
// materialised compliance_status scoreboard for per-person completion.

import Link from 'next/link'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { ArrowUpRight, Plus, ShieldCheck } from 'lucide-react'
import { Badge, Button, EmptyState } from '@beaconhs/ui'
import {
  type ComplianceRecurrence,
  complianceObligations,
  complianceStatus,
} from '@beaconhs/db/schema'
import type { requireRequestContext } from '@/lib/auth'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

type DocObligationRow = {
  id: string
  title: string
  status: 'active' | 'paused' | 'archived'
  recurrence: ComplianceRecurrence | null
  total: number
  completed: number
  overdue: number
  percent: number
}

/** Every compliance obligation that targets this document. */
export async function loadDocumentObligations(
  ctx: Ctx,
  documentId: string,
): Promise<DocObligationRow[]> {
  const rows = await ctx.db((tx) =>
    tx
      .select({
        id: complianceObligations.id,
        title: complianceObligations.title,
        status: complianceObligations.status,
        recurrence: complianceObligations.recurrence,
        total: sql<number>`count(${complianceStatus.id})::int`,
        completed: sql<number>`count(*) filter (where ${complianceStatus.status} = 'completed')::int`,
        overdue: sql<number>`count(*) filter (where ${complianceStatus.status} in ('overdue','expiring'))::int`,
      })
      .from(complianceObligations)
      .leftJoin(complianceStatus, eq(complianceStatus.obligationId, complianceObligations.id))
      .where(
        and(
          eq(complianceObligations.tenantId, ctx.tenantId),
          eq(complianceObligations.sourceModule, 'document'),
          sql`${complianceObligations.targetRef}->>'documentId' = ${documentId}`,
          isNull(complianceObligations.deletedAt),
        ),
      )
      .groupBy(complianceObligations.id)
      .orderBy(complianceObligations.title)
      .limit(100),
  )
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    recurrence: r.recurrence,
    total: Number(r.total),
    completed: Number(r.completed),
    overdue: Number(r.overdue),
    percent: Number(r.total) === 0 ? 0 : Math.round((Number(r.completed) / Number(r.total)) * 100),
  }))
}

function recurrenceSummary(rec: ComplianceRecurrence | null): string {
  if (!rec) return 'One-time'
  if (rec.kind === 'one_time') return rec.dueOn ? `Due ${rec.dueOn}` : 'One-time'
  if (rec.kind === 'frequency') {
    const q = rec.quantity ?? 1
    return `Every ${q > 1 ? `${q} ` : ''}${rec.frequency ?? 'period'}${q > 1 ? 's' : ''}`
  }
  return rec.kind.replace(/_/g, ' ')
}

export function DocumentCompliancePanel({
  documentId,
  obligations,
  canAssign,
}: {
  documentId: string
  obligations: DocObligationRow[]
  canAssign: boolean
}) {
  const createHref = `/compliance/obligations/new?kind=document&documentId=${documentId}`

  if (obligations.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={<ShieldCheck size={24} />}
          title="Not part of any obligation"
          description="This document isn't required by a compliance obligation yet. Create one to require people to acknowledge it on a cadence."
        />
        {canAssign ? (
          <Link href={createHref}>
            <Button type="button" className="w-full">
              <Plus size={14} /> Create a compliance obligation
            </Button>
          </Link>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {obligations.map((o) => (
        <Link
          key={o.id}
          href={`/compliance/obligations/${o.id}`}
          className="block rounded-lg border border-slate-200 p-3 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-slate-700 dark:hover:bg-slate-800/60"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {o.title}
            </span>
            <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-slate-400" />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge
              variant={
                o.status === 'active' ? 'success' : o.status === 'paused' ? 'warning' : 'secondary'
              }
            >
              {o.status}
            </Badge>
            <Badge variant="outline">{recurrenceSummary(o.recurrence)}</Badge>
            {o.overdue > 0 ? <Badge variant="destructive">{o.overdue} overdue</Badge> : null}
          </div>
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>
                {o.completed}/{o.total} people
              </span>
              <span>{o.percent}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full rounded-full ${o.overdue > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${o.percent}%` }}
              />
            </div>
          </div>
        </Link>
      ))}

      {canAssign ? (
        <Link href={createHref}>
          <Button type="button" variant="outline" className="w-full">
            <Plus size={14} /> Create another obligation
          </Button>
        </Link>
      ) : null}
    </div>
  )
}
