'use client'

// Single client-side renderer that switches on widget id.
//
// The server page loads `DashboardMetrics` once, then passes the full payload
// to each <WidgetCard> via the dashboard grid. We avoid re-fetching client-side.
//
// Each card returns a full-height card so it fills its grid cell. Cards do
// NOT manage their own width/height — the grid does. Cards just stretch.

import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Boxes,
  Calendar,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FileCheck,
  GraduationCap,
  HardHat,
  Inbox,
  ListChecks,
  LogIn,
  MapPin,
  Minus,
  NotebookPen,
  PencilLine,
  Radio,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@beaconhs/ui'
import type { DashboardMetrics } from './_metrics'
import { AnimatedNumber } from './_counter'
import { Sparkline } from './_sparkline'
import { AnimatedBar } from './_bar'
import { QuickActions } from './_quick-actions'
import type { QuickAction } from './_quick-actions-shared'
import { checkInEquipment } from '../equipment/_actions'

// =====================================================================
// Public entry — switch on widget id and render the right card
// =====================================================================

type Props = {
  widgetId: string
  data: DashboardMetrics
  todayIso: string
  /** User's saved Quick-actions tiles (only the personal-actions widget uses it). */
  quickActions?: QuickAction[]
}

export function WidgetCard({ widgetId, data, todayIso, quickActions }: Props) {
  switch (widgetId) {
    // KPIs — headline rates
    case 'kpi-trir':
      return (
        <RateTile
          label="TRIR"
          href="/incidents"
          icon={ShieldAlert}
          value={data.trir.value}
          prevValue={data.trir.prevValue}
          formatFn={fmtFixed2}
          caption={`${data.trir.recordableCount} recordable · ~${Math.round(
            data.trir.hoursWorked / 1000,
          )}k hrs`}
          trend={data.trir.trend}
          invertedDelta
          tooltip="Total recordable incident rate."
        />
      )
    case 'kpi-dart':
      return (
        <RateTile
          label="DART"
          href="/incidents"
          icon={Activity}
          value={data.dart.value}
          prevValue={data.dart.prevValue}
          formatFn={fmtFixed2}
          caption={`${data.dart.dartCount} DART · 12-mo rolling`}
          trend={data.dart.trend}
          invertedDelta
          tooltip="Days-away/restricted/transferred rate."
        />
      )
    case 'kpi-training-compliance':
      return (
        <RateTile
          label="Training compliance"
          href="/training"
          icon={GraduationCap}
          value={data.trainingCompliancePct}
          prevValue={null}
          formatFn={fmtInt}
          suffix="%"
          caption={`${data.trainingComplianceCounts.completed} of ${data.trainingComplianceCounts.total} records`}
          trend={data.trainingComplianceTrend}
        />
      )
    case 'kpi-document-compliance':
      return (
        <RateTile
          label="Document compliance"
          href="/documents"
          icon={FileCheck}
          value={data.documentCompliancePct}
          prevValue={null}
          formatFn={fmtInt}
          suffix="%"
          caption={`${data.documentComplianceCounts.acknowledged} of ${data.documentComplianceCounts.expected} acks`}
          trend={data.documentComplianceTrend}
        />
      )

    // Big-number scoreboard
    case 'kpi-days-since-recordable':
      return <DaysSinceCard days={data.daysSinceLastRecordable} lastDate={data.lastRecordableAt} />

    // Compact KPIs
    case 'kpi-open-cas':
      return (
        <CountTile
          label="Open CAs"
          value={data.openCAs}
          href="/corrective-actions"
          icon={ListChecks}
          caption={
            data.overdueCAs > 0
              ? `${data.overdueCAs} overdue`
              : data.openCAs > 0
                ? 'all on track'
                : 'none open'
          }
          tone={data.overdueCAs > 0 ? 'warning' : 'normal'}
        />
      )
    case 'kpi-overdue-cas':
      return (
        <CountTile
          label="Overdue CAs"
          value={data.overdueCAs}
          href="/corrective-actions/reports/overdue"
          icon={CalendarClock}
          caption={data.overdueCAs > 0 ? 'past due' : 'all clear'}
          tone={data.overdueCAs > 0 ? 'danger' : 'normal'}
        />
      )
    case 'kpi-incidents-30d': {
      const delta = data.incidents30 - data.incidentsPrev30
      return (
        <CountTile
          label="Incidents (30d)"
          value={data.incidents30}
          href="/incidents"
          icon={AlertTriangle}
          caption={
            delta === 0 ? 'flat vs prior 30d' : `${delta > 0 ? '+' : ''}${delta} vs prior 30d`
          }
          tone={delta > 0 ? 'warning' : 'normal'}
        />
      )
    }
    case 'kpi-expiring-certs':
      return (
        <CountTile
          label="Certs expiring (90d)"
          value={data.expiringCertsCount}
          href="/training"
          icon={GraduationCap}
          caption={data.expiringCertsCount > 0 ? 'plan renewals' : 'all current'}
          tone={data.expiringCertsCount > 0 ? 'warning' : 'normal'}
        />
      )
    case 'kpi-ppe-open-issues':
      return (
        <CountTile
          label="Open PPE issues"
          value={data.ppeOpenIssues}
          href="/ppe"
          icon={HardHat}
          caption={data.ppeOpenIssues > 0 ? 'awaiting resolution' : 'all clear'}
          tone={data.ppeOpenIssues > 0 ? 'warning' : 'normal'}
        />
      )
    case 'kpi-ppe-overdue':
      return (
        <CountTile
          label="PPE inspections overdue"
          value={data.ppeInspectionsOverdue}
          href="/ppe"
          icon={HardHat}
          caption={data.ppeInspectionsOverdue > 0 ? 'past annual due' : 'all current'}
          tone={data.ppeInspectionsOverdue > 0 ? 'danger' : 'normal'}
        />
      )
    case 'kpi-people-active':
      return (
        <CountTile
          label="Active people"
          value={data.peopleCount}
          href="/people"
          icon={Users}
          caption="currently active"
          tone="normal"
        />
      )

    // Operational status
    case 'op-lone-worker-active':
      return (
        <CountTile
          label="Monitored sessions"
          value={data.lwActive}
          href="/apps/sessions"
          icon={Radio}
          caption={data.lwActive > 0 ? 'session(s) running' : 'all quiet'}
          tone={data.lwActive > 0 ? 'warning' : 'normal'}
        />
      )
    case 'op-submissions-today':
      return (
        <CountTile
          label="Submissions today"
          value={data.submissionsToday}
          href="/apps/responses"
          icon={ClipboardList}
          caption="forms submitted"
          tone="normal"
        />
      )
    case 'op-inspections-mtd':
      return (
        <CountTile
          label="Inspections this month"
          value={data.inspectionsThisMonth}
          href="/inspections"
          icon={ClipboardCheck}
          caption="submitted or closed"
          tone="normal"
        />
      )

    // Lists
    case 'list-recent-incidents':
      return <RecentIncidentsList items={data.recentIncidents} />
    case 'list-due-cas':
      return <DueCAsList items={data.dueCAs} todayIso={todayIso} />
    case 'list-overdue-cas':
      return <OverdueCAsList items={data.topOverdueCAs} />
    case 'list-expiring-training':
      return <ExpiringTrainingList items={data.expiringTraining30d} todayIso={todayIso} />

    // Charts
    case 'chart-severity-pyramid':
      return <SeverityPyramid dist={data.severityDistribution} />
    case 'chart-capa-aging':
      return <CapaAgingChart buckets={data.openCABuckets} />
    case 'chart-top-sites':
      return <TopSitesChart items={data.topSitesByIncidents} />

    // Personal
    case 'personal-my-ppe':
      return <MyPpeCard items={data.myPpe} todayIso={todayIso} />
    case 'personal-my-equipment':
      return <MyEquipmentCard items={data.myEquipment} todayIso={todayIso} />
    case 'personal-my-compliance':
      return <MyComplianceCard data={data.myCompliance} />
    case 'personal-in-progress':
      return <InProgressList items={data.inProgressEntries} />
    case 'personal-inbox':
      return <InboxList items={data.myInbox} />
    case 'personal-actions':
      return <QuickActions actions={quickActions} />

    default:
      return (
        <CardShell title={`Unknown widget: ${widgetId}`} icon={AlertTriangle}>
          <EmptyRow>This widget is no longer available.</EmptyRow>
        </CardShell>
      )
  }
}

// =====================================================================
// Tile primitives — KPI + rate variants
// =====================================================================

type Tone = 'normal' | 'warning' | 'danger'

function CountTile({
  label,
  value,
  href,
  icon: Icon,
  caption,
  tone,
}: {
  label: string
  value: number | null
  href: string
  icon: LucideIcon
  caption: string
  tone: Tone
}) {
  const valueClass =
    tone === 'danger'
      ? 'text-rose-700'
      : tone === 'warning'
        ? 'text-amber-700'
        : 'text-slate-900 dark:text-slate-100'
  const iconRingClass =
    tone === 'danger'
      ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 ring-rose-100'
      : tone === 'warning'
        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 ring-amber-100'
        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-slate-100'
  const captionClass =
    tone === 'danger'
      ? 'text-rose-700'
      : tone === 'warning'
        ? 'text-amber-700'
        : 'text-slate-500 dark:text-slate-400'
  return (
    <Link
      href={href as any}
      className="group relative flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-teal-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-800/60"
    >
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase dark:text-slate-400">
          {label}
        </span>
        <span
          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 ring-inset ${iconRingClass}`}
        >
          <Icon size={14} />
        </span>
      </div>
      <div className="mt-1 flex-1">
        <div className={`text-4xl leading-none font-semibold tabular-nums ${valueClass}`}>
          <AnimatedNumber value={value ?? 0} format={(v) => Math.round(v).toLocaleString()} />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`text-[11px] ${captionClass}`}>{caption}</span>
        <ArrowRight
          size={12}
          className="shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-600"
        />
      </div>
    </Link>
  )
}

function RateTile({
  label,
  href,
  icon: Icon,
  value,
  prevValue,
  formatFn,
  suffix,
  caption,
  trend,
  invertedDelta = false,
  tooltip,
}: {
  label: string
  href: string
  icon: LucideIcon
  value: number | null
  prevValue: number | null
  formatFn: (v: number) => string
  suffix?: string
  caption: string
  trend: ReadonlyArray<number | null>
  invertedDelta?: boolean
  tooltip?: string
}) {
  const hasValue = value !== null && Number.isFinite(value)
  const delta =
    value !== null && prevValue !== null && Number.isFinite(prevValue) ? value - prevValue : null
  const dir: 'up' | 'down' | 'flat' =
    delta === null || Math.abs(delta) < 0.005 ? 'flat' : delta > 0 ? 'up' : 'down'
  const good = dir === 'flat' ? null : invertedDelta ? dir === 'down' : dir === 'up'
  const deltaTone =
    good === null
      ? 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-800'
      : good
        ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100'
        : 'text-rose-700 bg-rose-50 dark:bg-rose-950/40 border-rose-100'
  const DeltaIcon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : Minus
  const sparkStroke = good === false ? '#f43f5e' : good === true ? '#0d9488' : '#94a3b8'

  return (
    <Link
      href={href as any}
      title={tooltip}
      className="group relative flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-teal-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-800/60"
    >
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase dark:text-slate-400">
          {label}
        </span>
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 ring-1 ring-slate-100 ring-inset dark:bg-slate-800 dark:text-slate-300">
          <Icon size={14} />
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        {hasValue ? (
          <>
            <AnimatedNumber
              value={value!}
              format={formatFn}
              className="text-4xl leading-none font-semibold text-slate-900 tabular-nums dark:text-slate-100"
            />
            {suffix ? (
              <span className="text-xl font-semibold text-slate-500 dark:text-slate-400">
                {suffix}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-4xl leading-none font-semibold text-slate-400 tabular-nums dark:text-slate-500">
            —
          </span>
        )}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums ${deltaTone}`}
        >
          <DeltaIcon size={11} />
          {delta === null ? '— vs prior' : `${delta > 0 ? '+' : ''}${formatFn(Math.abs(delta))}`}
        </span>
        <div>
          <Sparkline
            data={trend}
            width={84}
            height={22}
            stroke={sparkStroke}
            ariaLabel={`${label} 12-mo trend`}
            showArea
          />
        </div>
      </div>
      <p className="mt-1.5 truncate text-[11px] text-slate-500 dark:text-slate-400">{caption}</p>
    </Link>
  )
}

function DaysSinceCard({ days, lastDate }: { days: number | null; lastDate: Date | null }) {
  const value = days ?? 0
  const display = days === null ? '—' : days.toLocaleString()
  const tone = days === null ? 'muted' : days >= 90 ? 'good' : days >= 30 ? 'ok' : 'attention'
  const bgClass =
    tone === 'good'
      ? 'from-emerald-700 via-emerald-800 to-teal-900'
      : tone === 'ok'
        ? 'from-teal-700 via-teal-800 to-slate-900'
        : tone === 'attention'
          ? 'from-amber-700 via-orange-800 to-rose-900'
          : 'from-slate-700 via-slate-800 to-slate-900'
  return (
    <div
      className={`relative flex h-full flex-col overflow-hidden rounded-xl bg-gradient-to-br ${bgClass} p-4 text-white shadow-sm`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          maskImage: 'radial-gradient(ellipse at top right, black 0%, transparent 70%)',
        }}
      />
      <div className="relative flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] text-white/70 uppercase">
          <ShieldCheck size={12} />
          Days since last recordable
        </div>
        <div className="my-auto flex min-h-0 flex-1 flex-col items-center justify-center text-center">
          {days === null ? (
            <FitText text="—" className="text-white" />
          ) : (
            <>
              <FitText text={display} className="text-white" />
              <div className="mt-1 text-[11px] tracking-[0.14em] text-white/60 uppercase">days</div>
            </>
          )}
        </div>
        <div className="text-center text-[11px] text-white/70">
          {lastDate ? `Last incident ${lastDate.toLocaleDateString()}` : 'No recordable on record'}
        </div>
      </div>
    </div>
  )
}

// =====================================================================
// Charts — pyramid, capa aging, top sites
// =====================================================================

function SeverityPyramid({ dist }: { dist: DashboardMetrics['severityDistribution'] }) {
  const rows: { key: string; label: string; count: number; tone: string }[] = [
    { key: 'fat', label: 'Fatality', count: dist.fatality, tone: 'bg-black text-white' },
    { key: 'lt', label: 'Lost-time', count: dist.lostTime, tone: 'bg-rose-600 text-white' },
    { key: 'ma', label: 'Medical aid', count: dist.medicalAid, tone: 'bg-rose-400 text-white' },
    { key: 'fa', label: 'First aid', count: dist.firstAid, tone: 'bg-amber-500 text-white' },
    { key: 'nm', label: 'Near miss', count: dist.nearMiss, tone: 'bg-sky-500 text-white' },
    { key: 'ni', label: 'No injury', count: dist.noInjury, tone: 'bg-slate-400 text-white' },
    {
      key: 'pd',
      label: 'Property damage',
      count: dist.propertyDamage,
      tone: 'bg-slate-300 text-slate-900',
    },
  ]
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1
  return (
    <CardShell
      title="Severity pyramid"
      caption="Last 12 months"
      icon={TrendingDown}
      href="/incidents"
      accent="rose"
    >
      <ul className="space-y-1.5 px-4 pt-1 pb-3">
        {rows.map((r, idx) => {
          const pct = (r.count / max) * 100
          return (
            <motion.li
              key={r.key}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.06 + idx * 0.05, duration: 0.32 }}
              className="grid grid-cols-[110px_1fr_44px] items-center gap-3 text-xs"
            >
              <span className="truncate text-slate-700 dark:text-slate-200">{r.label}</span>
              <div className="relative h-5 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(pct, r.count > 0 ? 6 : 0)}%` }}
                  transition={{ delay: 0.1 + idx * 0.06, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  className={`h-full rounded-md ${r.tone}`}
                />
              </div>
              <span className="text-right text-xs font-semibold text-slate-700 tabular-nums dark:text-slate-200">
                {r.count}
              </span>
            </motion.li>
          )
        })}
      </ul>
    </CardShell>
  )
}

function CapaAgingChart({ buckets }: { buckets: DashboardMetrics['openCABuckets'] }) {
  const rows = [
    { key: 'lt7', label: '< 7 days', count: buckets.lt7, tone: 'bg-emerald-500' },
    { key: 'lt30', label: '7 – 30 days', count: buckets.lt30, tone: 'bg-teal-500' },
    { key: 'lt60', label: '30 – 60 days', count: buckets.lt60, tone: 'bg-amber-500' },
    { key: 'ge60', label: '≥ 60 days', count: buckets.ge60, tone: 'bg-rose-600' },
  ]
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1
  const total = rows.reduce((s, r) => s + r.count, 0)
  return (
    <CardShell
      title="CAPA aging"
      caption={`${total} open across ${rows.filter((r) => r.count > 0).length || 0} buckets`}
      icon={ListChecks}
      href="/corrective-actions"
      accent="amber"
    >
      <div className="space-y-2 px-4 pt-1 pb-3">
        {rows.map((r, idx) => {
          const pct = (r.count / max) * 100
          return (
            <motion.div
              key={r.key}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.06 + idx * 0.05, duration: 0.3 }}
            >
              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                <span>{r.label}</span>
                <span className="font-semibold text-slate-700 tabular-nums dark:text-slate-200">
                  {r.count}
                </span>
              </div>
              <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(pct, r.count > 0 ? 6 : 0)}%` }}
                  transition={{ delay: 0.1 + idx * 0.06, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                  className={`h-full rounded-full ${r.tone}`}
                />
              </div>
            </motion.div>
          )
        })}
      </div>
    </CardShell>
  )
}

function TopSitesChart({ items }: { items: DashboardMetrics['topSitesByIncidents'] }) {
  const max = items.reduce((m, s) => Math.max(m, s.incidents), 0) || 1
  return (
    <CardShell
      title="Top sites by incidents"
      caption="Last 90 days"
      icon={MapPin}
      href="/incidents"
      accent="sky"
    >
      {items.length === 0 ? (
        <EmptyRow>No incidents in the last 90 days.</EmptyRow>
      ) : (
        <ul className="space-y-1.5 px-4 py-2">
          {items.map((s, idx) => {
            const pct = (s.incidents / max) * 100
            return (
              <motion.li
                key={s.siteId ?? `none-${idx}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.06 + idx * 0.05, duration: 0.3 }}
              >
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-700 tabular-nums dark:bg-slate-800 dark:text-slate-200">
                      {idx + 1}
                    </span>
                    <span className="truncate font-medium text-slate-800 dark:text-slate-100">
                      {s.siteName}
                    </span>
                  </div>
                  <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 tabular-nums dark:bg-rose-950/40">
                    {s.incidents}
                  </span>
                </div>
                <div className="mt-1.5">
                  <AnimatedBar
                    pct={pct}
                    delay={0.1 + idx * 0.06}
                    tone={pct > 75 ? 'rose' : pct > 40 ? 'amber' : 'teal'}
                  />
                </div>
              </motion.li>
            )
          })}
        </ul>
      )}
    </CardShell>
  )
}

// =====================================================================
// List widgets
// =====================================================================

function RecentIncidentsList({ items }: { items: DashboardMetrics['recentIncidents'] }) {
  return (
    <CardShell
      title="Recent incidents"
      caption="Last 5 reported"
      icon={AlertTriangle}
      href="/incidents"
      accent="rose"
    >
      {items.length === 0 ? (
        <EmptyRow>No incidents reported. Quiet on the front.</EmptyRow>
      ) : (
        <ul className="space-y-0.5 px-2 pb-2">
          {items.map((i, idx) => {
            const variant: 'destructive' | 'warning' | 'secondary' =
              i.severity === 'fatality' || i.severity === 'lost_time'
                ? 'destructive'
                : i.severity === 'medical_aid'
                  ? 'warning'
                  : 'secondary'
            return (
              <motion.li
                key={i.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 + idx * 0.04, duration: 0.3 }}
              >
                <Link
                  href={`/incidents/${i.id}` as any}
                  className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-900 group-hover:text-teal-700 dark:text-slate-100 dark:group-hover:text-teal-300">
                        {i.title}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-mono">{i.reference}</span>
                      <span className="mx-1.5 text-slate-300">·</span>
                      <span>{relativeTime(i.occurredAt)}</span>
                      <span className="mx-1.5 text-slate-300">·</span>
                      <span className="capitalize">{i.type.replace(/_/g, ' ')}</span>
                    </div>
                  </div>
                  <Badge variant={variant} className="shrink-0 capitalize">
                    {i.severity.replace(/_/g, ' ')}
                  </Badge>
                </Link>
              </motion.li>
            )
          })}
        </ul>
      )}
    </CardShell>
  )
}

function DueCAsList({ items, todayIso }: { items: DashboardMetrics['dueCAs']; todayIso: string }) {
  return (
    <CardShell
      title="Corrective actions due"
      caption="Next 5 by due date"
      icon={ListChecks}
      href="/corrective-actions"
      accent="amber"
    >
      {items.length === 0 ? (
        <EmptyRow>No open corrective actions.</EmptyRow>
      ) : (
        <ul className="space-y-0.5 px-2 pb-2">
          {items.map((c, idx) => {
            const aging = caAging(c.dueOn, todayIso)
            return (
              <motion.li
                key={c.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 + idx * 0.04, duration: 0.3 }}
              >
                <Link
                  href={`/corrective-actions/${c.id}` as any}
                  className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${aging.dotColor}`}
                        aria-hidden
                      />
                      <span className="truncate text-sm font-medium text-slate-900 group-hover:text-teal-700 dark:text-slate-100 dark:group-hover:text-teal-300">
                        {c.reference}
                      </span>
                      <span className="truncate text-sm text-slate-600 dark:text-slate-300">
                        — {c.title}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      Due {c.dueOn ?? '—'} · severity {c.severity}
                    </div>
                  </div>
                  <Badge variant={aging.badgeVariant} className="shrink-0">
                    {aging.label}
                  </Badge>
                </Link>
              </motion.li>
            )
          })}
        </ul>
      )}
    </CardShell>
  )
}

function OverdueCAsList({ items }: { items: DashboardMetrics['topOverdueCAs'] }) {
  return (
    <CardShell
      title="Most-overdue corrective actions"
      caption="Highest days past due"
      icon={Wrench}
      href="/corrective-actions/reports/overdue"
      accent="rose"
    >
      {items.length === 0 ? (
        <EmptyRow>
          <span className="inline-flex items-center gap-2">
            <ShieldCheck size={12} className="text-emerald-500" />
            Nothing overdue.
          </span>
        </EmptyRow>
      ) : (
        <ul className="space-y-0.5 px-2 pb-2">
          {items.map((c, idx) => (
            <motion.li
              key={c.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.06 + idx * 0.04, duration: 0.3 }}
            >
              <Link
                href={`/corrective-actions/${c.id}` as any}
                className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm font-medium text-slate-900 group-hover:text-teal-700 dark:text-slate-100 dark:group-hover:text-teal-300">
                    <span className="font-mono text-slate-500 dark:text-slate-400">
                      {c.reference}
                    </span>{' '}
                    <span>— {c.title}</span>
                  </span>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    Was due {c.dueOn ?? '—'}
                  </div>
                </div>
                <Badge variant="destructive" className="shrink-0 tabular-nums">
                  {c.daysOverdue}d
                </Badge>
              </Link>
            </motion.li>
          ))}
        </ul>
      )}
    </CardShell>
  )
}

function ExpiringTrainingList({
  items,
  todayIso,
}: {
  items: DashboardMetrics['expiringTraining30d']
  todayIso: string
}) {
  return (
    <CardShell
      title="Expiring training (30 days)"
      caption="Sorted by urgency"
      icon={GraduationCap}
      href="/training"
      accent="teal"
    >
      {items.length === 0 ? (
        <EmptyRow>No certs lapsing in the next 30 days.</EmptyRow>
      ) : (
        <ul className="space-y-0.5 px-2 pb-2">
          {items.slice(0, 6).map((row, idx) => {
            const days = daysBetween(todayIso, row.expiresOn)
            const tone = days <= 7 ? 'destructive' : days <= 14 ? 'warning' : 'secondary'
            return (
              <motion.li
                key={`${row.personId}-${row.expiresOn}-${row.courseName}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 + idx * 0.04, duration: 0.3 }}
              >
                <Link
                  href={`/people/${row.personId}` as any}
                  className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Calendar size={11} className="shrink-0 text-slate-400 dark:text-slate-500" />
                      <span className="truncate text-sm font-medium text-slate-900 group-hover:text-teal-700 dark:text-slate-100 dark:group-hover:text-teal-300">
                        {row.personName}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {row.courseName} · expires {row.expiresOn}
                    </div>
                  </div>
                  <Badge variant={tone} className="shrink-0 tabular-nums">
                    {days <= 0 ? 'today' : `${days}d`}
                  </Badge>
                </Link>
              </motion.li>
            )
          })}
        </ul>
      )}
    </CardShell>
  )
}

function InboxList({ items }: { items: DashboardMetrics['myInbox'] }) {
  return (
    <CardShell
      title="My inbox"
      caption={`${items.length} unread`}
      icon={Inbox}
      href="/notifications"
      accent="slate"
    >
      {items.length === 0 ? (
        <EmptyRow>
          <span className="inline-flex items-center gap-2">
            <Bell size={12} className="text-emerald-500" />
            No unread notifications.
          </span>
        </EmptyRow>
      ) : (
        <ul className="space-y-0.5 px-2 pb-2">
          {items.map((n, idx) => {
            const Inner = (
              <div className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                    <span className="truncate text-sm font-medium text-slate-900 group-hover:text-teal-700 dark:text-slate-100 dark:group-hover:text-teal-300">
                      {n.title}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {n.body ?? n.category}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
                  {relativeTime(n.occurredAt)}
                </span>
              </div>
            )
            return (
              <motion.li
                key={n.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 + idx * 0.04, duration: 0.3 }}
              >
                {n.linkPath ? <Link href={n.linkPath as any}>{Inner}</Link> : Inner}
              </motion.li>
            )
          })}
        </ul>
      )}
    </CardShell>
  )
}

// =====================================================================
// In progress — the current user's unfinished entries across modules,
// newest-touched first, each linking back to resume the work.
// =====================================================================

type InProgressKind = DashboardMetrics['inProgressEntries'][number]['kind']

const IN_PROGRESS_KIND: Record<InProgressKind, { label: string; icon: LucideIcon; badge: string }> =
  {
    journal: {
      label: 'Journal',
      icon: NotebookPen,
      badge:
        'bg-teal-50 text-teal-700 ring-teal-100 dark:bg-teal-950/50 dark:text-teal-300 dark:ring-teal-900/40',
    },
    hazard_assessment: {
      label: 'Hazard assessment',
      icon: ShieldAlert,
      badge:
        'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/40',
    },
    incident: {
      label: 'Incident',
      icon: AlertTriangle,
      badge:
        'bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/40',
    },
    inspection: {
      label: 'Inspection',
      icon: ClipboardCheck,
      badge:
        'bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-900/40',
    },
  }

function InProgressList({ items }: { items: DashboardMetrics['inProgressEntries'] }) {
  return (
    <CardShell
      title="In progress"
      caption={
        items.length === 0
          ? 'Pick up where you left off'
          : `${items.length} unfinished ${items.length === 1 ? 'entry' : 'entries'}`
      }
      icon={PencilLine}
      accent="amber"
    >
      {items.length === 0 ? (
        <EmptyRow>
          <span className="inline-flex items-center gap-2">
            <ShieldCheck size={12} className="text-emerald-500" />
            Nothing in progress — you’re all caught up.
          </span>
        </EmptyRow>
      ) : (
        <ul className="space-y-0.5 px-2 pb-2">
          {items.map((e, idx) => {
            const meta = IN_PROGRESS_KIND[e.kind]
            const Icon = meta.icon
            return (
              <motion.li
                key={`${e.kind}-${e.id}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 + idx * 0.04, duration: 0.3 }}
              >
                <Link
                  href={e.href as any}
                  className="group flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <span
                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${meta.badge}`}
                  >
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900 group-hover:text-teal-700 dark:text-slate-100 dark:group-hover:text-teal-300">
                      {e.title}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {meta.label} · {relativeTime(e.updatedAt)}
                    </div>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-slate-400 transition-colors group-hover:text-teal-600 dark:text-slate-500 dark:group-hover:text-teal-300">
                    Resume
                    <ArrowRight
                      size={12}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                </Link>
              </motion.li>
            )
          })}
        </ul>
      )}
    </CardShell>
  )
}

// =====================================================================
// Personal — My PPE / My equipment (gear issued/checked out to me, with a
// one-tap "Inspect" CTA) + My compliance (a drillable completion ring)
// =====================================================================

/** Small "Inspect" pill used by the My-PPE and My-equipment rows. */
function InspectButton({ href, tone = 'teal' }: { href: string; tone?: 'teal' | 'sky' }) {
  const cls =
    tone === 'sky'
      ? 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-900/50'
      : 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 dark:border-teal-800/60 dark:bg-teal-950/40 dark:text-teal-300 dark:hover:bg-teal-900/50'
  return (
    <Link
      href={href as any}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${cls}`}
    >
      <ClipboardCheck size={12} /> Inspect
    </Link>
  )
}

/** One-tap "Check in" (sign in) for a piece of equipment I'm holding. Posts the
 *  open checkout id to the shared server action; condition defaults to "good". */
function CheckInButton({ checkoutId }: { checkoutId: string }) {
  return (
    <form action={checkInEquipment} className="shrink-0">
      <input type="hidden" name="id" value={checkoutId} />
      <button
        type="submit"
        title="Check this item back in"
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
      >
        <LogIn size={12} /> Check in
      </button>
    </form>
  )
}

/** Badge for an inspection-due date: overdue (red) or due-within-7d (amber). */
function inspectDueBadge(dueIso: string | null, todayIso: string) {
  if (!dueIso) return null
  const days = daysBetween(todayIso, dueIso)
  if (days < 0)
    return (
      <Badge variant="destructive" className="shrink-0 tabular-nums">
        {Math.abs(days)}d overdue
      </Badge>
    )
  if (days <= 7)
    return (
      <Badge variant="warning" className="shrink-0 tabular-nums">
        {days === 0 ? 'due today' : `due ${days}d`}
      </Badge>
    )
  return null
}

function MyPpeCard({ items, todayIso }: { items: DashboardMetrics['myPpe']; todayIso: string }) {
  return (
    <CardShell
      title="My PPE"
      caption={items.length === 1 ? '1 item issued to you' : `${items.length} items issued to you`}
      icon={HardHat}
      href="/ppe"
      accent="teal"
    >
      {items.length === 0 ? (
        <EmptyRow>No PPE is currently issued to you.</EmptyRow>
      ) : (
        <ul className="space-y-0.5 px-2 pb-2">
          {items.map((p, idx) => {
            const due = p.nextInspectionDue
            const sub =
              [p.serialNumber, p.size, due ? `Inspection due ${due}` : 'No inspection scheduled']
                .filter(Boolean)
                .join(' · ') || '—'
            return (
              <motion.li
                key={p.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 + idx * 0.04, duration: 0.3 }}
                className="group flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-100 ring-inset dark:bg-teal-950/50 dark:text-teal-300 dark:ring-teal-900/40">
                  <HardHat size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/ppe/${p.id}` as any}
                      className="truncate text-sm font-medium text-slate-900 group-hover:text-teal-700 dark:text-slate-100 dark:group-hover:text-teal-300"
                    >
                      {p.typeName}
                    </Link>
                    {inspectDueBadge(due, todayIso)}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {sub}
                  </div>
                </div>
                <InspectButton
                  href={`/ppe/${p.id}?tab=inspections&drawer=record-inspection&kind=pre_use`}
                  tone="teal"
                />
              </motion.li>
            )
          })}
        </ul>
      )}
    </CardShell>
  )
}

function MyEquipmentCard({
  items,
  todayIso,
}: {
  items: DashboardMetrics['myEquipment']
  todayIso: string
}) {
  return (
    <CardShell
      title="My equipment"
      caption={
        items.length === 1
          ? '1 item checked out to you'
          : `${items.length} items checked out to you`
      }
      icon={Boxes}
      href="/equipment/check-out"
      hrefLabel="Check in / out"
      accent="sky"
    >
      {items.length === 0 ? (
        <EmptyRow>You have no equipment checked out.</EmptyRow>
      ) : (
        <ul className="space-y-0.5 px-2 pb-2">
          {items.map((e, idx) => {
            const due = e.requiresAnnualInspection ? e.nextAnnualInspectionDue : null
            const sub =
              [
                e.assetTag,
                e.typeName,
                e.expectedReturnOn
                  ? `Due back ${e.expectedReturnOn}`
                  : due
                    ? `Inspection due ${due}`
                    : null,
              ]
                .filter(Boolean)
                .join(' · ') || '—'
            return (
              <motion.li
                key={e.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 + idx * 0.04, duration: 0.3 }}
                className="group flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700 ring-1 ring-sky-100 ring-inset dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-900/40">
                  <Boxes size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/equipment/${e.id}` as any}
                      className="truncate text-sm font-medium text-slate-900 group-hover:text-sky-700 dark:text-slate-100 dark:group-hover:text-sky-300"
                    >
                      {e.name}
                    </Link>
                    {inspectDueBadge(due, todayIso)}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {sub}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <InspectButton
                    href={`/apps?category=inspection&sourceEntityType=equipment&sourceEntityId=${e.id}`}
                    tone="sky"
                  />
                  <CheckInButton checkoutId={e.checkoutId} />
                </div>
              </motion.li>
            )
          })}
        </ul>
      )}
    </CardShell>
  )
}

/** A completion ring: track + animated arc, colored by percent, % in the centre. */
function ComplianceRing({ percent }: { percent: number }) {
  const r = 30
  const circumference = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, percent))
  const offset = circumference * (1 - clamped / 100)
  const stroke = clamped >= 80 ? '#10b981' : clamped >= 50 ? '#f59e0b' : '#f43f5e'
  return (
    <div className="relative h-[76px] w-[76px] shrink-0">
      <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90">
        <circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          strokeWidth="7"
          className="stroke-slate-100 dark:stroke-slate-800"
        />
        <motion.circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          stroke={stroke}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <AnimatedNumber
          value={clamped}
          format={(v) => `${Math.round(v)}%`}
          className="text-lg font-semibold text-slate-900 tabular-nums dark:text-slate-100"
        />
      </div>
    </div>
  )
}

/** A clickable mini-stat tile inside the My-compliance card. */
function MiniStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'danger' | 'warning' | 'good' | 'normal'
}) {
  const valueClass =
    tone === 'danger'
      ? value > 0
        ? 'text-rose-700 dark:text-rose-400'
        : 'text-slate-400 dark:text-slate-500'
      : tone === 'warning'
        ? value > 0
          ? 'text-amber-700 dark:text-amber-400'
          : 'text-slate-400 dark:text-slate-500'
        : tone === 'good'
          ? 'text-emerald-700 dark:text-emerald-400'
          : 'text-slate-700 dark:text-slate-200'
  return (
    <Link
      href="/compliance/mine"
      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 transition-colors hover:border-teal-200 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-800/60 dark:hover:bg-slate-800/60"
    >
      <span className="text-[10px] font-semibold tracking-[0.1em] text-slate-500 uppercase dark:text-slate-400">
        {label}
      </span>
      <span className={`text-lg font-semibold tabular-nums ${valueClass}`}>{value}</span>
    </Link>
  )
}

function complianceStatusBadge(status: string) {
  if (status === 'overdue')
    return (
      <Badge variant="destructive" className="shrink-0">
        Overdue
      </Badge>
    )
  if (status === 'expiring')
    return (
      <Badge variant="warning" className="shrink-0">
        Due soon
      </Badge>
    )
  if (status === 'in_progress')
    return (
      <Badge variant="warning" className="shrink-0">
        In progress
      </Badge>
    )
  return (
    <Badge variant="secondary" className="shrink-0">
      Pending
    </Badge>
  )
}

function MyComplianceCard({ data }: { data: DashboardMetrics['myCompliance'] }) {
  if (!data.linked) {
    return (
      <CardShell
        title="My compliance"
        caption="Your obligations"
        icon={ShieldCheck}
        href="/compliance/mine"
        accent="teal"
      >
        <EmptyRow>Your account isn’t linked to a person record yet.</EmptyRow>
      </CardShell>
    )
  }
  if (data.total === 0) {
    return (
      <CardShell
        title="My compliance"
        caption="Your obligations"
        icon={ShieldCheck}
        href="/compliance/mine"
        accent="teal"
      >
        <EmptyRow>
          <span className="inline-flex items-center gap-2">
            <ShieldCheck size={12} className="text-emerald-500" />
            Nothing assigned — you’re all caught up.
          </span>
        </EmptyRow>
      </CardShell>
    )
  }
  return (
    <CardShell
      title="My compliance"
      caption={`${data.completed} of ${data.total} obligations complete`}
      icon={ShieldCheck}
      href="/compliance/mine"
      accent="teal"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-4 px-4 pt-3 pb-3">
          <ComplianceRing percent={data.percent ?? 0} />
          <div className="grid flex-1 grid-cols-2 gap-2">
            <MiniStat label="Overdue" value={data.overdue} tone="danger" />
            <MiniStat label="Due soon" value={data.dueSoon} tone="warning" />
            <MiniStat label="Pending" value={data.pending} tone="normal" />
            <MiniStat label="Completed" value={data.completed} tone="good" />
          </div>
        </div>
        {data.outstanding.length > 0 ? (
          <div className="border-t border-slate-100 px-2 pt-2 pb-2 dark:border-slate-800">
            <div className="px-2 pb-1 text-[10px] font-semibold tracking-[0.14em] text-slate-400 uppercase dark:text-slate-500">
              Outstanding
            </div>
            <ul className="space-y-0.5">
              {data.outstanding.map((o, idx) => (
                <motion.li
                  key={`${o.obligationId}-${idx}`}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.06 + idx * 0.04, duration: 0.3 }}
                >
                  <Link
                    href={o.href as never}
                    prefetch={o.prefetch}
                    className="group flex items-center justify-between gap-3 rounded-lg px-3 py-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900 group-hover:text-teal-700 dark:text-slate-100 dark:group-hover:text-teal-300">
                        {o.title}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-500 capitalize dark:text-slate-400">
                        {o.kind.replace(/_/g, ' ')}
                        {o.dueOn ? ` · due ${o.dueOn}` : ''}
                      </div>
                    </div>
                    {complianceStatusBadge(o.status)}
                  </Link>
                </motion.li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </CardShell>
  )
}

// =====================================================================
// Card shell — shared list/chart wrapper
// =====================================================================

function CardShell({
  title,
  caption,
  icon: Icon,
  href,
  hrefLabel = 'View all',
  accent = 'slate',
  children,
}: {
  title: string
  caption?: string
  icon?: LucideIcon
  href?: string
  hrefLabel?: string
  accent?: 'slate' | 'rose' | 'amber' | 'teal' | 'sky'
  children: React.ReactNode
}) {
  const iconAccent =
    accent === 'rose'
      ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 ring-rose-100'
      : accent === 'amber'
        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 ring-amber-100'
        : accent === 'teal'
          ? 'bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 ring-teal-100'
          : accent === 'sky'
            ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 ring-sky-100'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-slate-200'
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          {Icon ? (
            <span
              className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 ring-inset ${iconAccent}`}
            >
              <Icon size={14} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </h3>
            {caption ? (
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{caption}</p>
            ) : null}
          </div>
        </div>
        {href ? (
          <Link
            href={href as any}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-teal-700 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-teal-300"
          >
            {hrefLabel}
            <ArrowRight size={11} />
          </Link>
        ) : null}
      </div>
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
      {children}
    </div>
  )
}

// =====================================================================
// FitText — SVG-based auto-scaling text. Fills its container; viewBox
// math makes the glyph grow/shrink with the available space, so a card
// that gets resized on the grid keeps its big number perfectly fitted.
// =====================================================================

function FitText({ text, className = '' }: { text: string; className?: string }) {
  // viewBox is sized to the typical aspect of a 1–4 character number.
  // `preserveAspectRatio="xMidYMid meet"` keeps the text centered and
  // scaled-to-fit regardless of card aspect ratio.
  const len = Math.max(text.length, 1)
  // Heuristic char width at fontSize 80: ~48px per char. Choose viewBox
  // width so the text doesn't overflow horizontally at higher digit counts.
  const vbWidth = Math.max(120, len * 56)
  return (
    <svg
      role="img"
      aria-label={text}
      viewBox={`0 0 ${vbWidth} 100`}
      preserveAspectRatio="xMidYMid meet"
      className={`block h-full w-full ${className}`}
    >
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="80"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial"
        fill="currentColor"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {text}
      </text>
    </svg>
  )
}

// =====================================================================
// Format helpers
// =====================================================================

function fmtFixed2(v: number) {
  return v.toFixed(2)
}
function fmtInt(v: number) {
  return Math.round(v).toString()
}

function relativeTime(value: string | Date) {
  const then = typeof value === 'string' ? new Date(value) : value
  const now = Date.now()
  const diff = Math.round((now - then.getTime()) / 1000)
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 7 * 86_400) return `${Math.floor(diff / 86_400)}d ago`
  return then.toLocaleDateString()
}

function daysBetween(todayIso: string, targetIso: string) {
  const today = new Date(`${todayIso}T00:00:00Z`)
  const target = new Date(`${targetIso}T00:00:00Z`)
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000)
}

function caAging(
  dueOn: string | null,
  todayIso: string,
): {
  badgeVariant: 'destructive' | 'warning' | 'success' | 'secondary'
  label: string
  dotColor: string
} {
  if (!dueOn) {
    return { badgeVariant: 'secondary', label: 'no date', dotColor: 'bg-slate-300' }
  }
  const days = daysBetween(todayIso, dueOn)
  if (days < 0) {
    return {
      badgeVariant: 'destructive',
      label: `${Math.abs(days)}d overdue`,
      dotColor: 'bg-rose-500',
    }
  }
  if (days <= 7) {
    return { badgeVariant: 'success', label: `${days}d left`, dotColor: 'bg-emerald-500' }
  }
  if (days <= 30) {
    return { badgeVariant: 'warning', label: `${days}d left`, dotColor: 'bg-amber-500' }
  }
  return { badgeVariant: 'secondary', label: `${days}d left`, dotColor: 'bg-slate-400' }
}
