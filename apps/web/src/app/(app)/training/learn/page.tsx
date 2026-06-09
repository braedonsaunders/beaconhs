import Link from 'next/link'
import { asc, count, eq, isNull } from 'drizzle-orm'
import { GraduationCap } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
} from '@beaconhs/ui'
import {
  people,
  trainingCourseModules,
  trainingCourses,
  trainingEnrollments,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'

export const metadata = { title: 'My Learning' }
export const dynamic = 'force-dynamic'

export default async function MyLearningPage() {
  const ctx = await requireRequestContext()

  const { courses, enrollByCourse } = await ctx.db(async (tx) => {
    const modCounts = await tx
      .select({ courseId: trainingCourseModules.courseId, n: count() })
      .from(trainingCourseModules)
      .where(isNull(trainingCourseModules.deletedAt))
      .groupBy(trainingCourseModules.courseId)
    const withContent = new Set(modCounts.filter((m) => m.n > 0).map((m) => m.courseId))

    const all = await tx
      .select()
      .from(trainingCourses)
      .where(isNull(trainingCourses.deletedAt))
      .orderBy(asc(trainingCourses.name))
    const courses = all.filter((c) => withContent.has(c.id))

    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.userId, ctx.userId))
      .limit(1)

    const enrollByCourse = new Map<string, { status: string; percent: number; recordId: string | null }>()
    if (person) {
      const rows = await tx
        .select()
        .from(trainingEnrollments)
        .where(eq(trainingEnrollments.personId, person.id))
      for (const e of rows) {
        enrollByCourse.set(e.courseId, {
          status: e.status,
          percent: e.progressPercent,
          recordId: e.recordId,
        })
      }
    }
    return { courses, enrollByCourse }
  })

  return (
    <ListPageLayout
      header={
        <PageHeader
          title="My Learning"
          description="Courses available to you, and your progress through each."
        />
      }
    >
      {courses.length === 0 ? (
        <EmptyState
          icon={<GraduationCap size={24} />}
          title="No courses available yet"
          description="Once a course has published content it will appear here."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => {
            const e = enrollByCourse.get(c.id)
            const label =
              e?.status === 'completed' ? 'Review' : e ? `Continue · ${e.percent}%` : 'Start'
            return (
              <Card key={c.id} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col gap-3 py-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-slate-900">{c.name}</h3>
                      <p className="text-xs text-slate-500">{c.code}</p>
                    </div>
                    {e?.status === 'completed' ? (
                      <Badge variant="success">Completed</Badge>
                    ) : e ? (
                      <Badge variant="secondary">In progress</Badge>
                    ) : (
                      <Badge variant="outline">{c.deliveryType.replace('_', ' ')}</Badge>
                    )}
                  </div>

                  {c.description ? (
                    <p className="line-clamp-2 text-sm text-slate-600">{c.description}</p>
                  ) : null}

                  {e ? (
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-teal-500"
                        style={{ width: `${e.percent}%` }}
                      />
                    </div>
                  ) : null}

                  <div className="mt-auto pt-1">
                    <Link href={`/training/learn/${c.id}`}>
                      <Button variant={e?.status === 'completed' ? 'outline' : 'default'} className="w-full">
                        {label}
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </ListPageLayout>
  )
}
