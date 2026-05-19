import Link from 'next/link'
import { notFound } from 'next/navigation'
import { asc, eq, inArray } from 'drizzle-orm'
import { AlertTriangle, CheckCircle, Clock, RefreshCw } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  people,
  trades,
  trainingAssessmentTypes,
  trainingAudienceAssignmentRecords,
  trainingAudienceAssignmentTargets,
  trainingAudienceAssignments,
  trainingCourses,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { DetailGrid } from '@/components/detail-grid'
import { PageContainer } from '@/components/page-layout'
import {
  archiveAudienceAssignment,
  refreshAssignmentCompliance,
} from '../../_actions/assignments'

export const dynamic = 'force-dynamic'

export default async function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [a] = await tx
      .select()
      .from(trainingAudienceAssignments)
      .where(eq(trainingAudienceAssignments.id, id))
      .limit(1)
    if (!a) return null
    const [course] = a.courseId
      ? await tx
          .select()
          .from(trainingCourses)
          .where(eq(trainingCourses.id, a.courseId))
          .limit(1)
      : [null]
    const [type] = a.assessmentTypeId
      ? await tx
          .select()
          .from(trainingAssessmentTypes)
          .where(eq(trainingAssessmentTypes.id, a.assessmentTypeId))
          .limit(1)
      : [null]
    const targets = await tx
      .select()
      .from(trainingAudienceAssignmentTargets)
      .where(eq(trainingAudienceAssignmentTargets.assignmentId, id))

    const tradeIds = targets
      .filter((t) => t.kind === 'trade' && t.tradeId)
      .map((t) => t.tradeId as string)
    const personIdsDirect = targets
      .filter((t) => t.kind === 'person' && t.personId)
      .map((t) => t.personId as string)
    const tradesRows = tradeIds.length
      ? await tx.select().from(trades).where(inArray(trades.id, tradeIds))
      : []
    const directPeopleRows = personIdsDirect.length
      ? await tx.select().from(people).where(inArray(people.id, personIdsDirect))
      : []

    const recs = await tx
      .select({ rec: trainingAudienceAssignmentRecords, person: people })
      .from(trainingAudienceAssignmentRecords)
      .innerJoin(people, eq(people.id, trainingAudienceAssignmentRecords.personId))
      .where(eq(trainingAudienceAssignmentRecords.assignmentId, id))
      .orderBy(asc(people.lastName), asc(people.firstName))

    return { a, course, type, targets, tradesRows, directPeopleRows, recs }
  })

  if (!data) notFound()
  const { a, course, type, targets, tradesRows, directPeopleRows, recs } = data

  const refreshAction = refreshAssignmentCompliance.bind(null, a.id)
  const archiveAction = archiveAudienceAssignment.bind(null, a.id)

  const stats = recs.reduce(
    (acc, r) => {
      acc.total += 1
      if (r.rec.status === 'completed') acc.completed += 1
      else if (r.rec.status === 'overdue') acc.overdue += 1
      else if (r.rec.status === 'in_progress') acc.inProgress += 1
      else acc.pending += 1
      return acc
    },
    { total: 0, completed: 0, overdue: 0, inProgress: 0, pending: 0 },
  )
  const pct = stats.total === 0 ? 0 : Math.round((stats.completed / stats.total) * 100)

  return (
    <PageContainer>
      <div className="space-y-6">
        <DetailHeader
          back={{ href: '/training/assignments', label: 'Back to assignments' }}
          title={a.name}
          subtitle={a.notes ?? undefined}
          badge={
            a.status === 'archived' ? (
              <Badge variant="outline">Archived</Badge>
            ) : (
              <Badge variant="success">Active</Badge>
            )
          }
          actions={
            <form action={refreshAction}>
              <Button variant="outline" type="submit">
                <RefreshCw size={14} /> Recompute compliance
              </Button>
            </form>
          }
        />

        <DetailGrid
          rows={[
            {
              label: 'Item',
              value:
                a.itemKind === 'course' && course
                  ? `${course.code} · ${course.name}`
                  : a.itemKind === 'assessment_type' && type
                    ? type.name
                    : '—',
            },
            { label: 'Due', value: a.dueOn ?? 'No due date' },
            {
              label: 'Recurrence',
              value: a.recurrenceCron ? (
                <span className="font-mono text-xs">{a.recurrenceCron}</span>
              ) : (
                'One-off'
              ),
            },
            { label: 'Remind before', value: `${a.remindBeforeDays}d` },
            {
              label: 'Total audience',
              value: `${stats.total} people`,
            },
            {
              label: 'Compliance',
              value: (
                <span className="inline-flex items-center gap-2">
                  <CheckCircle size={14} className="text-green-600" />
                  {stats.completed}/{stats.total} ({pct}%)
                </span>
              ),
            },
          ]}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <StatusTile
            label="Completed"
            count={stats.completed}
            color="bg-green-100 text-green-800"
            icon={<CheckCircle size={16} />}
          />
          <StatusTile
            label="In progress"
            count={stats.inProgress}
            color="bg-slate-100 text-slate-800"
            icon={<Clock size={16} />}
          />
          <StatusTile
            label="Pending"
            count={stats.pending}
            color="bg-blue-100 text-blue-800"
            icon={<Clock size={16} />}
          />
          <StatusTile
            label="Overdue"
            count={stats.overdue}
            color="bg-red-100 text-red-800"
            icon={<AlertTriangle size={16} />}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Audience targets ({targets.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2 text-xs">
              {targets.map((t) => (
                <li key={t.id}>
                  {t.kind === 'everyone' ? (
                    <Badge variant="default">Everyone</Badge>
                  ) : t.kind === 'person' && t.personId ? (
                    <Badge variant="secondary">
                      Person:{' '}
                      {directPeopleRows.find((p) => p.id === t.personId)?.firstName ?? '?'}
                      {' '}
                      {directPeopleRows.find((p) => p.id === t.personId)?.lastName ?? ''}
                    </Badge>
                  ) : t.kind === 'trade' && t.tradeId ? (
                    <Badge variant="secondary">
                      Trade: {tradesRows.find((tr) => tr.id === t.tradeId)?.name ?? '?'}
                    </Badge>
                  ) : t.kind === 'role' && t.roleKey ? (
                    <Badge variant="secondary">Role: {t.roleKey}</Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Audience members ({recs.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {recs.length === 0 ? (
              <p className="text-sm text-slate-500">No audience members resolved yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Completed on</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Last evaluated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recs.map(({ rec, person }) => (
                    <TableRow key={rec.id}>
                      <TableCell>
                        <Link
                          href={`/training/transcripts/${person.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {person.lastName}, {person.firstName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {rec.status === 'completed' ? (
                          <Badge variant="success">Completed</Badge>
                        ) : rec.status === 'overdue' ? (
                          <Badge variant="destructive">Overdue</Badge>
                        ) : rec.status === 'in_progress' ? (
                          <Badge variant="secondary">In progress</Badge>
                        ) : (
                          <Badge variant="outline">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">{rec.completedOn ?? '—'}</TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {rec.sourceTrainingRecordId ? (
                          <Link
                            href={`/training/records/${rec.sourceTrainingRecordId}`}
                            className="hover:underline"
                          >
                            Training record
                          </Link>
                        ) : rec.sourceAssessmentId ? (
                          <Link
                            href={`/training/assessments/${rec.sourceAssessmentId}`}
                            className="hover:underline"
                          >
                            Assessment
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {rec.lastEvaluatedAt
                          ? new Date(rec.lastEvaluatedAt).toLocaleString()
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={archiveAction}>
              <p className="mb-2 text-xs text-slate-500">
                Archives the assignment. It stays in the audit log but compliance scoring stops
                immediately.
              </p>
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
              >
                Archive assignment
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

function StatusTile({
  label,
  count,
  color,
  icon,
}: {
  label: string
  count: number
  color: string
  icon: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${color}`}>
          {icon}
          {label}
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">{count}</div>
    </div>
  )
}

