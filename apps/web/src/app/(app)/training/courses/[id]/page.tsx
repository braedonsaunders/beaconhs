import Link from 'next/link'
import { notFound } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { GraduationCap } from 'lucide-react'
import {
  Badge,
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
  people,
  trainingClasses,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { DetailGrid } from '@/components/detail-grid'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Course · ${id.slice(0, 8)}` }
}

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [course] = await tx.select().from(trainingCourses).where(eq(trainingCourses.id, id)).limit(1)
    if (!course) return null
    const records = await tx
      .select({ record: trainingRecords, person: people })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .where(eq(trainingRecords.courseId, id))
      .orderBy(desc(trainingRecords.completedOn))
    const classes = await tx
      .select()
      .from(trainingClasses)
      .where(eq(trainingClasses.courseId, id))
      .orderBy(desc(trainingClasses.startsAt))
    return { course, records, classes }
  })

  if (!data) notFound()
  const { course, records, classes } = data
  const today = new Date()

  return (
    <div className="space-y-5">
      <DetailHeader
        back={{ href: '/training', label: 'Back to training' }}
        title={course.name}
        subtitle={course.code}
        badge={<Badge variant="secondary">{course.deliveryType.replace('_', ' ')}</Badge>}
      />

      <DetailGrid
        rows={[
          { label: 'Code', value: course.code },
          { label: 'Delivery', value: course.deliveryType.replace('_', ' ') },
          { label: 'Duration', value: course.durationMinutes ? `${course.durationMinutes} min` : '—' },
          { label: 'Valid for', value: course.validForMonths ? `${course.validForMonths} months` : 'no expiry' },
          { label: 'Requires evaluator', value: course.requiresEvaluator ? 'Yes' : 'No' },
        ]}
      />

      {course.description ? (
        <Card>
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{course.description}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Records ({records.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <EmptyState icon={<GraduationCap size={24} />} title="Nobody has completed this course yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Grade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((row) => {
                  const exp = row.record.expiresOn ? new Date(row.record.expiresOn) : null
                  const daysLeft = exp ? Math.round((exp.getTime() - today.getTime()) / 86_400_000) : null
                  return (
                    <TableRow key={row.record.id}>
                      <TableCell>
                        <Link href={`/people/${row.person.id}`} className="font-medium text-slate-900 hover:underline">
                          {row.person.lastName}, {row.person.firstName}
                        </Link>
                      </TableCell>
                      <TableCell>{row.record.completedOn}</TableCell>
                      <TableCell>{row.record.expiresOn ?? '—'}</TableCell>
                      <TableCell>
                        {daysLeft === null ? (
                          <Badge variant="secondary">No expiry</Badge>
                        ) : daysLeft < 0 ? (
                          <Badge variant="destructive">Expired</Badge>
                        ) : daysLeft <= 30 ? (
                          <Badge variant="warning">{daysLeft}d left</Badge>
                        ) : (
                          <Badge variant="success">Valid</Badge>
                        )}
                      </TableCell>
                      <TableCell>{row.record.grade != null ? `${row.record.grade}%` : '—'}</TableCell>
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
          <CardTitle>Scheduled classes ({classes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {classes.length === 0 ? (
            <p className="text-sm text-slate-500">No classes scheduled.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {classes.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2">
                  <span className="font-medium">{c.title}</span>
                  <span className="text-xs text-slate-500">
                    {new Date(c.startsAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
