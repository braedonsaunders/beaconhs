import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileCheck,
  GraduationCap,
  HardHat,
  ListChecks,
  MapPin,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wrench,
} from 'lucide-react'
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadDashboardMetrics } from './_metrics'

export const metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const ctx = await requireRequestContext()
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const data = await loadDashboardMetrics(ctx, today)

  const incidentDelta = data.incidents30 - data.incidentsPrev30
  const incidentTrend = incidentDelta < 0 ? 'down' : incidentDelta > 0 ? 'up' : 'flat'

  return (
    <PageContainer>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="text-sm text-slate-500">
              Snapshot of the safety program. {data.peopleCount} active people in this tenant.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <Link
              href="/reports"
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 hover:border-teal-700 hover:text-teal-700"
            >
              <Sparkles size={12} />
              Reports
            </Link>
            <span>As of {today.toLocaleString()}</span>
          </div>
        </header>

        {/* --- Headline OSHA-style rates --------------------------------- */}
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Headline safety rates · last 12 months
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <RateTile
              label="TRIR"
              tooltip="Total recordable incident rate. (Medical-aid + lost-time + fatality) × 200,000 / hours worked."
              value={
                data.trir.value !== null
                  ? data.trir.value.toFixed(2)
                  : data.trir.hoursWorked === 0
                    ? '—'
                    : '0.00'
              }
              extra={`${data.trir.recordableCount} recordable · ~${Math.round(data.trir.hoursWorked / 1000)}k hours`}
              icon={<ShieldAlert size={16} />}
              href="/incidents"
            />
            <RateTile
              label="DART rate"
              tooltip="Days away/restricted/transferred rate. Incidents with lost time × 200,000 / hours worked."
              value={
                data.dart.value !== null
                  ? data.dart.value.toFixed(2)
                  : data.dart.hoursWorked === 0
                    ? '—'
                    : '0.00'
              }
              extra={`${data.dart.dartCount} DART incidents · 12-mo rolling`}
              icon={<Activity size={16} />}
              href="/incidents"
            />
            <RateTile
              label="Training compliance"
              value={
                data.trainingCompliancePct !== null
                  ? `${data.trainingCompliancePct}%`
                  : '—'
              }
              extra={`${data.trainingComplianceCounts.completed} of ${data.trainingComplianceCounts.total} assignment records`}
              icon={<GraduationCap size={16} />}
              href="/training"
              tone={complianceTone(data.trainingCompliancePct)}
            />
            <RateTile
              label="Document compliance"
              value={
                data.documentCompliancePct !== null
                  ? `${data.documentCompliancePct}%`
                  : '—'
              }
              extra={`${data.documentComplianceCounts.acknowledged} of ${data.documentComplianceCounts.expected} acknowledgments`}
              icon={<FileCheck size={16} />}
              href="/documents"
              tone={complianceTone(data.documentCompliancePct)}
            />
          </div>
        </section>

        {/* --- Operational KPI tiles ------------------------------------- */}
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Operational KPIs
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Stat
              label="Incidents (30d)"
              value={data.incidents30}
              icon={<AlertTriangle size={16} />}
              trend={
                <TrendBadge
                  direction={incidentTrend}
                  label={`${incidentDelta > 0 ? '+' : ''}${incidentDelta} vs prev 30d`}
                  inverted
                />
              }
              href="/incidents"
            />
            <Stat
              label="Open CAs"
              value={data.openCAs}
              extra={data.overdueCAs > 0 ? `${data.overdueCAs} overdue` : 'none overdue'}
              extraTone={data.overdueCAs > 0 ? 'destructive' : 'success'}
              icon={<ListChecks size={16} />}
              href="/corrective-actions"
            />
            <Stat
              label="Open CA aging"
              value={data.openCAAgingDays ?? 0}
              extra={data.openCAAgingDays ? 'avg days open' : 'no open CAs'}
              icon={<CalendarClock size={16} />}
              href="/corrective-actions"
            />
            <Stat
              label="Inspections this month"
              value={data.inspectionsThisMonth}
              icon={<ClipboardCheck size={16} />}
              href="/inspections"
            />
            <Stat
              label="Lone-worker active"
              value={data.lwActive}
              extra={data.lwActive > 0 ? 'session(s) running' : 'all quiet'}
              extraTone={data.lwActive > 0 ? 'warning' : 'success'}
              icon={<Radio size={16} />}
              href="/lone-worker"
            />
            <Stat
              label="PPE inspections overdue"
              value={data.ppeInspectionsOverdue}
              extra={data.ppeInspectionsOverdue > 0 ? 'past annual due' : 'all current'}
              extraTone={data.ppeInspectionsOverdue > 0 ? 'destructive' : 'success'}
              icon={<HardHat size={16} />}
              href="/ppe"
            />
            <Stat
              label="Certs expiring (90d)"
              value={data.expiringCertsCount}
              icon={<GraduationCap size={16} />}
              href="/training"
            />
            <Stat
              label="Submissions today"
              value={data.submissionsToday}
              icon={<ClipboardCheck size={16} />}
              href="/forms/responses"
            />
            <Stat
              label="Active CS permits"
              value={data.csActive}
              icon={<ShieldCheck size={16} />}
              href="/confined-space"
            />
            <Stat
              label="Open PPE issues"
              value={data.ppeOpenIssues}
              icon={<HardHat size={16} />}
              href="/ppe"
            />
            <Stat
              label="People"
              value={data.peopleCount}
              icon={<CheckCircle2 size={16} />}
              href="/people"
            />
          </div>
        </section>

        {/* --- List widgets --------------------------------------------- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recent incidents</CardTitle>
              <CardDescription>Last 5 reported</CardDescription>
            </CardHeader>
            <CardContent>
              {data.recentIncidents.length === 0 ? (
                <p className="text-sm text-slate-500">No incidents yet — nice.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.recentIncidents.map((i) => (
                    <li key={i.id} className="flex items-center justify-between py-2">
                      <div className="min-w-0">
                        <Link
                          href={`/incidents/${i.id}`}
                          className="block truncate font-medium hover:underline"
                        >
                          {i.title}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {i.reference} · {new Date(i.occurredAt).toLocaleDateString()} ·{' '}
                          {i.type.replace(/_/g, ' ')}
                        </div>
                      </div>
                      <Badge
                        variant={
                          i.severity === 'fatality' || i.severity === 'lost_time'
                            ? 'destructive'
                            : i.severity === 'medical_aid'
                              ? 'warning'
                              : 'secondary'
                        }
                      >
                        {i.severity.replace(/_/g, ' ')}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Corrective actions due</CardTitle>
              <CardDescription>Next 5 open actions by due date</CardDescription>
            </CardHeader>
            <CardContent>
              {data.dueCAs.length === 0 ? (
                <p className="text-sm text-slate-500">No open corrective actions.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.dueCAs.map((c) => {
                    const overdue = c.dueOn && c.dueOn < todayIso
                    return (
                      <li key={c.id} className="flex items-center justify-between py-2">
                        <div className="min-w-0">
                          <Link
                            href={`/corrective-actions/${c.id}`}
                            className="block truncate font-medium hover:underline"
                          >
                            {c.reference} · {c.title}
                          </Link>
                          <div className="text-xs text-slate-500">Due {c.dueOn ?? '—'}</div>
                        </div>
                        <Badge
                          variant={
                            overdue
                              ? 'destructive'
                              : c.severity === 'high'
                                ? 'warning'
                                : 'secondary'
                          }
                        >
                          {overdue ? 'overdue' : c.severity}
                        </Badge>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Certs expiring soon</CardTitle>
              <CardDescription>Within 90 days</CardDescription>
            </CardHeader>
            <CardContent>
              {data.expiringCertsList.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing expiring.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.expiringCertsList.map((row) => {
                    const days = row.record.expiresOn
                      ? Math.round(
                          (new Date(row.record.expiresOn).getTime() - today.getTime()) /
                            86_400_000,
                        )
                      : null
                    return (
                      <li
                        key={row.record.id}
                        className="flex items-center justify-between py-2"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/people/${row.person.id}`}
                            className="block truncate font-medium hover:underline"
                          >
                            {row.person.firstName} {row.person.lastName}
                          </Link>
                          <div className="text-xs text-slate-500">{row.course.name}</div>
                        </div>
                        <Badge variant={days !== null && days < 0 ? 'destructive' : 'warning'}>
                          {days !== null && days < 0
                            ? `Expired ${Math.abs(days)}d ago`
                            : `${days}d left`}
                        </Badge>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Inbox</CardTitle>
              <CardDescription>Latest unread notifications</CardDescription>
            </CardHeader>
            <CardContent>
              {data.myInbox.length === 0 ? (
                <p className="text-sm text-slate-500">Inbox zero.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.myInbox.map((n) => (
                    <li key={n.id} className="flex items-center justify-between py-2">
                      <div className="min-w-0">
                        {n.linkPath ? (
                          <Link
                            href={n.linkPath as any}
                            className="block truncate font-medium hover:underline"
                          >
                            {n.title}
                          </Link>
                        ) : (
                          <span className="block truncate font-medium">{n.title}</span>
                        )}
                        <div className="truncate text-xs text-slate-500">
                          {n.body ?? n.category}
                        </div>
                      </div>
                      <span className="text-xs text-slate-500">
                        {new Date(n.occurredAt).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin size={16} className="text-slate-400" />
                Top sites by incidents (90d)
              </CardTitle>
              <CardDescription>Where the most incidents have been reported</CardDescription>
            </CardHeader>
            <CardContent>
              {data.topSitesByIncidents.length === 0 ? (
                <p className="text-sm text-slate-500">No incidents in the last 90 days.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.topSitesByIncidents.map((s, i) => (
                    <li
                      key={s.siteId ?? `none-${i}`}
                      className="flex items-center justify-between py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                          {i + 1}
                        </span>
                        <span className="truncate font-medium">{s.siteName}</span>
                      </div>
                      <Badge variant="outline">{s.incidents}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench size={16} className="text-slate-400" />
                Most-overdue CAs
              </CardTitle>
              <CardDescription>Top 5 by days past due date</CardDescription>
            </CardHeader>
            <CardContent>
              {data.topOverdueCAs.length === 0 ? (
                <p className="text-sm text-slate-500">No overdue corrective actions.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.topOverdueCAs.map((c) => (
                    <li key={c.id} className="flex items-center justify-between py-2">
                      <div className="min-w-0">
                        <Link
                          href={`/corrective-actions/${c.id}`}
                          className="block truncate font-medium hover:underline"
                        >
                          {c.reference} · {c.title}
                        </Link>
                        <div className="text-xs text-slate-500">Due {c.dueOn ?? '—'}</div>
                      </div>
                      <Badge variant="destructive">{c.daysOverdue}d overdue</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <GraduationCap size={16} className="text-slate-400" />
                Training expiring in 30 days
              </CardTitle>
              <CardDescription>People with certs lapsing soon</CardDescription>
            </CardHeader>
            <CardContent>
              {data.expiringTraining30d.length === 0 ? (
                <p className="text-sm text-slate-500">No certs expiring in the next 30 days.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.expiringTraining30d.map((row) => (
                    <li
                      key={`${row.personId}-${row.expiresOn}-${row.courseName}`}
                      className="flex items-center justify-between py-2"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/people/${row.personId}`}
                          className="block truncate font-medium hover:underline"
                        >
                          {row.personName}
                        </Link>
                        <div className="truncate text-xs text-slate-500">{row.courseName}</div>
                      </div>
                      <Badge variant="warning">{row.expiresOn}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  )
}

function Stat({
  label,
  value,
  icon,
  extra,
  extraTone,
  trend,
  href,
}: {
  label: string
  value: number
  icon: React.ReactNode
  extra?: string
  extraTone?: 'success' | 'warning' | 'destructive'
  trend?: React.ReactNode
  href: string
}) {
  const extraClass =
    extraTone === 'success'
      ? 'text-emerald-700'
      : extraTone === 'warning'
        ? 'text-amber-700'
        : extraTone === 'destructive'
          ? 'text-red-700'
          : 'text-slate-500'
  return (
    <Link href={href as any}>
      <Card className="transition-shadow hover:shadow-md">
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="uppercase tracking-wide">{label}</span>
            <span className="text-slate-400">{icon}</span>
          </div>
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
          <div className="flex items-center justify-between">
            {trend ?? <span />}
            {extra ? <span className={`text-xs ${extraClass}`}>{extra}</span> : <span />}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

function RateTile({
  label,
  value,
  extra,
  icon,
  href,
  tooltip,
  tone,
}: {
  label: string
  value: string
  extra?: string
  icon: React.ReactNode
  href: string
  tooltip?: string
  tone?: 'success' | 'warning' | 'destructive' | null
}) {
  const accent =
    tone === 'success'
      ? 'border-emerald-200'
      : tone === 'warning'
        ? 'border-amber-200'
        : tone === 'destructive'
          ? 'border-red-200'
          : 'border-slate-200'
  return (
    <Link href={href as any} title={tooltip}>
      <Card className={`transition-shadow hover:shadow-md ${accent}`}>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="uppercase tracking-wide">{label}</span>
            <span className="text-slate-400">{icon}</span>
          </div>
          <div className="text-3xl font-semibold tabular-nums">{value}</div>
          {extra ? <div className="text-xs text-slate-500">{extra}</div> : null}
        </CardContent>
      </Card>
    </Link>
  )
}

function TrendBadge({
  direction,
  label,
  inverted,
}: {
  direction: 'up' | 'down' | 'flat'
  label: string
  inverted?: boolean
}) {
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : ClipboardList
  const good = inverted ? direction === 'down' : direction === 'up'
  const tone =
    direction === 'flat' ? 'text-slate-500' : good ? 'text-emerald-700' : 'text-red-700'
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${tone}`}>
      <Icon size={12} />
      {label}
    </span>
  )
}

function complianceTone(pct: number | null): 'success' | 'warning' | 'destructive' | null {
  if (pct === null) return null
  if (pct >= 90) return 'success'
  if (pct >= 70) return 'warning'
  return 'destructive'
}
