import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  GraduationCap,
  HardHat,
  ListChecks,
  Radio,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadDashboardMetrics } from './_metrics'
import { Hero, type HeroTileData } from './_hero'
import { QuickActions } from './_quick-actions'
import { KpiStrip, type KpiTileData } from './_kpi-strip'
import { MotionSection } from './_motion-section'
import {
  DueCAsWidget,
  ExpiringTrainingWidget,
  InboxWidget,
  OverdueCAsWidget,
  RecentIncidentsWidget,
  TopSitesWidget,
} from './_widgets'

export const metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

/**
 * Dashboard — "safety command center" landing page.
 *
 * Architecture: this file is a Server Component. It fetches all data via the
 * `loadDashboardMetrics` aggregator (one transaction; see `_metrics.ts`),
 * shapes it into props, then hands off to a small set of client islands
 * (Hero, QuickActions, KpiStrip, widgets) for the motion + interactivity.
 *
 * The page is split into five visual zones, top to bottom:
 *   1. Hero band — 4 headline rates (TRIR, DART, training %, doc %)
 *   2. Quick-action pills — common "start something" CTAs
 *   3. KPI strip — 8 secondary tiles, scrollable on small screens
 *   4. Two-column widget grid — recent incidents / due CAs / top sites / etc.
 *   5. Inbox preview — user's unread notifications
 *
 * Each zone is wrapped in a `MotionSection` to stagger its entrance.
 */
export default async function DashboardPage() {
  const ctx = await requireRequestContext()
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const data = await loadDashboardMetrics(ctx, today)

  // ---- Greeting -------------------------------------------------------
  const greeting = buildGreeting(today, ctx.membership?.displayName ?? null)
  const tenantSummary = `${data.peopleCount.toLocaleString()} active people · ${
    data.incidents30
  } incident${data.incidents30 === 1 ? '' : 's'} in the last 30 days`

  // ---- Hero tiles -----------------------------------------------------
  const hero: HeroTileData[] = [
    {
      key: 'trir',
      label: 'TRIR',
      href: '/incidents',
      icon: 'shield',
      value: data.trir.value,
      prevValue: data.trir.prevValue,
      formatKey: 'fixed2',
      caption: `${data.trir.recordableCount} recordable · ~${Math.round(
        data.trir.hoursWorked / 1000,
      )}k hours`,
      trend: data.trir.trend,
      invertedDelta: true,
      tooltip:
        'Total recordable incident rate. (Medical-aid + lost-time + fatality) × 200,000 / hours worked.',
    },
    {
      key: 'dart',
      label: 'DART',
      href: '/incidents',
      icon: 'activity',
      value: data.dart.value,
      prevValue: data.dart.prevValue,
      formatKey: 'fixed2',
      caption: `${data.dart.dartCount} DART · 12-mo rolling`,
      trend: data.dart.trend,
      invertedDelta: true,
      tooltip:
        'Days away/restricted/transferred rate. Incidents with lost time × 200,000 / hours worked.',
    },
    {
      key: 'training',
      label: 'Training compliance',
      href: '/training',
      icon: 'graduation',
      value: data.trainingCompliancePct,
      // We don't snapshot historical compliance %, so omit the delta rather
      // than fake one. The sparkline is a synthetic-curve heuristic, treated
      // as decorative visual cue only.
      prevValue: null,
      formatKey: 'integer',
      suffix: '%',
      caption: `${data.trainingComplianceCounts.completed} of ${data.trainingComplianceCounts.total} records`,
      trend: data.trainingComplianceTrend,
      invertedDelta: false,
      tooltip:
        'Share of assigned training records currently in "completed" state.',
    },
    {
      key: 'documents',
      label: 'Document compliance',
      href: '/documents',
      icon: 'file-check',
      value: data.documentCompliancePct,
      prevValue: null,
      formatKey: 'integer',
      suffix: '%',
      caption: `${data.documentComplianceCounts.acknowledged} of ${data.documentComplianceCounts.expected} acks`,
      trend: data.documentComplianceTrend,
      invertedDelta: false,
      tooltip:
        'Share of expected document acknowledgments completed by audience members.',
    },
  ]

  // ---- KPI strip tiles ------------------------------------------------
  // Note: more than 8 tiles is fine — strip scrolls horizontally. We add the
  // legacy "Incidents (30d)" and "Open PPE issues" tiles at the end so the
  // page doesn't lose any data point the old layout exposed.
  const incidentDelta = data.incidents30 - data.incidentsPrev30
  const incidentDeltaLabel =
    incidentDelta === 0
      ? 'flat vs prior 30d'
      : `${incidentDelta > 0 ? '+' : ''}${incidentDelta} vs prior 30d`
  const kpiTiles: KpiTileData[] = [
    {
      key: 'open-cas',
      label: 'Open CAs',
      value: data.openCAs,
      href: '/corrective-actions',
      iconKey: 'list-checks',
      caption:
        data.overdueCAs > 0
          ? `${data.overdueCAs} overdue`
          : data.openCAs > 0
            ? 'all on track'
            : 'none open',
      captionTone: data.overdueCAs > 0 ? 'destructive' : 'success',
      emphasis: data.openCAs > 0 && data.overdueCAs > 0 ? 'warning' : 'normal',
    },
    {
      key: 'overdue-cas',
      label: 'Overdue CAs',
      value: data.overdueCAs,
      href: '/corrective-actions/reports/overdue',
      iconKey: 'calendar',
      caption:
        data.overdueCAs > 0 ? 'past due — action needed' : 'nothing past due',
      captionTone: data.overdueCAs > 0 ? 'destructive' : 'success',
      emphasis: data.overdueCAs > 0 ? 'danger' : 'normal',
    },
    {
      key: 'inspections-mtd',
      label: 'Inspections this month',
      value: data.inspectionsThisMonth,
      href: '/inspections',
      iconKey: 'clipboard-check',
      caption: 'submitted or closed',
      captionTone: 'muted',
    },
    {
      key: 'cs-active',
      label: 'Active CS permits',
      value: data.csActive,
      href: '/confined-space',
      iconKey: 'shield',
      caption: data.csActive > 0 ? 'permits currently open' : 'no permits open',
      captionTone: data.csActive > 0 ? 'warning' : 'muted',
      emphasis: data.csActive > 0 ? 'warning' : 'normal',
    },
    {
      key: 'lw-active',
      label: 'Lone-worker sessions',
      value: data.lwActive,
      href: '/lone-worker',
      iconKey: 'radio',
      caption: data.lwActive > 0 ? 'session(s) running' : 'all quiet',
      captionTone: data.lwActive > 0 ? 'warning' : 'success',
      emphasis: data.lwActive > 0 ? 'warning' : 'normal',
    },
    {
      key: 'expiring-certs',
      label: 'Certs expiring (90d)',
      value: data.expiringCertsCount,
      href: '/training',
      iconKey: 'grad',
      caption: data.expiringCertsCount > 0 ? 'plan renewals' : 'all current',
      captionTone: data.expiringCertsCount > 0 ? 'warning' : 'success',
    },
    {
      key: 'ppe-overdue',
      label: 'PPE inspections overdue',
      value: data.ppeInspectionsOverdue,
      href: '/ppe/reports/inspection-due',
      iconKey: 'hard-hat',
      caption:
        data.ppeInspectionsOverdue > 0 ? 'past annual due' : 'all current',
      captionTone:
        data.ppeInspectionsOverdue > 0 ? 'destructive' : 'success',
      emphasis: data.ppeInspectionsOverdue > 0 ? 'danger' : 'normal',
    },
    {
      key: 'submissions-today',
      label: 'Submissions today',
      value: data.submissionsToday,
      href: '/forms/responses',
      iconKey: 'clipboard',
      caption: 'forms turned in',
      captionTone: 'muted',
    },
    {
      key: 'incidents-30d',
      label: 'Incidents (30d)',
      value: data.incidents30,
      href: '/incidents',
      iconKey: 'alert',
      caption: incidentDeltaLabel,
      // Rising incident counts are bad — flag with destructive tone
      captionTone: incidentDelta > 0 ? 'destructive' : incidentDelta < 0 ? 'success' : 'muted',
      emphasis: incidentDelta > 0 ? 'warning' : 'normal',
    },
    {
      key: 'ppe-open-issues',
      label: 'Open PPE issues',
      value: data.ppeOpenIssues,
      href: '/ppe',
      iconKey: 'hard-hat',
      caption: data.ppeOpenIssues > 0 ? 'awaiting resolution' : 'all clear',
      captionTone: data.ppeOpenIssues > 0 ? 'warning' : 'success',
      emphasis: data.ppeOpenIssues > 0 ? 'warning' : 'normal',
    },
  ]

  return (
    <PageContainer>
      <div className="space-y-6">
        {/* 1. Hero band */}
        <MotionSection index={0}>
          <Hero
            tiles={hero}
            asOf={today.toLocaleString()}
            greeting={greeting}
            tenantSummary={tenantSummary}
          />
        </MotionSection>

        {/* 2. Quick-action pill rail */}
        <MotionSection index={1} className="space-y-2.5">
          <SectionLabel>
            <TrendingUp size={11} className="text-teal-600" />
            Quick actions
          </SectionLabel>
          <QuickActions />
        </MotionSection>

        {/* 3. KPI strip */}
        <MotionSection index={2} className="space-y-2.5">
          <SectionLabel>
            <ClipboardCheck size={11} className="text-teal-600" />
            Operations at a glance
          </SectionLabel>
          <KpiStrip tiles={kpiTiles} />
        </MotionSection>

        {/* 4. Two-column widget grid */}
        <MotionSection index={3} className="space-y-2.5">
          <SectionLabel>
            <ListChecks size={11} className="text-teal-600" />
            What needs attention
          </SectionLabel>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Left column */}
            <div className="space-y-4">
              <RecentIncidentsWidget
                items={data.recentIncidents.map((i) => ({
                  id: i.id,
                  reference: i.reference,
                  title: i.title,
                  severity: i.severity,
                  type: i.type,
                  occurredAt: i.occurredAt,
                }))}
              />
              <DueCAsWidget
                items={data.dueCAs.map((c) => ({
                  id: c.id,
                  reference: c.reference,
                  title: c.title,
                  severity: c.severity,
                  dueOn: c.dueOn,
                }))}
                todayIso={todayIso}
              />
            </div>

            {/* Right column */}
            <div className="space-y-4">
              <TopSitesWidget items={data.topSitesByIncidents} />
              <ExpiringTrainingWidget
                items={data.expiringTraining30d}
                todayIso={todayIso}
              />
            </div>
          </div>
        </MotionSection>

        {/* 5. Inbox + overdue */}
        <MotionSection index={4} className="space-y-2.5">
          <SectionLabel>
            <CalendarClock size={11} className="text-teal-600" />
            For you
          </SectionLabel>
          <div className="grid gap-4 lg:grid-cols-2">
            <InboxWidget
              items={data.myInbox.map((n) => ({
                id: n.id,
                title: n.title,
                body: n.body,
                category: n.category,
                linkPath: n.linkPath,
                occurredAt: n.occurredAt,
              }))}
            />
            <OverdueCAsWidget items={data.topOverdueCAs} />
          </div>
        </MotionSection>

        {/* Footer sentinel — average CA aging summary so this datum isn't lost */}
        {data.openCAAgingDays !== null ? (
          <p className="pt-2 text-center text-[11px] text-slate-400">
            Average open-CA aging:{' '}
            <span className="font-semibold text-slate-600 tabular-nums">
              {data.openCAAgingDays} days
            </span>
            . Snapshot generated {today.toLocaleString()}.
          </p>
        ) : null}
      </div>
    </PageContainer>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
      {children}
    </div>
  )
}

function buildGreeting(now: Date, name: string | null): string {
  const hour = now.getHours()
  const stem =
    hour < 5
      ? 'Working late'
      : hour < 12
        ? 'Good morning'
        : hour < 17
          ? 'Good afternoon'
          : hour < 21
            ? 'Good evening'
            : 'Burning the midnight oil'
  const firstName = name?.split(/\s+/)[0]
  return firstName ? `${stem}, ${firstName}.` : `${stem}.`
}
