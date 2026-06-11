// Per-item ROI report.
//
// Expenses come from equipment_expenses.amount summed over the period.
// Revenue is computed as truck_log_entries.hours_on_site × equipment_rates.hourly
// for the asset's type. We don't have a dedicated `hours_used` column on
// equipment_log_entries (those are freeform shop-journal entries) so the
// truck-log hours table is the canonical hours source — same source the
// fleet ROI report uses.
//
// Defaults to the last 365 days. ?from=YYYY-MM-DD&to=YYYY-MM-DD overrides.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, between, eq, gte, lte, sql } from 'drizzle-orm'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@beaconhs/ui'
import {
  equipmentExpenses,
  equipmentItems,
  equipmentRates,
  equipmentTypes,
  truckLogEntries,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { AnimatedBar } from '@/app/(app)/dashboard/_bar'

export const dynamic = 'force-dynamic'

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

function monthLabel(key: string): string {
  const [year, month] = key.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `ROI · ${id.slice(0, 8)}` }
}

export default async function EquipmentRoiPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams

  // Period — default to the trailing 365 days, but accept overrides.
  const today = new Date()
  const defaultFrom = new Date(today)
  defaultFrom.setDate(defaultFrom.getDate() - 365)
  const fromIso = pickString(sp.from) ?? isoDate(defaultFrom)
  const toIso = pickString(sp.to) ?? isoDate(today)

  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ item: equipmentItems, type: equipmentTypes, rate: equipmentRates })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(equipmentRates, eq(equipmentRates.typeId, equipmentItems.typeId))
      .where(eq(equipmentItems.id, id))
      .limit(1)
    if (!row) return null

    const expenses = await tx
      .select({
        incurredOn: equipmentExpenses.incurredOn,
        amount: equipmentExpenses.amount,
      })
      .from(equipmentExpenses)
      .where(
        and(
          eq(equipmentExpenses.equipmentItemId, id),
          between(equipmentExpenses.incurredOn, fromIso, toIso),
        ),
      )
      .orderBy(asc(equipmentExpenses.incurredOn))

    const usage = await tx
      .select({
        entryDate: truckLogEntries.entryDate,
        hoursOnSite: truckLogEntries.hoursOnSite,
      })
      .from(truckLogEntries)
      .where(
        and(
          eq(truckLogEntries.equipmentItemId, id),
          gte(truckLogEntries.entryDate, fromIso),
          lte(truckLogEntries.entryDate, toIso),
        ),
      )
      .orderBy(asc(truckLogEntries.entryDate))

    return { ...row, expenses, usage }
  })

  if (!data) notFound()
  const { item, type, rate, expenses, usage } = data

  // ---- Roll up totals ---------------------------------------------------
  const expensesTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const hoursTotal = usage.reduce((s, u) => s + (Number(u.hoursOnSite) || 0), 0)
  const hourly = Number(rate?.hourly ?? 0) || 0
  const dailyRate = Number(rate?.daily ?? 0) || 0
  // Primary revenue model: hours × hourly. Fallback to "days-in-use ×
  // daily rate" if no hourly rate is set and we have a daily rate. This
  // satisfies the "if equipment_rates shape doesn't make this easy" escape
  // in the spec — it's a closer approximation than nothing.
  const usingFallback = hourly === 0 && dailyRate > 0
  const daysInUse = new Set(usage.map((u) => u.entryDate)).size
  const revenueTotal = usingFallback ? daysInUse * dailyRate : hoursTotal * hourly
  const net = revenueTotal - expensesTotal
  const roiPct = expensesTotal > 0 ? (net / expensesTotal) * 100 : null

  // ---- Per-month breakdown ----------------------------------------------
  type MonthBucket = { key: string; label: string; expenses: number; revenue: number }
  const months: Map<string, MonthBucket> = new Map()

  // Seed every month in the period so the bar chart shows zeroed months.
  const start = new Date(`${fromIso}T00:00:00Z`)
  const end = new Date(`${toIso}T00:00:00Z`)
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
  const lastMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))
  while (cursor.getTime() <= lastMonth.getTime()) {
    const k = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`
    months.set(k, { key: k, label: monthLabel(k), expenses: 0, revenue: 0 })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }

  for (const e of expenses) {
    const k = monthKey(e.incurredOn)
    const bucket = months.get(k)
    if (bucket) bucket.expenses += Number(e.amount) || 0
  }
  for (const u of usage) {
    const k = monthKey(u.entryDate)
    const bucket = months.get(k)
    if (!bucket) continue
    if (usingFallback) {
      bucket.revenue += dailyRate // 1 entry-day = 1 daily rate
    } else {
      bucket.revenue += (Number(u.hoursOnSite) || 0) * hourly
    }
  }

  const monthBuckets = Array.from(months.values())
  const monthMax = Math.max(1, ...monthBuckets.map((m) => Math.max(m.expenses, m.revenue)))

  const basePath = `/equipment/${id}`
  return (
    <PageContainer>
      <div className="space-y-5">
        <PageHeader
          title={`${item.name} · ROI`}
          description={`${item.assetTag}${type ? ` · ${type.name}` : ''} — ${fromIso} → ${toIso}`}
          back={{ href: basePath, label: 'Back to equipment' }}
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Expenses" value={fmtMoney(expensesTotal)} tone="amber" />
          <StatCard label="Revenue" value={fmtMoney(revenueTotal)} tone="teal" />
          <StatCard label="Net" value={fmtMoney(net)} tone={net >= 0 ? 'teal' : 'rose'} />
          <StatCard
            label="ROI"
            value={roiPct === null ? '—' : fmtPct(roiPct)}
            tone={roiPct === null ? 'slate' : roiPct >= 0 ? 'teal' : 'rose'}
            caption={roiPct === null ? 'No expenses in period' : 'Net ÷ expenses'}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Monthly expenses vs revenue</CardTitle>
          </CardHeader>
          <CardContent>
            {monthBuckets.every((m) => m.expenses === 0 && m.revenue === 0) ? (
              <p className="py-6 text-center text-sm text-slate-500">
                No expenses or usage recorded in this period.
              </p>
            ) : (
              <ul className="space-y-3">
                {monthBuckets.map((m, idx) => (
                  <li key={m.key} className="grid grid-cols-[80px_1fr] items-center gap-4">
                    <span className="text-xs text-slate-600">{m.label}</span>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <AnimatedBar
                            pct={(m.revenue / monthMax) * 100}
                            delay={0.05 + idx * 0.02}
                            tone="teal"
                          />
                        </div>
                        <span className="w-20 shrink-0 text-right text-[11px] text-emerald-700 tabular-nums">
                          {fmtMoney(m.revenue)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <AnimatedBar
                            pct={(m.expenses / monthMax) * 100}
                            delay={0.05 + idx * 0.02}
                            tone="amber"
                          />
                        </div>
                        <span className="w-20 shrink-0 text-right text-[11px] text-amber-700 tabular-nums">
                          {fmtMoney(m.expenses)}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assumptions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-xs text-slate-600">
              <li>
                Expenses: <Badge variant="secondary">equipment_expenses</Badge> rows with{' '}
                <code>incurred_on</code> in this period.
              </li>
              <li>
                {usingFallback ? (
                  <>
                    Revenue (estimated): daily rate <strong>{fmtMoney(dailyRate)}</strong> ×{' '}
                    <strong>{daysInUse}</strong> days in use. No hourly rate is set for this
                    equipment type — switch to hourly under{' '}
                    <Link className="text-teal-700 hover:underline" href="/equipment/rates">
                      Rates
                    </Link>{' '}
                    for a more precise figure.
                  </>
                ) : (
                  <>
                    Revenue: hours-on-site (from{' '}
                    <Badge variant="secondary">truck_log_entries</Badge>) × hourly rate{' '}
                    <strong>{fmtMoney(hourly)}</strong> for <strong>{type?.name ?? '—'}</strong>.{' '}
                    <strong>{hoursTotal.toFixed(1)}</strong> hours across the period.
                  </>
                )}
              </li>
              <li>
                ROI % = (revenue − expenses) ÷ expenses. Defaults to a trailing 365-day window; pass{' '}
                <code>?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</code> to override.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

function StatCard({
  label,
  value,
  caption,
  tone,
}: {
  label: string
  value: string
  caption?: string
  tone: 'teal' | 'amber' | 'rose' | 'slate'
}) {
  const valueClass =
    tone === 'rose'
      ? 'text-rose-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'teal'
          ? 'text-emerald-700'
          : 'text-slate-900'
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
        {label}
      </div>
      <div className={`mt-2 text-3xl leading-none font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
      {caption ? <div className="mt-2 text-[11px] text-slate-500">{caption}</div> : null}
    </div>
  )
}
