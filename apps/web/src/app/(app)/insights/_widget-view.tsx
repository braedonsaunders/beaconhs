'use client'

// Renders one Insights widget from the shared data payload. Charts use Recharts
// (client-only), styled to the slate + teal system. Each widget fills its grid
// cell (h-full flex column: title row + flex-1 visual).

import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@beaconhs/ui'
import type { InsightsData } from './_data'
import { JournalAnalysisWidget } from './_ai-widget'

const TEAL = '#0d9488'
const TEAL_SOFT = '#99f6e4'
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Pt = { x: string; y: number | null }

export function WidgetView({ id, data }: { id: string; data: InsightsData }) {
  switch (id) {
    case 'ai-analysis':
      return <JournalAnalysisWidget aiEnabled={data.aiEnabled} />
    case 'journal-total':
      return <Kpi label="Journal entries" value={data.journal.total} />
    case 'journal-last30':
      return <Kpi label="Journals · 30 days" value={data.journal.last30} />
    case 'journal-people':
      return <Kpi label="People journaling" value={data.journal.people} />
    case 'journal-activity':
      return (
        <Shell title="Journal activity" subtitle="last 12 weeks">
          <AreaViz data={data.journal.byWeek.map((w) => ({ x: w.week.slice(5), y: w.count }))} />
        </Shell>
      )
    case 'journal-by-site':
      return (
        <Shell title="Journals by site">
          <BarViz horizontal data={data.journal.bySite.map((s) => ({ x: s.name, y: s.count }))} />
        </Shell>
      )
    case 'journal-top-topics':
      return (
        <Shell title="Top journal topics">
          <BarViz horizontal data={data.journal.topTags.map((t) => ({ x: t.tag, y: t.count }))} />
        </Shell>
      )
    case 'journal-by-dow':
      return (
        <Shell title="Journals by weekday">
          <BarViz data={data.journal.byDow.map((c, i) => ({ x: DOW[i]!, y: c }))} />
        </Shell>
      )

    case 'kpi-incidents':
      return (
        <Kpi
          label="Incidents · 30 days"
          value={data.kpi.incidents30}
          delta={data.kpi.incidents30 - data.kpi.incidentsPrev30}
          lowerIsBetter
        />
      )
    case 'kpi-days-recordable':
      return <Kpi label="Days since recordable" value={data.kpi.daysSinceRecordable ?? '—'} />
    case 'kpi-open-cas':
      return <Kpi label="Open corrective actions" value={data.kpi.openCAs} />
    case 'kpi-overdue-cas':
      return <Kpi label="Overdue CAs" value={data.kpi.overdueCAs} tone={data.kpi.overdueCAs > 0 ? 'red' : 'teal'} />
    case 'chart-trir':
      return (
        <Shell title="TRIR" subtitle={`now ${fmtRate(data.trir.value)} · recordables / 12 mo`}>
          <LineViz data={trendPts(data.trir.trend)} />
        </Shell>
      )
    case 'chart-dart':
      return (
        <Shell title="DART" subtitle={`now ${fmtRate(data.dart.value)} · cases / 12 mo`}>
          <LineViz data={trendPts(data.dart.trend)} />
        </Shell>
      )
    case 'chart-severity':
      return (
        <Shell title="Severity distribution" subtitle="last 12 months">
          <BarViz horizontal data={data.severity.map((s) => ({ x: s.label, y: s.value }))} />
        </Shell>
      )
    case 'chart-ca-aging':
      return (
        <Shell title="CA aging">
          <BarViz
            data={[
              { x: '<7d', y: data.caBuckets.lt7 },
              { x: '<30d', y: data.caBuckets.lt30 },
              { x: '<60d', y: data.caBuckets.lt60 },
              { x: '≥60d', y: data.caBuckets.ge60 },
            ]}
          />
        </Shell>
      )
    case 'chart-top-sites':
      return (
        <Shell title="Top sites by incidents">
          <BarViz horizontal data={data.topSites.map((s) => ({ x: s.name, y: s.value }))} />
        </Shell>
      )

    case 'kpi-training-compliance':
      return <Progress label="Training compliance" pct={data.trainingPct} />
    case 'kpi-doc-compliance':
      return <Progress label="Document compliance" pct={data.docPct} />

    case 'kpi-cs-active':
      return <Kpi label="Active CS permits" value={data.kpi.csActive} />
    case 'kpi-lw-active':
      return <Kpi label="Active lone workers" value={data.kpi.lwActive} />
    case 'kpi-ppe-issues':
      return <Kpi label="Open PPE issues" value={data.kpi.ppeOpenIssues} />
    case 'kpi-submissions':
      return <Kpi label="Submissions today" value={data.kpi.submissionsToday} />
    case 'kpi-inspections':
      return <Kpi label="Inspections MTD" value={data.kpi.inspectionsThisMonth} />
    case 'kpi-people':
      return <Kpi label="Active people" value={data.kpi.peopleCount} />

    default:
      return (
        <Shell title="Widget">
          <div className="grid h-full place-items-center text-xs text-slate-400">No view for “{id}”.</div>
        </Shell>
      )
  }
}

// ---- shells -----------------------------------------------------------------

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="truncate text-sm font-semibold text-slate-800">{title}</h3>
        {subtitle ? <span className="shrink-0 text-[11px] text-slate-400">{subtitle}</span> : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

function Kpi({
  label,
  value,
  delta,
  lowerIsBetter,
  tone = 'slate',
}: {
  label: string
  value: number | string
  delta?: number
  lowerIsBetter?: boolean
  tone?: 'teal' | 'slate' | 'red'
}) {
  const good = delta == null ? null : lowerIsBetter ? delta <= 0 : delta >= 0
  return (
    <div className="flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <div className="flex items-end gap-2">
        <span
          className={cn(
            'text-3xl font-bold tabular-nums',
            tone === 'teal' ? 'text-teal-700' : tone === 'red' ? 'text-red-600' : 'text-slate-900',
          )}
        >
          {value}
        </span>
        {delta != null && delta !== 0 ? (
          <span
            className={cn(
              'mb-1 inline-flex items-center text-xs font-medium',
              good ? 'text-teal-600' : 'text-red-500',
            )}
          >
            {delta > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(delta)}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function Progress({ label, pct }: { label: string; pct: number | null }) {
  const v = pct ?? 0
  const tone = v >= 80 ? 'bg-teal-500' : v >= 50 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <div>
        <div className="mb-1.5 text-3xl font-bold tabular-nums text-slate-900">
          {pct == null ? '—' : `${Math.round(v)}%`}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className={cn('h-full rounded-full', tone)} style={{ width: `${v}%` }} />
        </div>
      </div>
    </div>
  )
}

// ---- charts -----------------------------------------------------------------

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    fontSize: 12,
    boxShadow: '0 4px 16px rgba(15,23,42,0.08)',
  },
  labelStyle: { color: '#475569', fontWeight: 600 },
}

function AreaViz({ data }: { data: Pt[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="areaTeal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TEAL} stopOpacity={0.35} />
            <stop offset="100%" stopColor={TEAL} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="x" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
        <Tooltip {...tooltipStyle} />
        <Area type="monotone" dataKey="y" stroke={TEAL} strokeWidth={2} fill="url(#areaTeal)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function LineViz({ data }: { data: Pt[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="x" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
        <Tooltip {...tooltipStyle} />
        <Line type="monotone" dataKey="y" stroke={TEAL} strokeWidth={2} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  )
}

function BarViz({ data, horizontal }: { data: Pt[]; horizontal?: boolean }) {
  if (data.length === 0) {
    return <div className="grid h-full place-items-center text-xs text-slate-400">No data yet.</div>
  }
  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="x" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={92} />
          <Tooltip {...tooltipStyle} cursor={{ fill: '#f8fafc' }} />
          <Bar dataKey="y" radius={[0, 4, 4, 0]} maxBarSize={20}>
            {data.map((_, i) => (
              <Cell key={i} fill={i === 0 ? TEAL : TEAL_SOFT} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="x" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
        <Tooltip {...tooltipStyle} cursor={{ fill: '#f8fafc' }} />
        <Bar dataKey="y" radius={[4, 4, 0, 0]} fill={TEAL} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function fmtRate(v: number | null): string {
  return v == null ? '—' : v.toFixed(2)
}
function trendPts(trend: (number | null)[]): Pt[] {
  return trend.map((v, i) => ({ x: `M${i + 1}`, y: v }))
}
