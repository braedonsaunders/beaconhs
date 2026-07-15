'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  Truck,
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

function quickActionsStateKey(actions: QuickAction[] | undefined): string {
  return actions ? JSON.stringify(actions) : 'default'
}

export function WidgetCard({ widgetId, data, todayIso, quickActions }: Props) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  switch (widgetId) {
    // KPIs — headline rates
    case 'kpi-trir':
      return (
        <RateTile
          label={tGenerated('m_0d45762c39e544')}
          href="/incidents"
          icon={ShieldAlert}
          value={data.trir.value}
          prevValue={data.trir.prevValue}
          formatFn={fmtFixed2}
          caption={tGenerated('m_055fd7bca1c19b', {
            value0: data.trir.recordableCount,
            value1: Math.round(data.trir.hoursWorked / 1000),
          })}
          trend={data.trir.trend}
          invertedDelta
          tooltip={tGenerated('m_0f5d32f2f7e0f9')}
        />
      )
    case 'kpi-dart':
      return (
        <RateTile
          label={tGenerated('m_1d26b7bff0a3d3')}
          href="/incidents"
          icon={Activity}
          value={data.dart.value}
          prevValue={data.dart.prevValue}
          formatFn={fmtFixed2}
          caption={tGenerated('m_07f1cf63d395ae', { value0: data.dart.dartCount })}
          trend={data.dart.trend}
          invertedDelta
          tooltip={tGenerated('m_0c433111f69eb6')}
        />
      )
    case 'kpi-training-compliance':
      return (
        <RateTile
          label={tGenerated('m_05cbc2207cd76c')}
          href="/training"
          icon={GraduationCap}
          value={data.trainingCompliancePct}
          prevValue={null}
          formatFn={fmtInt}
          suffix="%"
          caption={tGenerated('m_01652b39d145b3', {
            value0: data.trainingComplianceCounts.completed,
            value1: data.trainingComplianceCounts.total,
          })}
          trend={data.trainingComplianceTrend}
        />
      )
    case 'kpi-document-compliance':
      return (
        <RateTile
          label={tGenerated('m_0ad244f12439b6')}
          href="/documents"
          icon={FileCheck}
          value={data.documentCompliancePct}
          prevValue={null}
          formatFn={fmtInt}
          suffix="%"
          caption={tGenerated('m_06d8b53b722ec2', {
            value0: data.documentComplianceCounts.acknowledged,
            value1: data.documentComplianceCounts.expected,
          })}
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
          label={tGenerated('m_1f9f8524fae63f')}
          value={data.openCAs}
          href="/corrective-actions"
          icon={ListChecks}
          caption={tGeneratedValue(
            data.overdueCAs > 0
              ? tGenerated('m_179671b490c15a', { value0: data.overdueCAs })
              : data.openCAs > 0
                ? tGenerated('m_1eeab2d8a3635f')
                : tGenerated('m_0b5b0955cda560'),
          )}
          tone={data.overdueCAs > 0 ? 'warning' : 'normal'}
        />
      )
    case 'kpi-overdue-cas':
      return (
        <CountTile
          label={tGenerated('m_0bc2f15241e6f5')}
          value={data.overdueCAs}
          href="/corrective-actions/reports/overdue"
          icon={CalendarClock}
          caption={tGeneratedValue(
            data.overdueCAs > 0 ? tGenerated('m_1f510063895c0f') : tGenerated('m_054dabc81ee6e5'),
          )}
          tone={data.overdueCAs > 0 ? 'danger' : 'normal'}
        />
      )
    case 'kpi-incidents-30d': {
      const delta = data.incidents30 - data.incidentsPrev30
      return (
        <CountTile
          label={tGenerated('m_0a2a9c112119a8')}
          value={data.incidents30}
          href="/incidents"
          icon={AlertTriangle}
          caption={tGeneratedValue(
            delta === 0
              ? tGenerated('m_0867437d4676fb')
              : tGenerated('m_01a70aa1a0433f', { value0: delta > 0 ? '+' : '', value1: delta }),
          )}
          tone={delta > 0 ? 'warning' : 'normal'}
        />
      )
    }
    case 'kpi-expiring-certs':
      return (
        <CountTile
          label={tGenerated('m_1c89b535d986cd')}
          value={data.expiringCertsCount}
          href="/training"
          icon={GraduationCap}
          caption={tGeneratedValue(
            data.expiringCertsCount > 0
              ? tGenerated('m_0893f11c1af9fa')
              : tGenerated('m_0f68d1c00403e1'),
          )}
          tone={data.expiringCertsCount > 0 ? 'warning' : 'normal'}
        />
      )
    case 'kpi-ppe-open-issues':
      return (
        <CountTile
          label={tGenerated('m_05d7818a6c2fdf')}
          value={data.ppeOpenIssues}
          href="/ppe"
          icon={HardHat}
          caption={tGeneratedValue(
            data.ppeOpenIssues > 0
              ? tGenerated('m_00bcb6677a026d')
              : tGenerated('m_054dabc81ee6e5'),
          )}
          tone={data.ppeOpenIssues > 0 ? 'warning' : 'normal'}
        />
      )
    case 'kpi-ppe-overdue':
      return (
        <CountTile
          label={tGenerated('m_1c0bf5ccbfdc62')}
          value={data.ppeInspectionsOverdue}
          href="/ppe"
          icon={HardHat}
          caption={tGeneratedValue(
            data.ppeInspectionsOverdue > 0
              ? tGenerated('m_0b13a5c5283310')
              : tGenerated('m_0f68d1c00403e1'),
          )}
          tone={data.ppeInspectionsOverdue > 0 ? 'danger' : 'normal'}
        />
      )
    case 'kpi-people-active':
      return (
        <CountTile
          label={tGenerated('m_047f18c682cef5')}
          value={data.peopleCount}
          href="/people"
          icon={Users}
          caption={tGenerated('m_02a792845edfb3')}
          tone="normal"
        />
      )

    // Operational status
    case 'op-lone-worker-active':
      return (
        <CountTile
          label={tGenerated('m_163e07fa713535')}
          value={data.lwActive}
          href="/apps/sessions"
          icon={Radio}
          caption={tGeneratedValue(
            data.lwActive > 0 ? tGenerated('m_09630c4cb6c820') : tGenerated('m_184c0ee5147b97'),
          )}
          tone={data.lwActive > 0 ? 'warning' : 'normal'}
        />
      )
    case 'op-submissions-today':
      return (
        <CountTile
          label={tGenerated('m_1c2acd0e96284e')}
          value={data.submissionsToday}
          href="/apps/responses"
          icon={ClipboardList}
          caption={tGenerated('m_09e635d5d70b6e')}
          tone="normal"
        />
      )
    case 'op-inspections-mtd':
      return (
        <CountTile
          label={tGenerated('m_12175d61ffc6cc')}
          value={data.inspectionsThisMonth}
          href="/inspections"
          icon={ClipboardCheck}
          caption={tGenerated('m_11dd31df25a94c')}
          tone="normal"
        />
      )
    case 'equipment-vehicle-log-status':
      return <VehicleLogStatusCard status={data.vehicleLogStatus} />

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
      return <QuickActions key={quickActionsStateKey(quickActions)} actions={quickActions} />

    default:
      return (
        <CardShell
          title={tGenerated('m_018b7421ec38a5', { value0: widgetId })}
          icon={AlertTriangle}
        >
          <EmptyRow>
            <GeneratedText id="m_1d6b2a134f6f3b" />
          </EmptyRow>
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
      // The whole tile is an anchor; without this the browser's native link
      // drag fires alongside the grid's pointer drag — janky movement and a
      // ghost left behind. Disabling native drag leaves only the grid's drag.
      draggable={false}
      className="group relative flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-teal-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-800/60"
    >
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase dark:text-slate-400">
          <GeneratedValue value={label} />
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
        <span className={`text-[11px] ${captionClass}`}>
          <GeneratedValue value={caption} />
        </span>
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
  const tGeneratedValue = useGeneratedValueTranslations()
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
      title={tGeneratedValue(tooltip)}
      // See CountTile: stop the browser's native anchor drag fighting the grid.
      draggable={false}
      className="group relative flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-teal-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-800/60"
    >
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase dark:text-slate-400">
          <GeneratedValue value={label} />
        </span>
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 ring-1 ring-slate-100 ring-inset dark:bg-slate-800 dark:text-slate-300">
          <Icon size={14} />
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <GeneratedValue
          value={
            hasValue ? (
              <>
                <AnimatedNumber
                  value={value!}
                  format={formatFn}
                  className="text-4xl leading-none font-semibold text-slate-900 tabular-nums dark:text-slate-100"
                />
                <GeneratedValue
                  value={
                    suffix ? (
                      <span className="text-xl font-semibold text-slate-500 dark:text-slate-400">
                        <GeneratedValue value={suffix} />
                      </span>
                    ) : null
                  }
                />
              </>
            ) : (
              <span className="text-4xl leading-none font-semibold text-slate-400 tabular-nums dark:text-slate-500">
                —
              </span>
            )
          }
        />
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums ${deltaTone}`}
        >
          <DeltaIcon size={11} />
          <GeneratedValue
            value={
              delta === null ? (
                <GeneratedText id="m_078102f1e736d0" />
              ) : (
                `${delta > 0 ? '+' : ''}${formatFn(Math.abs(delta))}`
              )
            }
          />
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
      <p className="mt-1.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
        <GeneratedValue value={caption} />
      </p>
    </Link>
  )
}

function DaysSinceCard({ days, lastDate }: { days: number | null; lastDate: Date | null }) {
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
          <GeneratedText id="m_0b57b9eeae6e68" />
        </div>
        <div className="my-auto flex min-h-0 flex-1 flex-col items-center justify-center text-center">
          <GeneratedValue
            value={
              days === null ? (
                <FitText text="—" className="text-white" />
              ) : (
                <>
                  <FitText text={display} className="text-white" />
                  <div className="mt-1 text-[11px] tracking-[0.14em] text-white/60 uppercase">
                    <GeneratedText id="m_169a4282447292" />
                  </div>
                </>
              )
            }
          />
        </div>
        <div className="text-center text-[11px] text-white/70">
          <GeneratedValue
            value={
              lastDate ? (
                <GeneratedText
                  id="m_14a1b4b1f894d3"
                  values={{ value0: lastDate.toLocaleDateString() }}
                />
              ) : (
                <GeneratedText id="m_09bac45ee6c706" />
              )
            }
          />
        </div>
      </div>
    </div>
  )
}

function VehicleLogStatusCard({ status }: { status: DashboardMetrics['vehicleLogStatus'] }) {
  const tGenerated = useGeneratedTranslations()
  const attention = status.conflictDays > 0
  const importedPct =
    status.loggedDays > 0 ? Math.round((status.importedDays / status.loggedDays) * 100) : 0
  return (
    <CardShell
      title={tGenerated('m_0dd42a0cc0e7d6')}
      caption={tGenerated('m_15e68d98e1295b')}
      icon={Truck}
      href="/equipment/vehicle-log"
      hrefLabel="Open"
      accent={attention ? 'amber' : 'teal'}
    >
      <div className="flex h-full min-h-0 flex-col px-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase dark:text-slate-400">
              <GeneratedText id="m_1b45a6513ebcf9" />
            </div>
            <div className="mt-1 text-3xl leading-none font-semibold text-slate-900 tabular-nums dark:text-slate-100">
              <AnimatedNumber value={status.loggedDays} format={(v) => Math.round(v).toString()} />
            </div>
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              <GeneratedText id="m_03f27f3873543c" />
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase dark:text-slate-400">
              <GeneratedText id="m_1f2a32fa01df75" />
            </div>
            <div className="mt-1 text-3xl leading-none font-semibold text-slate-900 tabular-nums dark:text-slate-100">
              <AnimatedNumber value={status.totalKm} format={(v) => Math.round(v).toString()} />
            </div>
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              <GeneratedText id="m_052eec8e5ae8ca" />
            </div>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
            <span>
              <GeneratedText id="m_14eff3d9663652" />
            </span>
            <span className="font-semibold tabular-nums">
              <GeneratedValue value={importedPct} />%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${importedPct}%` }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              className="h-full rounded-full bg-teal-600"
            />
          </div>
        </div>

        <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
          <StatusPill
            label={tGenerated('m_085dfb867cb530')}
            value={status.importedDays}
            tone="good"
          />
          <StatusPill
            label={tGenerated('m_150f3323f60d00')}
            value={status.conflictDays}
            tone={status.conflictDays > 0 ? 'warn' : 'quiet'}
          />
        </div>
      </div>
    </CardShell>
  )
}

function StatusPill({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'good' | 'warn' | 'quiet'
}) {
  const toneClass =
    tone === 'good'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
        : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400'
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${toneClass}`}>
      <div className="text-lg leading-none font-semibold tabular-nums">
        <GeneratedValue value={value} />
      </div>
      <div className="mt-0.5 truncate text-[10px] font-medium">
        <GeneratedValue value={label} />
      </div>
    </div>
  )
}

// =====================================================================
// Charts — pyramid, capa aging, top sites
// =====================================================================

function SeverityPyramid({ dist }: { dist: DashboardMetrics['severityDistribution'] }) {
  const tGenerated = useGeneratedTranslations()
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
      title={tGenerated('m_04a4ea047a2b41')}
      caption={tGenerated('m_090a2cb042719f')}
      icon={TrendingDown}
      href="/incidents"
      accent="rose"
    >
      <ul className="space-y-1.5 px-4 pt-1 pb-3">
        <GeneratedValue
          value={rows.map((r, idx) => {
            const pct = (r.count / max) * 100
            return (
              <motion.li
                key={r.key}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 + idx * 0.05, duration: 0.32 }}
                className="grid grid-cols-[110px_1fr_44px] items-center gap-3 text-xs"
              >
                <span className="truncate text-slate-700 dark:text-slate-200">
                  <GeneratedValue value={r.label} />
                </span>
                <div className="relative h-5 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(pct, r.count > 0 ? 6 : 0)}%` }}
                    transition={{
                      delay: 0.1 + idx * 0.06,
                      duration: 0.6,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className={`h-full rounded-md ${r.tone}`}
                  />
                </div>
                <span className="text-right text-xs font-semibold text-slate-700 tabular-nums dark:text-slate-200">
                  <GeneratedValue value={r.count} />
                </span>
              </motion.li>
            )
          })}
        />
      </ul>
    </CardShell>
  )
}

function CapaAgingChart({ buckets }: { buckets: DashboardMetrics['openCABuckets'] }) {
  const tGenerated = useGeneratedTranslations()
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
      title={tGenerated('m_0503658aab9fc3')}
      caption={tGenerated('m_08b1947800327a', {
        value0: total,
        value1: rows.filter((r) => r.count > 0).length || 0,
      })}
      icon={ListChecks}
      href="/corrective-actions"
      accent="amber"
    >
      <div className="space-y-2 px-4 pt-1 pb-3">
        <GeneratedValue
          value={rows.map((r, idx) => {
            const pct = (r.count / max) * 100
            return (
              <motion.div
                key={r.key}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.06 + idx * 0.05, duration: 0.3 }}
              >
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                  <span>
                    <GeneratedValue value={r.label} />
                  </span>
                  <span className="font-semibold text-slate-700 tabular-nums dark:text-slate-200">
                    <GeneratedValue value={r.count} />
                  </span>
                </div>
                <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(pct, r.count > 0 ? 6 : 0)}%` }}
                    transition={{
                      delay: 0.1 + idx * 0.06,
                      duration: 0.55,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className={`h-full rounded-full ${r.tone}`}
                  />
                </div>
              </motion.div>
            )
          })}
        />
      </div>
    </CardShell>
  )
}

function TopSitesChart({ items }: { items: DashboardMetrics['topSitesByIncidents'] }) {
  const tGenerated = useGeneratedTranslations()
  const max = items.reduce((m, s) => Math.max(m, s.incidents), 0) || 1
  return (
    <CardShell
      title={tGenerated('m_04801e1e0d785c')}
      caption={tGenerated('m_18290f1ff4d4b1')}
      icon={MapPin}
      href="/incidents"
      accent="sky"
    >
      <GeneratedValue
        value={
          items.length === 0 ? (
            <EmptyRow>
              <GeneratedText id="m_0dd8a9acbd26f4" />
            </EmptyRow>
          ) : (
            <ul className="space-y-1.5 px-4 py-2">
              <GeneratedValue
                value={items.map((s, idx) => {
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
                            <GeneratedValue value={idx + 1} />
                          </span>
                          <span className="truncate font-medium text-slate-800 dark:text-slate-100">
                            <GeneratedValue value={s.siteName} />
                          </span>
                        </div>
                        <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 tabular-nums dark:bg-rose-950/40">
                          <GeneratedValue value={s.incidents} />
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
              />
            </ul>
          )
        }
      />
    </CardShell>
  )
}

// =====================================================================
// List widgets
// =====================================================================

function RecentIncidentsList({ items }: { items: DashboardMetrics['recentIncidents'] }) {
  const tGenerated = useGeneratedTranslations()
  return (
    <CardShell
      title={tGenerated('m_080a08e25fba42')}
      caption={tGenerated('m_0684072fc97130')}
      icon={AlertTriangle}
      href="/incidents"
      accent="rose"
    >
      <GeneratedValue
        value={
          items.length === 0 ? (
            <EmptyRow>
              <GeneratedText id="m_01bc23086e3428" />
            </EmptyRow>
          ) : (
            <ul className="space-y-0.5 px-2 pb-2">
              <GeneratedValue
                value={items.map((i, idx) => {
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
                              <GeneratedValue value={i.title} />
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="font-mono">
                              <GeneratedValue value={i.reference} />
                            </span>
                            <span className="mx-1.5 text-slate-300">·</span>
                            <span>
                              <GeneratedValue value={relativeTime(i.occurredAt)} />
                            </span>
                            <span className="mx-1.5 text-slate-300">·</span>
                            <span className="capitalize">
                              <GeneratedValue value={i.type.replace(/_/g, ' ')} />
                            </span>
                          </div>
                        </div>
                        <Badge variant={variant} className="shrink-0 capitalize">
                          <GeneratedValue value={i.severity.replace(/_/g, ' ')} />
                        </Badge>
                      </Link>
                    </motion.li>
                  )
                })}
              />
            </ul>
          )
        }
      />
    </CardShell>
  )
}

function DueCAsList({ items, todayIso }: { items: DashboardMetrics['dueCAs']; todayIso: string }) {
  const tGenerated = useGeneratedTranslations()
  return (
    <CardShell
      title={tGenerated('m_01ccf638f5ee20')}
      caption={tGenerated('m_1f2cad59293594')}
      icon={ListChecks}
      href="/corrective-actions"
      accent="amber"
    >
      <GeneratedValue
        value={
          items.length === 0 ? (
            <EmptyRow>
              <GeneratedText id="m_0055faa30abf01" />
            </EmptyRow>
          ) : (
            <ul className="space-y-0.5 px-2 pb-2">
              <GeneratedValue
                value={items.map((c, idx) => {
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
                              <GeneratedValue value={c.reference} />
                            </span>
                            <span className="truncate text-sm text-slate-600 dark:text-slate-300">
                              — <GeneratedValue value={c.title} />
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            <GeneratedText id="m_0c2eb92551e08b" />{' '}
                            <GeneratedValue value={c.dueOn ?? '—'} />{' '}
                            <GeneratedText id="m_1f66e3aa0a8bab" />{' '}
                            <GeneratedValue value={c.severity} />
                          </div>
                        </div>
                        <Badge variant={aging.badgeVariant} className="shrink-0">
                          <GeneratedValue value={aging.label} />
                        </Badge>
                      </Link>
                    </motion.li>
                  )
                })}
              />
            </ul>
          )
        }
      />
    </CardShell>
  )
}

function OverdueCAsList({ items }: { items: DashboardMetrics['topOverdueCAs'] }) {
  const tGenerated = useGeneratedTranslations()
  return (
    <CardShell
      title={tGenerated('m_147adf1dbaee7a')}
      caption={tGenerated('m_1293a536db52a2')}
      icon={Wrench}
      href="/corrective-actions/reports/overdue"
      accent="rose"
    >
      <GeneratedValue
        value={
          items.length === 0 ? (
            <EmptyRow>
              <span className="inline-flex items-center gap-2">
                <ShieldCheck size={12} className="text-emerald-500" />
                <GeneratedText id="m_1b0ae77adefa81" />
              </span>
            </EmptyRow>
          ) : (
            <ul className="space-y-0.5 px-2 pb-2">
              <GeneratedValue
                value={items.map((c, idx) => (
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
                            <GeneratedValue value={c.reference} />
                          </span>
                          <GeneratedValue value={' '} />
                          <span>
                            — <GeneratedValue value={c.title} />
                          </span>
                        </span>
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          <GeneratedText id="m_143354cf773624" />{' '}
                          <GeneratedValue value={c.dueOn ?? '—'} />
                        </div>
                      </div>
                      <Badge variant="destructive" className="shrink-0 tabular-nums">
                        <GeneratedValue value={c.daysOverdue} />
                        <GeneratedText id="m_113dda91012a7a" />
                      </Badge>
                    </Link>
                  </motion.li>
                ))}
              />
            </ul>
          )
        }
      />
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
  const tGenerated = useGeneratedTranslations()
  return (
    <CardShell
      title={tGenerated('m_07be9c20aa1d31')}
      caption={tGenerated('m_1973358bcbd220')}
      icon={GraduationCap}
      href="/training"
      accent="teal"
    >
      <GeneratedValue
        value={
          items.length === 0 ? (
            <EmptyRow>
              <GeneratedText id="m_146636d4ecfa26" />
            </EmptyRow>
          ) : (
            <ul className="space-y-0.5 px-2 pb-2">
              <GeneratedValue
                value={items.slice(0, 6).map((row, idx) => {
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
                            <Calendar
                              size={11}
                              className="shrink-0 text-slate-400 dark:text-slate-500"
                            />
                            <span className="truncate text-sm font-medium text-slate-900 group-hover:text-teal-700 dark:text-slate-100 dark:group-hover:text-teal-300">
                              <GeneratedValue value={row.personName} />
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                            <GeneratedValue value={row.courseName} />{' '}
                            <GeneratedText id="m_162a8fc4149d4b" />{' '}
                            <GeneratedValue value={row.expiresOn} />
                          </div>
                        </div>
                        <Badge variant={tone} className="shrink-0 tabular-nums">
                          <GeneratedValue
                            value={
                              days <= 0 ? (
                                <GeneratedText id="m_1e6258434de43f" />
                              ) : (
                                <GeneratedText id="m_144bd4e23f1233" values={{ value0: days }} />
                              )
                            }
                          />
                        </Badge>
                      </Link>
                    </motion.li>
                  )
                })}
              />
            </ul>
          )
        }
      />
    </CardShell>
  )
}

function InboxList({ items }: { items: DashboardMetrics['myInbox'] }) {
  const tGenerated = useGeneratedTranslations()
  return (
    <CardShell
      title={tGenerated('m_06a1c179ff108f')}
      caption={tGenerated('m_114d0c7b1d07a6', { value0: items.length })}
      icon={Inbox}
      href="/notifications"
      accent="slate"
    >
      <GeneratedValue
        value={
          items.length === 0 ? (
            <EmptyRow>
              <span className="inline-flex items-center gap-2">
                <Bell size={12} className="text-emerald-500" />
                <GeneratedText id="m_1cb2a39879b169" />
              </span>
            </EmptyRow>
          ) : (
            <ul className="space-y-0.5 px-2 pb-2">
              <GeneratedValue
                value={items.map((n, idx) => {
                  const Inner = (
                    <div className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                          <span className="truncate text-sm font-medium text-slate-900 group-hover:text-teal-700 dark:text-slate-100 dark:group-hover:text-teal-300">
                            <GeneratedValue value={n.title} />
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                          <GeneratedValue value={n.body ?? n.category} />
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
                        <GeneratedValue value={relativeTime(n.occurredAt)} />
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
                      <GeneratedValue
                        value={
                          n.linkPath ? (
                            <Link href={n.linkPath as any}>
                              <GeneratedValue value={Inner} />
                            </Link>
                          ) : (
                            Inner
                          )
                        }
                      />
                    </motion.li>
                  )
                })}
              />
            </ul>
          )
        }
      />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  return (
    <CardShell
      title={tGenerated('m_1a03b06872ffd9')}
      caption={tGeneratedValue(
        items.length === 0
          ? tGenerated('m_039d0028463c0a')
          : tGenerated('m_095f773e1d8cad', {
              value0: items.length,
              value1: items.length === 1 ? 'entry' : 'entries',
            }),
      )}
      icon={PencilLine}
      accent="amber"
    >
      <GeneratedValue
        value={
          items.length === 0 ? (
            <EmptyRow>
              <span className="inline-flex items-center gap-2">
                <ShieldCheck size={12} className="text-emerald-500" />
                <GeneratedText id="m_036195639dba02" />
              </span>
            </EmptyRow>
          ) : (
            <ul className="space-y-0.5 px-2 pb-2">
              <GeneratedValue
                value={items.map((e, idx) => {
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
                            <GeneratedValue value={e.title} />
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                            <GeneratedValue value={meta.label} /> ·{' '}
                            <GeneratedValue value={relativeTime(e.updatedAt)} />
                          </div>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-slate-400 transition-colors group-hover:text-teal-600 dark:text-slate-500 dark:group-hover:text-teal-300">
                          <GeneratedText id="m_0607d4d4be574c" />
                          <ArrowRight
                            size={12}
                            className="transition-transform group-hover:translate-x-0.5"
                          />
                        </span>
                      </Link>
                    </motion.li>
                  )
                })}
              />
            </ul>
          )
        }
      />
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
      <ClipboardCheck size={12} /> <GeneratedText id="m_1282216b6c0ab5" />
    </Link>
  )
}

/** One-tap "Check in" (sign in) for a piece of equipment I'm holding. Posts the
 *  open checkout id to the shared server action; condition defaults to "good". */
function CheckInButton({ checkoutId }: { checkoutId: string }) {
  const tGenerated = useGeneratedTranslations()
  return (
    <form action={checkInEquipment} className="shrink-0">
      <input type="hidden" name="id" value={checkoutId} />
      <button
        type="submit"
        title={tGenerated('m_0a40f4e1e428fa')}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
      >
        <LogIn size={12} /> <GeneratedText id="m_1aa025f1523915" />
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
        <GeneratedValue value={Math.abs(days)} />
        <GeneratedText id="m_007315fa300327" />
      </Badge>
    )
  if (days <= 7)
    return (
      <Badge variant="warning" className="shrink-0 tabular-nums">
        <GeneratedValue
          value={
            days === 0 ? (
              <GeneratedText id="m_050cf80aa34145" />
            ) : (
              <GeneratedText id="m_0edb47a4dacf1c" values={{ value0: days }} />
            )
          }
        />
      </Badge>
    )
  return null
}

function MyPpeCard({ items, todayIso }: { items: DashboardMetrics['myPpe']; todayIso: string }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  return (
    <CardShell
      title={tGenerated('m_1dc869deae5302')}
      caption={tGeneratedValue(
        items.length === 1
          ? tGenerated('m_1746cab06519e3')
          : tGenerated('m_0df35f9d91b038', { value0: items.length }),
      )}
      icon={HardHat}
      href="/ppe"
      accent="teal"
    >
      <GeneratedValue
        value={
          items.length === 0 ? (
            <EmptyRow>
              <GeneratedText id="m_006251fd870c40" />
            </EmptyRow>
          ) : (
            <ul className="space-y-0.5 px-2 pb-2">
              <GeneratedValue
                value={items.map((p, idx) => {
                  const due = p.nextInspectionDue
                  const sub =
                    [
                      p.serialNumber,
                      p.size,
                      due ? `Inspection due ${due}` : 'No inspection scheduled',
                    ]
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
                            <GeneratedValue value={p.typeName} />
                          </Link>
                          <GeneratedValue value={inspectDueBadge(due, todayIso)} />
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                          <GeneratedValue value={sub} />
                        </div>
                      </div>
                      <InspectButton
                        href={`/ppe/${p.id}?tab=inspections&drawer=record-inspection&kind=pre_use`}
                        tone="teal"
                      />
                    </motion.li>
                  )
                })}
              />
            </ul>
          )
        }
      />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  return (
    <CardShell
      title={tGenerated('m_0a672d96d7d79b')}
      caption={tGeneratedValue(
        items.length === 1
          ? tGenerated('m_188b7e1fb08d75')
          : tGenerated('m_057625dcf80ad9', { value0: items.length }),
      )}
      icon={Boxes}
      href="/equipment/station"
      hrefLabel="Check in / out"
      accent="sky"
    >
      <GeneratedValue
        value={
          items.length === 0 ? (
            <EmptyRow>
              <GeneratedText id="m_1ed44dbc68ec2a" />
            </EmptyRow>
          ) : (
            <ul className="space-y-0.5 px-2 pb-2">
              <GeneratedValue
                value={items.map((e, idx) => {
                  const due = e.nextInspectionDue
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
                            <GeneratedValue value={e.name} />
                          </Link>
                          <GeneratedValue value={inspectDueBadge(due, todayIso)} />
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                          <GeneratedValue value={sub} />
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <InspectButton
                          href={`/equipment/inspections/new?itemId=${e.id}`}
                          tone="sky"
                        />
                        <CheckInButton checkoutId={e.checkoutId} />
                      </div>
                    </motion.li>
                  )
                })}
              />
            </ul>
          )
        }
      />
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
        <GeneratedValue value={label} />
      </span>
      <span className={`text-lg font-semibold tabular-nums ${valueClass}`}>
        <GeneratedValue value={value} />
      </span>
    </Link>
  )
}

function complianceStatusBadge(status: string) {
  if (status === 'overdue')
    return (
      <Badge variant="destructive" className="shrink-0">
        <GeneratedText id="m_1e40bdcf2d1ba1" />
      </Badge>
    )
  if (status === 'expiring')
    return (
      <Badge variant="warning" className="shrink-0">
        <GeneratedText id="m_0971fcc40acc3d" />
      </Badge>
    )
  if (status === 'in_progress')
    return (
      <Badge variant="warning" className="shrink-0">
        <GeneratedText id="m_1a03b06872ffd9" />
      </Badge>
    )
  return (
    <Badge variant="secondary" className="shrink-0">
      <GeneratedText id="m_131b7246255b65" />
    </Badge>
  )
}

function MyComplianceCard({ data }: { data: DashboardMetrics['myCompliance'] }) {
  const tGenerated = useGeneratedTranslations()
  if (!data.linked) {
    return (
      <CardShell
        title={tGenerated('m_0b431c25bd1c60')}
        caption={tGenerated('m_0943eff3bb5805')}
        icon={ShieldCheck}
        href="/compliance/mine"
        accent="teal"
      >
        <EmptyRow>
          <GeneratedText id="m_1fd21fce3080fd" />
        </EmptyRow>
      </CardShell>
    )
  }
  if (data.total === 0) {
    return (
      <CardShell
        title={tGenerated('m_0b431c25bd1c60')}
        caption={tGenerated('m_0943eff3bb5805')}
        icon={ShieldCheck}
        href="/compliance/mine"
        accent="teal"
      >
        <EmptyRow>
          <span className="inline-flex items-center gap-2">
            <ShieldCheck size={12} className="text-emerald-500" />
            <GeneratedText id="m_15657905717ca3" />
          </span>
        </EmptyRow>
      </CardShell>
    )
  }
  return (
    <CardShell
      title={tGenerated('m_0b431c25bd1c60')}
      caption={tGenerated('m_150711fb1e048e', { value0: data.completed, value1: data.total })}
      icon={ShieldCheck}
      href="/compliance/mine"
      accent="teal"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-4 px-4 pt-3 pb-3">
          <ComplianceRing percent={data.percent ?? 0} />
          <div className="grid flex-1 grid-cols-2 gap-2">
            <MiniStat label={tGenerated('m_1e40bdcf2d1ba1')} value={data.overdue} tone="danger" />
            <MiniStat label={tGenerated('m_0971fcc40acc3d')} value={data.dueSoon} tone="warning" />
            <MiniStat label={tGenerated('m_131b7246255b65')} value={data.pending} tone="normal" />
            <MiniStat label={tGenerated('m_0ba7a5e1b2fa32')} value={data.completed} tone="good" />
          </div>
        </div>
        <GeneratedValue
          value={
            data.outstanding.length > 0 ? (
              <div className="border-t border-slate-100 px-2 pt-2 pb-2 dark:border-slate-800">
                <div className="px-2 pb-1 text-[10px] font-semibold tracking-[0.14em] text-slate-400 uppercase dark:text-slate-500">
                  <GeneratedText id="m_1874cfa97860c2" />
                </div>
                <ul className="space-y-0.5">
                  <GeneratedValue
                    value={data.outstanding.map((o, idx) => (
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
                              <GeneratedValue value={o.title} />
                            </div>
                            <div className="mt-0.5 truncate text-[11px] text-slate-500 capitalize dark:text-slate-400">
                              <GeneratedValue value={o.kind.replace(/_/g, ' ')} />
                              <GeneratedValue
                                value={
                                  o.dueOn ? (
                                    <GeneratedText
                                      id="m_0530312e93a8c8"
                                      values={{ value0: o.dueOn }}
                                    />
                                  ) : (
                                    ''
                                  )
                                }
                              />
                            </div>
                          </div>
                          <GeneratedValue value={complianceStatusBadge(o.status)} />
                        </Link>
                      </motion.li>
                    ))}
                  />
                </ul>
              </div>
            ) : null
          }
        />
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
          <GeneratedValue
            value={
              Icon ? (
                <span
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 ring-inset ${iconAccent}`}
                >
                  <Icon size={14} />
                </span>
              ) : null
            }
          />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              <GeneratedValue value={title} />
            </h3>
            <GeneratedValue
              value={
                caption ? (
                  <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                    <GeneratedValue value={caption} />
                  </p>
                ) : null
              }
            />
          </div>
        </div>
        <GeneratedValue
          value={
            href ? (
              <Link
                href={href as any}
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-teal-700 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-teal-300"
              >
                <GeneratedValue value={hrefLabel} />
                <ArrowRight size={11} />
              </Link>
            ) : null
          }
        />
      </div>
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
        <GeneratedValue value={children} />
      </div>
    </div>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
      <GeneratedValue value={children} />
    </div>
  )
}

// =====================================================================
// FitText — SVG-based auto-scaling text. Fills its container; viewBox
// math makes the glyph grow/shrink with the available space, so a card
// that gets resized on the grid keeps its big number perfectly fitted.
// =====================================================================

function FitText({ text, className = '' }: { text: string; className?: string }) {
  const tGeneratedValue = useGeneratedValueTranslations()
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
      aria-label={tGeneratedValue(text)}
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
        <GeneratedValue value={text} />
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
