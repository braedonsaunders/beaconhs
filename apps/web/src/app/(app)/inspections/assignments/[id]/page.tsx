import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, count, desc, eq, gte, lte } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  inspectionAssignmentCompliance,
  inspectionAssignments,
  inspectionRecords,
  inspectionTypes,
  people,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailGrid } from '@/components/detail-grid'
import { DetailPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { expandAssignmentAudience } from '../../_lib'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'compliance', 'activity'] as const
type Tab = (typeof TABS)[number]

async function toggleEnabled(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const next = String(formData.get('next') ?? '') === 'true'
  await ctx.db((tx) =>
    tx.update(inspectionAssignments).set({ enabled: next }).where(eq(inspectionAssignments.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'inspection_assignment',
    entityId: id,
    action: 'update',
    summary: next ? 'Enabled' : 'Disabled',
    after: { enabled: next },
  })
  revalidatePath(`/inspections/assignments/${id}`)
  revalidatePath('/inspections/assignments')
}

async function recomputeCompliance(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return

  const [assignment] = await ctx.db((tx) =>
    tx.select().from(inspectionAssignments).where(eq(inspectionAssignments.id, id)).limit(1),
  )
  if (!assignment) return

  const assignees = await expandAssignmentAudience(ctx, {
    targetRoleKeys: assignment.targetRoleKeys,
    targetPersonIds: assignment.targetPersonIds,
    targetOrgUnitIds: assignment.targetOrgUnitIds,
    targetEverybody: assignment.targetEverybody,
  })

  // Compute per-person snapshot for the last 4 periods
  const today = new Date()
  const periods = buildPeriods(assignment.frequency, today)

  await ctx.db(async (tx) => {
    // Clear existing snapshot then re-insert. Idempotent.
    await tx
      .delete(inspectionAssignmentCompliance)
      .where(eq(inspectionAssignmentCompliance.assignmentId, id))

    if (assignees.length === 0) return

    const rows = await Promise.all(
      assignees.map(async (a) => {
        const counts = await Promise.all(
          periods.map(async ([start, end]) => {
            const countRows = await tx
              .select({ c: count() })
              .from(inspectionRecords)
              .where(
                and(
                  eq(inspectionRecords.typeId, assignment.typeId),
                  gte(inspectionRecords.occurredAt, start),
                  lte(inspectionRecords.occurredAt, end),
                ),
              )
            return Number(countRows[0]?.c ?? 0)
          }),
        )
        // Expected = quantity per period (assumes person was active across the period — simplification vs legacy which used days-worked)
        const expected = assignment.quantityPerPeriod
        const pct = counts.map((c) => Math.min(100, Math.round((c / Math.max(1, expected)) * 100)))
        const compliant = pct.map((p) => p >= assignment.compliantPercentage)
        const overall = Math.round((pct[1]! + pct[2]! + pct[3]!) / 3)
        return {
          tenantId: ctx.tenantId,
          assignmentId: id,
          personId: a.id,
          p1Start: periods[0]![0].toISOString().slice(0, 10),
          p1End: periods[0]![1].toISOString().slice(0, 10),
          p1Count: counts[0]!,
          p1Expected: expected,
          p1Percent: pct[0]!,
          p1Compliant: compliant[0]!,
          p2Count: counts[1]!,
          p2Expected: expected,
          p2Percent: pct[1]!,
          p2Compliant: compliant[1]!,
          p3Count: counts[2]!,
          p3Expected: expected,
          p3Percent: pct[2]!,
          p3Compliant: compliant[2]!,
          p4Count: counts[3]!,
          p4Expected: expected,
          p4Percent: pct[3]!,
          p4Compliant: compliant[3]!,
          overallPercent: overall,
          computedAt: new Date(),
        }
      }),
    )
    await tx.insert(inspectionAssignmentCompliance).values(rows)
  })

  await recordAudit(ctx, {
    entityType: 'inspection_assignment',
    entityId: id,
    action: 'update',
    summary: `Recomputed compliance for ${assignees.length} assignee${assignees.length === 1 ? '' : 's'}`,
  })
  revalidatePath(`/inspections/assignments/${id}`)
}

function buildPeriods(freq: 'day' | 'week' | 'month' | 'quarter' | 'year', today: Date) {
  const periods: [Date, Date][] = []
  if (freq === 'day') {
    for (let i = 0; i < 4; i++) {
      const start = new Date(today)
      start.setHours(0, 0, 0, 0)
      start.setDate(start.getDate() - i)
      const end = new Date(start)
      end.setHours(23, 59, 59, 999)
      periods.push([start, end])
    }
  } else if (freq === 'week') {
    for (let i = 0; i < 4; i++) {
      const start = new Date(today)
      start.setHours(0, 0, 0, 0)
      start.setDate(start.getDate() - (start.getDay() + 7 * i))
      const end = new Date(start)
      end.setDate(end.getDate() + 6)
      end.setHours(23, 59, 59, 999)
      periods.push([start, end])
    }
  } else if (freq === 'month') {
    for (let i = 0; i < 4; i++) {
      const ref = new Date(today.getFullYear(), today.getMonth() - i, 1)
      const start = new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0)
      const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999)
      periods.push([start, end])
    }
  } else if (freq === 'quarter') {
    for (let i = 0; i < 4; i++) {
      const q = Math.floor(today.getMonth() / 3) - i
      const refYear = today.getFullYear() + Math.floor(q / 4)
      const refQ = ((q % 4) + 4) % 4
      const start = new Date(refYear, refQ * 3, 1, 0, 0, 0, 0)
      const end = new Date(refYear, refQ * 3 + 3, 0, 23, 59, 59, 999)
      periods.push([start, end])
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const year = today.getFullYear() - i
      const start = new Date(year, 0, 1, 0, 0, 0, 0)
      const end = new Date(year, 11, 31, 23, 59, 59, 999)
      periods.push([start, end])
    }
  }
  return periods
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Assignment · ${id.slice(0, 8)}` }
}

export default async function InspectionAssignmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'overview')
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ assignment: inspectionAssignments, type: inspectionTypes })
      .from(inspectionAssignments)
      .innerJoin(inspectionTypes, eq(inspectionTypes.id, inspectionAssignments.typeId))
      .where(eq(inspectionAssignments.id, id))
      .limit(1)
    if (!row) return null

    const compliance = await tx
      .select({ comp: inspectionAssignmentCompliance, person: people })
      .from(inspectionAssignmentCompliance)
      .innerJoin(people, eq(people.id, inspectionAssignmentCompliance.personId))
      .where(eq(inspectionAssignmentCompliance.assignmentId, id))
      .orderBy(desc(inspectionAssignmentCompliance.overallPercent))

    const recentRecords = await tx
      .select({
        id: inspectionRecords.id,
        reference: inspectionRecords.reference,
        occurredAt: inspectionRecords.occurredAt,
        status: inspectionRecords.status,
      })
      .from(inspectionRecords)
      .where(eq(inspectionRecords.typeId, row.assignment.typeId))
      .orderBy(desc(inspectionRecords.occurredAt))
      .limit(20)

    return { ...row, compliance, recentRecords }
  })

  if (!data) notFound()
  const { assignment, type, compliance, recentRecords } = data
  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'inspection_assignment', id, 50) : []

  const avgCompliance =
    compliance.length > 0
      ? Math.round(
          compliance.reduce((s, r) => s + Number(r.comp.overallPercent), 0) / compliance.length,
        )
      : null

  const basePath = `/inspections/assignments/${id}`

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/inspections/assignments', label: 'Back to assignments' }}
          title={`${type.name} · ${assignment.frequency}`}
          subtitle={`${assignment.quantityPerPeriod} per ${assignment.frequency} · ${assignment.compliantPercentage}% to be compliant`}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant={assignment.enabled ? 'success' : 'secondary'}>
                {assignment.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
              {avgCompliance != null ? (
                <Badge
                  variant={
                    avgCompliance >= assignment.compliantPercentage
                      ? 'success'
                      : avgCompliance >= Math.floor(assignment.compliantPercentage / 2)
                        ? 'warning'
                        : 'destructive'
                  }
                >
                  {avgCompliance}% avg
                </Badge>
              ) : null}
            </div>
          }
          actions={
            <>
              <form action={recomputeCompliance}>
                <input type="hidden" name="id" value={id} />
                <Button variant="outline" type="submit">
                  Recompute
                </Button>
              </form>
              <form action={toggleEnabled}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="next" value={(!assignment.enabled).toString()} />
                <Button type="submit" variant={assignment.enabled ? 'outline' : 'default'}>
                  {assignment.enabled ? 'Disable' : 'Enable'}
                </Button>
              </form>
            </>
          }
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'compliance', label: 'Compliance', count: compliance.length },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
          <>
            <Section title="Schedule">
              <DetailGrid
                rows={[
                  {
                    label: 'Inspection type',
                    value: (
                      <Link
                        href={`/inspections/types/${type.id}`}
                        className="text-teal-700 hover:underline"
                      >
                        {type.name}
                      </Link>
                    ),
                  },
                  { label: 'Frequency', value: assignment.frequency },
                  { label: 'Cron', value: assignment.cron ?? '(use frequency default)' },
                  {
                    label: 'Quantity / period',
                    value: assignment.quantityPerPeriod,
                  },
                  {
                    label: 'Compliant ≥',
                    value: `${assignment.compliantPercentage}%`,
                  },
                  {
                    label: 'Due offset',
                    value:
                      assignment.dueOffsetMinutes != null
                        ? `${assignment.dueOffsetMinutes} minutes after fire`
                        : '—',
                  },
                  {
                    label: 'Next due',
                    value: assignment.nextDueAt
                      ? new Date(assignment.nextDueAt).toLocaleString()
                      : '—',
                  },
                  {
                    label: 'Last fired',
                    value: assignment.lastFiredAt
                      ? new Date(assignment.lastFiredAt).toLocaleString()
                      : '—',
                  },
                ]}
              />
            </Section>

            <Section title="Audience">
              <DetailGrid
                rows={[
                  {
                    label: 'Everyone',
                    value: assignment.targetEverybody ? 'Yes' : 'No',
                  },
                  {
                    label: 'Roles',
                    value:
                      assignment.targetRoleKeys.length > 0
                        ? assignment.targetRoleKeys.join(', ')
                        : '—',
                  },
                  {
                    label: 'People',
                    value:
                      assignment.targetPersonIds.length > 0
                        ? `${assignment.targetPersonIds.length} selected`
                        : '—',
                  },
                  {
                    label: 'Sites',
                    value:
                      assignment.targetOrgUnitIds.length > 0
                        ? `${assignment.targetOrgUnitIds.length} selected`
                        : '—',
                  },
                ]}
              />
              {assignment.notes ? (
                <div className="mt-4 text-sm">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Notes</div>
                  <p className="mt-1 whitespace-pre-wrap">{assignment.notes}</p>
                </div>
              ) : null}
            </Section>

            <Section title={`Recent records (${recentRecords.length})`}>
              {recentRecords.length === 0 ? (
                <p className="text-sm text-slate-500">No records of this type yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {recentRecords.map((r) => (
                    <li key={r.id} className="flex items-center justify-between py-2">
                      <Link
                        href={`/inspections/records/${r.id}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {r.reference}
                      </Link>
                      <span className="text-xs text-slate-500">
                        {new Date(r.occurredAt).toLocaleDateString()}
                      </span>
                      <Badge
                        variant={
                          r.status === 'closed' || r.status === 'submitted' ? 'success' : 'warning'
                        }
                      >
                        {r.status.replace(/_/g, ' ')}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        ) : null}

        {active === 'compliance' ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                <span>Per-person compliance ({compliance.length})</span>
                <form action={recomputeCompliance}>
                  <input type="hidden" name="id" value={id} />
                  <Button variant="outline" size="sm" type="submit">
                    Recompute
                  </Button>
                </form>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {compliance.length === 0 ? (
                <EmptyState
                  icon={<span className="text-2xl">📈</span>}
                  title="No compliance data yet"
                  description="Click Recompute to expand the audience and tally completed records for the last four periods."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead>Overall</TableHead>
                      <TableHead>P1 (now)</TableHead>
                      <TableHead>P2</TableHead>
                      <TableHead>P3</TableHead>
                      <TableHead>P4</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {compliance.map((row) => (
                      <TableRow key={row.comp.id}>
                        <TableCell>
                          <Link href={`/people/${row.person.id}`} className="hover:underline">
                            {row.person.firstName} {row.person.lastName}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              row.comp.overallPercent >= assignment.compliantPercentage
                                ? 'success'
                                : row.comp.overallPercent >= assignment.compliantPercentage / 2
                                  ? 'warning'
                                  : 'destructive'
                            }
                          >
                            {row.comp.overallPercent}%
                          </Badge>
                        </TableCell>
                        <CompliancePeriodCell
                          percent={row.comp.p1Percent}
                          count={row.comp.p1Count}
                          expected={row.comp.p1Expected}
                          compliant={row.comp.p1Compliant}
                        />
                        <CompliancePeriodCell
                          percent={row.comp.p2Percent}
                          count={row.comp.p2Count}
                          expected={row.comp.p2Expected}
                          compliant={row.comp.p2Compliant}
                        />
                        <CompliancePeriodCell
                          percent={row.comp.p3Percent}
                          count={row.comp.p3Count}
                          expected={row.comp.p3Expected}
                          compliant={row.comp.p3Compliant}
                        />
                        <CompliancePeriodCell
                          percent={row.comp.p4Percent}
                          count={row.comp.p4Count}
                          expected={row.comp.p4Expected}
                          compliant={row.comp.p4Compliant}
                        />
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ) : null}

        {active === 'activity' ? (
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityFeed entries={activity} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </DetailPageLayout>
  )
}

function CompliancePeriodCell({
  percent,
  count,
  expected,
  compliant,
}: {
  percent: number
  count: number
  expected: number
  compliant: boolean
}) {
  return (
    <TableCell>
      <div className="flex flex-col gap-0.5 text-xs">
        <span
          className={
            compliant
              ? 'font-medium text-emerald-700'
              : percent === 0
                ? 'text-slate-400'
                : 'font-medium text-red-700'
          }
        >
          {percent}%
        </span>
        <span className="text-slate-400 tabular-nums">
          {count}/{expected}
        </span>
      </div>
    </TableCell>
  )
}
