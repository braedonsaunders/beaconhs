import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm'
import { Award, BookOpen, ClipboardCheck, FileText } from 'lucide-react'
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
  trainingAssessmentTypes,
  trainingAssessments,
  trainingCourses,
  trainingRecords,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { DetailGrid } from '@/components/detail-grid'

export const dynamic = 'force-dynamic'

const EXPIRING_WINDOW_DAYS = 90

export default async function TranscriptDetailPage({
  params,
}: {
  params: Promise<{ personId: string }>
}) {
  const { personId } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [person] = await tx
      .select()
      .from(people)
      .where(eq(people.id, personId))
      .limit(1)
    if (!person) return null

    const records = await tx
      .select({ rec: trainingRecords, course: trainingCourses })
      .from(trainingRecords)
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(and(eq(trainingRecords.personId, personId), isNull(trainingRecords.deletedAt)))
      .orderBy(desc(trainingRecords.completedOn))

    const attempts = await tx
      .select({ a: trainingAssessments, t: trainingAssessmentTypes })
      .from(trainingAssessments)
      .innerJoin(
        trainingAssessmentTypes,
        eq(trainingAssessmentTypes.id, trainingAssessments.typeId),
      )
      .where(
        and(eq(trainingAssessments.personId, personId), isNull(trainingAssessments.deletedAt)),
      )
      .orderBy(desc(trainingAssessments.completedAt))

    const skills = await tx
      .select({
        sk: trainingSkillAssignments,
        type: trainingSkillTypes,
        auth: trainingSkillAuthorities,
      })
      .from(trainingSkillAssignments)
      .innerJoin(trainingSkillTypes, eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId))
      .innerJoin(
        trainingSkillAuthorities,
        eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
      )
      .where(eq(trainingSkillAssignments.personId, personId))
      .orderBy(desc(trainingSkillAssignments.grantedOn))

    const todayIso = new Date().toISOString().slice(0, 10)
    const futureIso = new Date(Date.now() + EXPIRING_WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const expiring = await tx
      .select({ rec: trainingRecords, course: trainingCourses })
      .from(trainingRecords)
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(
        and(
          eq(trainingRecords.personId, personId),
          isNull(trainingRecords.deletedAt),
          gte(trainingRecords.expiresOn, todayIso),
          lte(trainingRecords.expiresOn, futureIso),
        ),
      )
      .orderBy(asc(trainingRecords.expiresOn))

    return { person, records, attempts, skills, expiring }
  })

  if (!data) notFound()
  const { person, records, attempts, skills, expiring } = data
  const today = new Date()

  return (
    <PageContainer>
      <div className="space-y-6">
        <DetailHeader
          back={{ href: '/training/transcripts', label: 'Back to transcripts' }}
          title={`${person.firstName} ${person.lastName}`}
          subtitle={person.jobTitle ?? undefined}
          badge={
            person.status === 'active' ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="secondary">{person.status}</Badge>
            )
          }
          actions={
            <a
              href="javascript:window.print()"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
            >
              Print transcript
            </a>
          }
        />

        <DetailGrid
          rows={[
            { label: 'Employee #', value: person.employeeNo ?? '—' },
            { label: 'Hire date', value: person.hireDate ?? '—' },
            {
              label: 'Total records',
              value: <span className="tabular-nums">{records.length}</span>,
            },
            {
              label: 'Total assessments',
              value: <span className="tabular-nums">{attempts.length}</span>,
            },
            {
              label: 'Total skills',
              value: <span className="tabular-nums">{skills.length}</span>,
            },
            {
              label: 'Expiring soon',
              value: <span className="tabular-nums">{expiring.length}</span>,
            },
          ]}
        />

        {expiring.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <FileText size={16} className="inline" /> Expiring within {EXPIRING_WINDOW_DAYS}{' '}
                days
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-slate-100 text-sm">
                {expiring.map((row) => {
                  const days = row.rec.expiresOn
                    ? Math.round(
                        (new Date(row.rec.expiresOn).getTime() - today.getTime()) / 86_400_000,
                      )
                    : null
                  return (
                    <li
                      key={row.rec.id}
                      className="flex items-center justify-between py-2"
                    >
                      <span>
                        <Link
                          href={`/training/courses/${row.course.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {row.course.name}
                        </Link>
                        <span className="ml-2 text-xs text-slate-500">
                          expires {row.rec.expiresOn}
                        </span>
                      </span>
                      {days !== null ? (
                        <Badge variant={days < 14 ? 'destructive' : 'warning'}>
                          {days}d left
                        </Badge>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>
              <BookOpen size={16} className="inline" /> Training records ({records.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {records.length === 0 ? (
              <p className="text-sm text-slate-500">No training records.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Course</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Grade</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Instructor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((row) => {
                    const exp = row.rec.expiresOn ? new Date(row.rec.expiresOn) : null
                    const days = exp
                      ? Math.round((exp.getTime() - today.getTime()) / 86_400_000)
                      : null
                    return (
                      <TableRow key={row.rec.id}>
                        <TableCell>
                          <Link
                            href={`/training/courses/${row.course.id}`}
                            className="font-medium text-slate-900 hover:underline"
                          >
                            {row.course.name}
                          </Link>
                        </TableCell>
                        <TableCell className="tabular-nums">{row.rec.completedOn}</TableCell>
                        <TableCell className="tabular-nums">
                          {row.rec.expiresOn ?? '—'}{' '}
                          {days != null && days < 0 ? (
                            <Badge variant="destructive">Expired</Badge>
                          ) : days != null && days <= 30 ? (
                            <Badge variant="warning">{days}d</Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {row.rec.grade != null ? `${row.rec.grade}%` : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {row.rec.source.replace('_', ' ')}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {row.rec.instructor ?? '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <ClipboardCheck size={16} className="inline" /> Assessments ({attempts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {attempts.length === 0 ? (
              <p className="text-sm text-slate-500">No assessment attempts.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attempts.map(({ a, t }) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Link
                          href={`/training/assessments/${a.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {t.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {a.completedAt
                          ? new Date(a.completedAt).toLocaleDateString()
                          : new Date(a.startedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {a.score != null ? `${a.score}%` : '—'}
                      </TableCell>
                      <TableCell>
                        {a.status === 'in_progress' ? (
                          <Badge variant="secondary">In progress</Badge>
                        ) : a.status === 'cancelled' ? (
                          <Badge variant="outline">Cancelled</Badge>
                        ) : a.passed ? (
                          <Badge variant="success">Pass</Badge>
                        ) : (
                          <Badge variant="destructive">Fail</Badge>
                        )}
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
            <CardTitle>
              <Award size={16} className="inline" /> Skills & certifications ({skills.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {skills.length === 0 ? (
              <p className="text-sm text-slate-500">No skills awarded.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Skill</TableHead>
                    <TableHead>Authority</TableHead>
                    <TableHead>Granted</TableHead>
                    <TableHead>Expires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {skills.map(({ sk, type, auth }) => {
                    const expDays = sk.expiresOn
                      ? Math.round(
                          (new Date(sk.expiresOn).getTime() - today.getTime()) / 86_400_000,
                        )
                      : null
                    return (
                      <TableRow key={sk.id}>
                        <TableCell>
                          <Link
                            href={`/training/skills/types/${type.id}`}
                            className="font-medium text-slate-900 hover:underline"
                          >
                            {type.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-slate-600">{auth.name}</TableCell>
                        <TableCell className="tabular-nums">{sk.grantedOn}</TableCell>
                        <TableCell className="tabular-nums">
                          {sk.expiresOn ?? '—'}{' '}
                          {expDays != null && expDays < 0 ? (
                            <Badge variant="destructive">Expired</Badge>
                          ) : expDays != null && expDays <= 90 ? (
                            <Badge variant="warning">{expDays}d</Badge>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-slate-400">
          Print produces a hard-copy transcript; use the browser's "Save as PDF" option to keep
          the file. Suppression: try View → Headers and footers off for a cleaner result.
        </p>
      </div>
    </PageContainer>
  )
}

