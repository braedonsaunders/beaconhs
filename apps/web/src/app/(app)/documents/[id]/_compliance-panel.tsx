import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { useGeneratedTranslations } from '@/i18n/generated'
// The Compliance tab body: which compliance obligations this document is part
// of. Mirrors the hub's rollup query (_compliance/_hub.ts obligationRollup) but
// scoped to one document via target_ref->>'documentId', and reads the
// materialised compliance_status scoreboard for per-person completion.

import Link from 'next/link'
import { and, count, eq, ilike, isNull, sql } from 'drizzle-orm'
import { ArrowUpRight, Plus, ShieldCheck } from 'lucide-react'
import { Badge, Button, EmptyState } from '@beaconhs/ui'
import {
  type ComplianceRecurrence,
  complianceObligations,
  complianceStatus,
} from '@beaconhs/db/schema'
import type { requireRequestContext } from '@/lib/auth'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'

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
  options: {
    q?: string
    status?: 'active' | 'paused' | 'archived'
    page: number
    perPage: number
  },
): Promise<{ rows: DocObligationRow[]; total: number; filteredTotal: number }> {
  return ctx.db(async (tx) => {
    const baseWhere = and(
      eq(complianceObligations.tenantId, ctx.tenantId),
      eq(complianceObligations.sourceModule, 'document'),
      sql`${complianceObligations.targetRef}->>'documentId' = ${documentId}`,
      isNull(complianceObligations.deletedAt),
    )
    const filteredWhere = and(
      baseWhere,
      options.q ? ilike(complianceObligations.title, `%${options.q}%`) : undefined,
      options.status ? eq(complianceObligations.status, options.status) : undefined,
    )
    const [totalRows, filteredRows, rows] = await Promise.all([
      tx.select({ count: count() }).from(complianceObligations).where(baseWhere),
      tx.select({ count: count() }).from(complianceObligations).where(filteredWhere),
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
        .where(filteredWhere)
        .groupBy(complianceObligations.id)
        .orderBy(complianceObligations.title, complianceObligations.id)
        .limit(options.perPage)
        .offset((options.page - 1) * options.perPage),
    ])
    return {
      rows: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        recurrence: row.recurrence,
        total: Number(row.total),
        completed: Number(row.completed),
        overdue: Number(row.overdue),
        percent:
          Number(row.total) === 0
            ? 0
            : Math.round((Number(row.completed) / Number(row.total)) * 100),
      })),
      total: Number(totalRows[0]?.count ?? 0),
      filteredTotal: Number(filteredRows[0]?.count ?? 0),
    }
  })
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
  total,
  filteredTotal,
  page,
  perPage,
  currentParams,
  canAssign,
}: {
  documentId: string
  obligations: DocObligationRow[]
  total: number
  filteredTotal: number
  page: number
  perPage: number
  currentParams: Record<string, string | string[] | undefined>
  canAssign: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  const createHref = `/compliance/obligations/new?kind=document&documentId=${documentId}`
  const basePath = `/documents/${documentId}`

  if (total === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={<ShieldCheck size={24} />}
          title={tGenerated('m_18c09e710c69d9')}
          description={tGenerated('m_0599ebf0af3b5e')}
        />
        <GeneratedValue
          value={
            canAssign ? (
              <Link href={createHref}>
                <Button type="button" className="w-full">
                  <Plus size={14} /> <GeneratedText id="m_1beceb6c11d610" />
                </Button>
              </Link>
            ) : null
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <TableToolbar>
        <SearchInput
          placeholder={tGenerated('m_165fc021aeb94d')}
          paramKey="complianceQ"
          pageParamKey="compliancePage"
        />
        <FilterChips
          basePath={basePath}
          currentParams={currentParams}
          paramKey="complianceStatus"
          pageParamKey="compliancePage"
          label={tGenerated('m_0b9da892d6faf0')}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'paused', label: 'Paused' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
      </TableToolbar>

      <GeneratedValue
        value={
          obligations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <GeneratedText id="m_04d568ef0a596c" />
            </div>
          ) : null
        }
      />
      <GeneratedValue
        value={obligations.map((o) => (
          <Link
            key={o.id}
            href={`/compliance/obligations/${o.id}`}
            className="block rounded-lg border border-slate-200 p-3 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-slate-700 dark:hover:bg-slate-800/60"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                <GeneratedValue value={o.title} />
              </span>
              <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-slate-400" />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge
                variant={
                  o.status === 'active'
                    ? 'success'
                    : o.status === 'paused'
                      ? 'warning'
                      : 'secondary'
                }
              >
                <GeneratedValue value={o.status} />
              </Badge>
              <Badge variant="outline">
                <GeneratedValue value={recurrenceSummary(o.recurrence)} />
              </Badge>
              <GeneratedValue
                value={
                  o.overdue > 0 ? (
                    <Badge variant="destructive">
                      <GeneratedValue value={o.overdue} /> <GeneratedText id="m_06e3b632d95096" />
                    </Badge>
                  ) : null
                }
              />
            </div>
            <div className="mt-2">
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>
                  <GeneratedValue value={o.completed} />/<GeneratedValue value={o.total} />{' '}
                  <GeneratedText id="m_01376047f0528f" />
                </span>
                <span>
                  <GeneratedValue value={o.percent} />%
                </span>
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
      />

      <Pagination
        basePath={basePath}
        currentParams={currentParams}
        total={filteredTotal}
        page={page}
        perPage={perPage}
        pageParamKey="compliancePage"
      />

      <GeneratedValue
        value={
          canAssign ? (
            <Link href={createHref}>
              <Button type="button" variant="outline" className="w-full">
                <Plus size={14} /> <GeneratedText id="m_0b70b30e456639" />
              </Button>
            </Link>
          ) : null
        }
      />
    </div>
  )
}
