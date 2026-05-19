import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  GraduationCap,
  HardHat,
  ListChecks,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wrench,
} from 'lucide-react'
import { and, asc, count, desc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm'
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@beaconhs/ui'
import {
  correctiveActions,
  csPermits,
  formResponses,
  incidents,
  lwSessions,
  notifications,
  people,
  ppeIssueReports,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const ctx = await requireRequestContext()
  const today = new Date()
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 86_400_000)
  const sixtyDaysAgo = new Date(today.getTime() - 60 * 86_400_000)
  const ninetyDaysAhead = new Date(today.getTime() + 90 * 86_400_000)
  const todayStart = new Date(today)
  todayStart.setHours(0, 0, 0, 0)
  const todayIso = today.toISOString().slice(0, 10)
  const ninetyIso = ninetyDaysAhead.toISOString().slice(0, 10)

  const data = await ctx.db(async (tx) => {
    const [incRow] = await tx
      .select({ c: count() })
      .from(incidents)
      .where(gte(incidents.occurredAt, thirtyDaysAgo))
    const [incPrev] = await tx
      .select({ c: count() })
      .from(incidents)
      .where(and(gte(incidents.occurredAt, sixtyDaysAgo), lte(incidents.occurredAt, thirtyDaysAgo)))
    const [caRow] = await tx
      .select({ c: count() })
      .from(correctiveActions)
      .where(isNull(correctiveActions.closedAt))
    const [caOverdue] = await tx
      .select({ c: count() })
      .from(correctiveActions)
      .where(
        and(
          isNull(correctiveActions.closedAt),
          isNotNull(correctiveActions.dueOn),
          lte(correctiveActions.dueOn, todayIso),
        ),
      )
    const [subRow] = await tx
      .select({ c: count() })
      .from(formResponses)
      .where(gte(formResponses.submittedAt, todayStart))
    const [certRow] = await tx
      .select({ c: count() })
      .from(trainingRecords)
      .where(
        and(
          isNotNull(trainingRecords.expiresOn),
          lte(trainingRecords.expiresOn, ninetyIso),
        ),
      )
    const [csActive] = await tx
      .select({ c: count() })
      .from(csPermits)
      .where(eq(csPermits.status, 'active'))
    const [lwActive] = await tx
      .select({ c: count() })
      .from(lwSessions)
      .where(eq(lwSessions.status, 'active'))
    const [ppeOpen] = await tx
      .select({ c: count() })
      .from(ppeIssueReports)
      .where(eq(ppeIssueReports.status, 'open'))
    const [peopleCount] = await tx.select({ c: count() }).from(people)

    const recentIncidents = await tx
      .select()
      .from(incidents)
      .orderBy(desc(incidents.occurredAt))
      .limit(5)

    const dueCAs = await tx
      .select()
      .from(correctiveActions)
      .where(isNull(correctiveActions.closedAt))
      .orderBy(asc(correctiveActions.dueOn))
      .limit(5)

    const expiringCertsList = await tx
      .select({ record: trainingRecords, person: people, course: trainingCourses })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(and(isNotNull(trainingRecords.expiresOn), lte(trainingRecords.expiresOn, ninetyIso)))
      .orderBy(asc(trainingRecords.expiresOn))
      .limit(5)

    const myInbox = await tx
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt)))
      .orderBy(desc(notifications.occurredAt))
      .limit(5)

    return {
      incidents30: Number(incRow?.c ?? 0),
      incidentsPrev30: Number(incPrev?.c ?? 0),
      openCAs: Number(caRow?.c ?? 0),
      overdueCAs: Number(caOverdue?.c ?? 0),
      submissionsToday: Number(subRow?.c ?? 0),
      expiringCertsCount: Number(certRow?.c ?? 0),
      csActive: Number(csActive?.c ?? 0),
      lwActive: Number(lwActive?.c ?? 0),
      ppeOpen: Number(ppeOpen?.c ?? 0),
      peopleCount: Number(peopleCount?.c ?? 0),
      recentIncidents,
      dueCAs,
      expiringCertsList,
      myInbox,
    }
  })

  const incidentDelta = data.incidents30 - data.incidentsPrev30
  const incidentTrend = incidentDelta < 0 ? 'down' : incidentDelta > 0 ? 'up' : 'flat'

  return (
    <PageContainer>
      <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-slate-500">
            Snapshot of the safety program. {data.peopleCount} active people in this tenant.
          </p>
        </div>
        <span className="text-xs text-slate-500">As of {today.toLocaleString()}</span>
      </header>

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
          label="Submissions today"
          value={data.submissionsToday}
          icon={<ClipboardCheck size={16} />}
          href="/forms/responses"
        />
        <Stat
          label="Certs expiring (90d)"
          value={data.expiringCertsCount}
          icon={<GraduationCap size={16} />}
          href="/training"
        />
        <Stat
          label="Active CS permits"
          value={data.csActive}
          icon={<ShieldCheck size={16} />}
          href="/confined-space"
        />
        <Stat
          label="Lone-worker active"
          value={data.lwActive}
          icon={<Wrench size={16} />}
          href="/lone-worker"
        />
        <Stat label="Open PPE issues" value={data.ppeOpen} icon={<HardHat size={16} />} href="/ppe" />
        <Stat
          label="People"
          value={data.peopleCount}
          icon={<CheckCircle2 size={16} />}
          href="/people"
        />
      </div>

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
                        variant={overdue ? 'destructive' : c.severity === 'high' ? 'warning' : 'secondary'}
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
                    ? Math.round((new Date(row.record.expiresOn).getTime() - today.getTime()) / 86_400_000)
                    : null
                  return (
                    <li key={row.record.id} className="flex items-center justify-between py-2">
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
                      <div className="truncate text-xs text-slate-500">{n.body ?? n.category}</div>
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
