import Link from 'next/link'
import { GraduationCap } from 'lucide-react'
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@beaconhs/ui'
import { people, trainingCourses, trainingRecords } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Training' }

export default async function TrainingPage() {
  const ctx = await requireRequestContext()
  const today = new Date().toISOString().slice(0, 10)

  const [courses, recentRecords, expiring] = await ctx.db(async (tx) => {
    const c = await tx.select().from(trainingCourses).orderBy(asc(trainingCourses.name))
    const r = await tx
      .select({
        record: trainingRecords,
        person: people,
        course: trainingCourses,
      })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .orderBy(sql`${trainingRecords.completedOn} desc`)
      .limit(50)
    const e = await tx
      .select({
        record: trainingRecords,
        person: people,
        course: trainingCourses,
      })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(
        and(
          isNotNull(trainingRecords.expiresOn),
          sql`${trainingRecords.expiresOn} <= (${today}::date + interval '90 days')`,
        ),
      )
      .orderBy(asc(trainingRecords.expiresOn))
      .limit(20)
    return [c, r, e] as const
  })

  return (
    <PageContainer>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Training</h1>
          <p className="text-sm text-slate-500">
            Courses, records, classes, certificates, and expiry tracking. Skill authorities + skill types live in Library.
          </p>
        </header>

        <nav className="flex flex-wrap items-center gap-2">
          <Link
            href="/training"
            className="rounded-full border border-teal-500 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700"
          >
            Records
          </Link>
          <Link
            href="/training/courses"
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
          >
            Courses
          </Link>
          <Link
            href="/training/classes"
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
          >
            Classes
          </Link>
          <Link
            href="/training/authorities"
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
          >
            Skill authorities
          </Link>
          <Link
            href="/training/skills"
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
          >
            Skill types
          </Link>
        </nav>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Course catalogue ({courses.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {courses.length === 0 ? (
                <EmptyState icon={<GraduationCap size={24} />} title="No courses yet" />
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {courses.map((c) => (
                    <li key={c.id} className="flex items-center justify-between py-2">
                      <div>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-slate-500">
                          {c.code} · {c.deliveryType.replace('_', ' ')}
                          {c.validForMonths ? ` · valid ${c.validForMonths}mo` : ''}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Expiring within 90 days ({expiring.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {expiring.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing expiring soon. Nice.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {expiring.map((row) => {
                    const exp = row.record.expiresOn ? new Date(row.record.expiresOn) : null
                    const days = exp
                      ? Math.round((exp.getTime() - Date.now()) / (24 * 3600 * 1000))
                      : null
                    return (
                      <li key={row.record.id} className="flex items-center justify-between py-2">
                        <div>
                          <div className="font-medium">
                            {row.person.firstName} {row.person.lastName}
                          </div>
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
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent records ({recentRecords.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {recentRecords.length === 0 ? (
              <EmptyState icon={<GraduationCap size={24} />} title="No training records yet" />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {recentRecords.slice(0, 10).map((row) => (
                  <li key={row.record.id} className="flex items-center justify-between py-2">
                    <div>
                      <span className="font-medium">
                        {row.person.firstName} {row.person.lastName}
                      </span>
                      {' · '}
                      <span>{row.course.name}</span>
                    </div>
                    <span className="text-xs text-slate-500">{row.record.completedOn}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
