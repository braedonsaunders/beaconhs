import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, count, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import {
  Ban,
  Check,
  GraduationCap,
  Plus,
  Presentation,
  RotateCcw,
  Trash2,
  UserCheck,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Input,
} from '@beaconhs/ui'
import {
  departments,
  orgUnits,
  people,
  tenantUsers,
  trainingAssessments,
  trainingClasses,
  trainingClassAttendees,
  trainingCourses,
  trainingLessons,
  trainingRecords,
  users,
} from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { formatDateTime } from '@/lib/datetime'
import { recordAudit } from '@/lib/audit'
import { runModuleFlows } from '@/lib/flows/run-module-flows'
import { emitTrainingClassCompleted } from '@beaconhs/integrations'
import { isUuid } from '@/lib/list-params'
import { PersonSelectField } from '@/components/person-select-field'
import { addMonthsIso } from '../../_lib/dates'
import { ClassDetailFields } from '../_class-fields'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { DetailPageLayout } from '@/components/page-layout'
import { cancelClass, deleteClass, reopenClass, updateClassField } from '../_actions'
import { DeleteClassButton } from './_delete-class-button'

export const dynamic = 'force-dynamic'

const TABS = ['details', 'roster', 'completion'] as const
type Tab = (typeof TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Training class · ${id.slice(0, 8)}` }
}

// ---------- Server actions ----------

async function addClassAttendee(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  // Editing a class roster is a class-management mutation; the page render gate
  // does not protect this POST endpoint.
  assertCan(ctx, 'training.class.manage')
  const classId = String(formData.get('classId') ?? '')
  const personId = String(formData.get('personId') ?? '')
  if (!classId || !personId) return

  await ctx.db(async (tx) => {
    const existing = await tx
      .select({ id: trainingClassAttendees.id })
      .from(trainingClassAttendees)
      .where(
        and(
          eq(trainingClassAttendees.classId, classId),
          eq(trainingClassAttendees.personId, personId),
        ),
      )
      .limit(1)
    if (existing.length > 0) return
    await tx.insert(trainingClassAttendees).values({
      tenantId: ctx.tenantId,
      classId,
      personId,
      status: 'registered',
    })
  })
  await recordAudit(ctx, {
    entityType: 'training_class',
    entityId: classId,
    action: 'update',
    summary: 'Added attendee to class',
    after: { personId },
  })
  revalidatePath(`/training/classes/${classId}`)
}

async function removeClassAttendee(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'training.class.manage')
  const classId = String(formData.get('classId') ?? '')
  const personId = String(formData.get('personId') ?? '')
  if (!classId || !personId) return

  await ctx.db((tx) =>
    tx
      .delete(trainingClassAttendees)
      .where(
        and(
          eq(trainingClassAttendees.classId, classId),
          eq(trainingClassAttendees.personId, personId),
        ),
      ),
  )
  await recordAudit(ctx, {
    entityType: 'training_class',
    entityId: classId,
    action: 'update',
    summary: 'Removed attendee from class',
    before: { personId },
  })
  revalidatePath(`/training/classes/${classId}`)
}

async function markClassComplete(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  // Completing a class mints training_records for the roster — a privileged
  // write. Without this gate any authenticated tenant user could POST here and
  // issue training records for arbitrary people.
  assertCan(ctx, 'training.class.manage')
  const classId = String(formData.get('classId') ?? '')
  if (!classId) return

  const completed = await ctx.db(async (tx) => {
    const [cls] = await tx
      .select()
      .from(trainingClasses)
      .where(eq(trainingClasses.id, classId))
      .limit(1)
    if (!cls) return null
    // Idempotency: a re-POST (double-click, stale tab, direct request) must not
    // mint a second set of training records for the whole roster.
    if (cls.completedAt) throw new Error('Class is already complete')
    if (cls.cancelledAt) throw new Error('Class is cancelled — reopen it before marking completion')
    const [course] = await tx
      .select()
      .from(trainingCourses)
      .where(eq(trainingCourses.id, cls.courseId))
      .limit(1)
    if (!course) return null

    // Only people actually on the roster are processed — form field names are
    // caller-controlled and must not create records for arbitrary personIds.
    const roster = await tx
      .select({ personId: trainingClassAttendees.personId })
      .from(trainingClassAttendees)
      .where(eq(trainingClassAttendees.classId, classId))

    // Field names are attended__<personId>, grade__<personId>, passed__<personId>.
    const attendeeGrades = roster.map(({ personId }) => {
      const raw = String(formData.get(`grade__${personId}`) ?? '').trim()
      let grade: number | null = null
      if (raw) {
        const n = Number.parseInt(raw, 10)
        if (Number.isNaN(n)) throw new Error('Grades must be whole numbers between 0 and 100')
        grade = Math.max(0, Math.min(100, n))
      }
      const attended = formData.get(`attended__${personId}`) === 'on'
      // Passing requires attendance — a no-show cannot earn a training record.
      const passed = attended && formData.get(`passed__${personId}`) === 'on'
      return { personId, grade, attended, passed }
    })

    const completedOn = (cls.endsAt ?? new Date()).toISOString().slice(0, 10)
    const expiresOn = course.validForMonths
      ? addMonthsIso(completedOn, course.validForMonths)
      : null

    for (const ag of attendeeGrades) {
      // Attendance and pass state are separate: someone who sat the class but
      // failed is still "attended" — they just don't get a training record.
      await tx
        .update(trainingClassAttendees)
        .set({ status: ag.attended ? 'attended' : 'no_show' })
        .where(
          and(
            eq(trainingClassAttendees.classId, classId),
            eq(trainingClassAttendees.personId, ag.personId),
          ),
        )
      if (ag.passed) {
        await tx.insert(trainingRecords).values({
          tenantId: ctx.tenantId,
          personId: ag.personId,
          courseId: course.id,
          source: 'class',
          classId,
          grade: ag.grade,
          completedOn,
          expiresOn,
          issuedByTenantUserId: ctx.membership?.id ?? null,
        })
      }
    }

    await tx
      .update(trainingClasses)
      .set({ completedAt: new Date() })
      .where(eq(trainingClasses.id, classId))
    return { cls, course, attendeeGrades }
  })
  if (!completed) return

  await recordAudit(ctx, {
    entityType: 'training_class',
    entityId: classId,
    action: 'update',
    summary: 'Marked class complete',
    after: {
      count: completed.attendeeGrades.length,
      attended: completed.attendeeGrades.filter((a) => a.attended).length,
      passed: completed.attendeeGrades.filter((a) => a.passed).length,
    },
  })

  // Emit a generic completion event for any enabled outbound integration
  // (e.g. exporting training time to an external SQL system). Best-effort: an
  // integration must never break class completion.
  if (completed) {
    try {
      const { cls, course, attendeeGrades } = completed
      const attendedByPerson = new Map(attendeeGrades.map((a) => [a.personId, a.attended]))
      const startsAt = new Date(cls.startsAt)
      const endsAt = new Date(cls.endsAt)
      const startDay = Date.UTC(
        startsAt.getUTCFullYear(),
        startsAt.getUTCMonth(),
        startsAt.getUTCDate(),
      )
      const endDay = Date.UTC(endsAt.getUTCFullYear(), endsAt.getUTCMonth(), endsAt.getUTCDate())
      const spanDays = Math.max(1, Math.round((endDay - startDay) / 86_400_000) + 1)
      const lengthDays = cls.lengthDays ?? spanDays
      const hoursPerDay =
        cls.hoursPerDay != null
          ? Number(cls.hoursPerDay)
          : spanDays === 1
            ? Math.max(0, (endsAt.getTime() - startsAt.getTime()) / 3_600_000)
            : 8
      const roster = await ctx.db((tx) =>
        tx
          .select({
            personId: people.id,
            externalEmployeeId: people.externalEmployeeId,
            firstName: people.firstName,
            lastName: people.lastName,
            departmentName: departments.name,
          })
          .from(trainingClassAttendees)
          .innerJoin(people, eq(people.id, trainingClassAttendees.personId))
          .leftJoin(departments, eq(departments.id, people.departmentId))
          .where(eq(trainingClassAttendees.classId, classId)),
      )
      await emitTrainingClassCompleted(ctx, {
        classId,
        course: { code: course.code, name: course.name },
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        hoursPerDay,
        lengthDays,
        attendees: roster.map((r) => {
          const attended = attendedByPerson.get(r.personId) ?? false
          return {
            personId: r.personId,
            externalEmployeeId: r.externalEmployeeId,
            firstName: r.firstName,
            lastName: r.lastName,
            departmentName: r.departmentName,
            attended,
            hours: attended ? hoursPerDay * lengthDays : 0,
          }
        }),
      })
    } catch {
      // Swallow — completion already succeeded.
    }
  }

  await runModuleFlows(ctx, {
    moduleKey: 'training-classes',
    event: 'status_change',
    subjectId: classId,
    toStatus: 'completed',
  })

  revalidatePath(`/training/classes/${classId}`)
  revalidatePath('/training/classes')
  revalidatePath('/training')
}

// ---------- Page ----------

export default async function TrainingClassPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  // Guard non-UUID segments (e.g. a stale /classes/new link) — the id column is
  // a uuid, so a bad value would throw at the DB instead of a clean 404.
  if (!isUuid(id)) notFound()
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'details')
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [cls] = await tx.select().from(trainingClasses).where(eq(trainingClasses.id, id)).limit(1)
    if (!cls) return null
    const [course] = await tx
      .select()
      .from(trainingCourses)
      .where(eq(trainingCourses.id, cls.courseId))
      .limit(1)
    const attendees = await tx
      .select({ att: trainingClassAttendees, person: people })
      .from(trainingClassAttendees)
      .innerJoin(people, eq(people.id, trainingClassAttendees.personId))
      .where(eq(trainingClassAttendees.classId, id))
      .orderBy(asc(people.lastName), asc(people.firstName))
    const memberIds = attendees.map((a) => a.person.id)
    const availablePeople =
      memberIds.length > 0
        ? await tx
            .select({
              id: people.id,
              firstName: people.firstName,
              lastName: people.lastName,
              jobTitle: people.jobTitle,
              employeeNo: people.employeeNo,
            })
            .from(people)
            .where(and(eq(people.status, 'active'), notInArray(people.id, memberIds)))
            .orderBy(asc(people.lastName), asc(people.firstName))
            .limit(500)
        : await tx
            .select({
              id: people.id,
              firstName: people.firstName,
              lastName: people.lastName,
              jobTitle: people.jobTitle,
              employeeNo: people.employeeNo,
            })
            .from(people)
            .where(eq(people.status, 'active'))
            .orderBy(asc(people.lastName), asc(people.firstName))
            .limit(500)
    // Lookups for the auto-saving course / site / instructor fields.
    const [courses, sites, instructors] = await Promise.all([
      tx
        .select({ id: trainingCourses.id, name: trainingCourses.name, code: trainingCourses.code })
        .from(trainingCourses)
        .where(isNull(trainingCourses.deletedAt))
        .orderBy(asc(trainingCourses.name)),
      tx
        .select({ id: orgUnits.id, name: orgUnits.name })
        .from(orgUnits)
        .where(eq(orgUnits.level, 'site'))
        .orderBy(asc(orgUnits.name)),
      tx
        .select({
          id: tenantUsers.id,
          name: users.name,
          displayName: tenantUsers.displayName,
          email: users.email,
        })
        .from(tenantUsers)
        .leftJoin(users, eq(users.id, tenantUsers.userId))
        .where(eq(tenantUsers.status, 'active')),
    ])
    // Does the course have in-app content to present in the classroom?
    const [lessonCount] = await tx
      .select({ c: count() })
      .from(trainingLessons)
      .where(and(eq(trainingLessons.courseId, cls.courseId), isNull(trainingLessons.deletedAt)))

    // Pre-fill the completion grades from each attendee's own quiz result: the
    // assessment type(s) this course's quiz lessons point at, then each
    // attendee's best submitted attempt. Instructors can still override.
    const quizTypeIds = [
      ...new Set(
        (
          await tx
            .select({ typeId: trainingLessons.assessmentTypeId })
            .from(trainingLessons)
            .where(
              and(
                eq(trainingLessons.courseId, cls.courseId),
                eq(trainingLessons.kind, 'quiz'),
                isNull(trainingLessons.deletedAt),
              ),
            )
        )
          .map((r) => r.typeId)
          .filter((x): x is string => !!x),
      ),
    ]
    const quizByPerson = new Map<string, { score: number | null; passed: boolean }>()
    if (quizTypeIds.length > 0 && memberIds.length > 0) {
      const attempts = await tx
        .select({
          personId: trainingAssessments.personId,
          score: trainingAssessments.score,
          passed: trainingAssessments.passed,
        })
        .from(trainingAssessments)
        .where(
          and(
            inArray(trainingAssessments.typeId, quizTypeIds),
            inArray(trainingAssessments.personId, memberIds),
            eq(trainingAssessments.status, 'submitted'),
            isNull(trainingAssessments.deletedAt),
          ),
        )
      // Keep each person's best-scoring attempt (its pass state travels with it).
      for (const a of attempts) {
        const prev = quizByPerson.get(a.personId)
        const score = a.score ?? null
        if (!prev || (score != null && (prev.score == null || score > prev.score))) {
          quizByPerson.set(a.personId, { score, passed: !!a.passed })
        }
      }
    }

    return {
      cls,
      course,
      attendees,
      availablePeople,
      courses,
      sites,
      instructors,
      hasContent: Number(lessonCount?.c ?? 0) > 0,
      hasQuiz: quizTypeIds.length > 0,
      quizByPerson,
    }
  })

  if (!data) notFound()
  const {
    cls,
    course,
    attendees,
    availablePeople,
    courses,
    sites,
    instructors,
    hasContent,
    hasQuiz,
    quizByPerson,
  } = data
  // Keep the class's current course selectable even if it was soft-deleted from
  // the catalogue after scheduling (the option list only carries live courses).
  const courseOptions =
    course && !courses.some((c) => c.id === course.id)
      ? [{ id: course.id, name: course.name, code: course.code }, ...courses]
      : courses
  // Managing a class (roster edits, completion, lifecycle, field edits) requires
  // training.class.manage — mirrors the assertCan in every class mutation. A
  // viewer without it sees the class read-only.
  const canManageClasses = can(ctx, 'training.class.manage')
  const basePath = `/training/classes/${id}`
  const startsAt = new Date(cls.startsAt)
  const endsAt = new Date(cls.endsAt)
  const isCompleted = !!cls.completedAt
  const isCancelled = !!cls.cancelledAt
  const inPast = endsAt < new Date()
  const cancelAction = cancelClass.bind(null, id)
  const reopenAction = reopenClass.bind(null, id)
  const deleteAction = deleteClass.bind(null, id)

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/training/classes', label: 'Back to classes' }}
          title={cls.title}
          subtitle={`${course?.name ?? 'Course'} · ${formatDateTime(startsAt, ctx.timezone)}`}
          badge={
            isCancelled ? (
              <Badge variant="destructive">Cancelled</Badge>
            ) : isCompleted ? (
              <Badge variant="success">Completed</Badge>
            ) : inPast ? (
              <Badge variant="warning">Awaiting completion</Badge>
            ) : (
              <Badge variant="secondary">Scheduled</Badge>
            )
          }
          actions={
            !canManageClasses ? null : (
              <div className="flex items-center gap-2">
                {hasContent ? (
                  <Link
                    href={`/training/courses/${cls.courseId}/present?from=${encodeURIComponent(basePath)}`}
                  >
                    <Button size="sm">
                      <Presentation size={14} /> Present content
                    </Button>
                  </Link>
                ) : null}
                {isCompleted ? null : (
                  <>
                    {isCancelled ? (
                      <form action={reopenAction}>
                        <Button type="submit" variant="outline" size="sm">
                          <RotateCcw size={14} /> Reopen class
                        </Button>
                      </form>
                    ) : (
                      <form action={cancelAction}>
                        <Button type="submit" variant="outline" size="sm">
                          <Ban size={14} /> Cancel class
                        </Button>
                      </form>
                    )}
                    <form action={deleteAction}>
                      <DeleteClassButton />
                    </form>
                  </>
                )}
              </div>
            )
          }
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'details', label: 'Details' },
            { key: 'roster', label: 'Roster', count: attendees.length },
            { key: 'completion', label: 'Completion' },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'details' ? (
          <ClassDetailFields
            id={id}
            initial={{
              courseId: cls.courseId,
              title: cls.title,
              startsAt: toLocalInput(startsAt),
              endsAt: toLocalInput(endsAt),
              siteOrgUnitId: cls.siteOrgUnitId,
              instructorTenantUserId: cls.instructorTenantUserId,
              capacity: cls.capacity != null ? String(cls.capacity) : null,
              notes: cls.notes,
            }}
            options={{ courses: courseOptions, sites, instructors }}
            disabled={isCompleted || !canManageClasses}
            courseHref={course ? `/training/courses/${course.id}` : null}
            notice={
              isCompleted ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  This class is complete — details are locked. Training records have been issued
                  from the roster.
                </p>
              ) : !canManageClasses ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  You have read-only access to this class. Managing classes requires the Manage
                  classes permission.
                </p>
              ) : null
            }
            updateAction={updateClassField}
          />
        ) : null}

        {active === 'roster' ? (
          <Card>
            <CardHeader>
              <CardTitle>Roster ({attendees.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isCompleted && canManageClasses ? (
                availablePeople.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Every active person is already on this roster.
                  </p>
                ) : (
                  <form
                    action={addClassAttendee}
                    className="flex items-end gap-2 border-b border-slate-100 pb-4 dark:border-slate-800"
                  >
                    <input type="hidden" name="classId" value={id} />
                    <div className="min-w-0 flex-1">
                      <PersonSelectField
                        name="personId"
                        defaultValue=""
                        clearable={false}
                        placeholder="Add a person to the roster…"
                        options={availablePeople.map((p) => ({
                          value: p.id,
                          label: `${p.lastName}, ${p.firstName}`,
                          hint: p.employeeNo ?? undefined,
                        }))}
                      />
                    </div>
                    <Button type="submit">
                      <Plus size={14} /> Add
                    </Button>
                  </form>
                )
              ) : null}
              {attendees.length === 0 ? (
                <EmptyState
                  icon={<UserCheck size={24} />}
                  title="No attendees registered"
                  description={
                    isCompleted
                      ? 'No one was rostered for this class.'
                      : 'Add people above to build the roster.'
                  }
                />
              ) : (
                <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                  {attendees.map((row) => (
                    <li key={row.att.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <Link
                          href={`/people/${row.person.id}`}
                          className="font-medium hover:underline"
                        >
                          {row.person.lastName}, {row.person.firstName}
                        </Link>
                        {row.person.jobTitle ? (
                          <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                            {row.person.jobTitle}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{row.att.status}</Badge>
                        {!isCompleted && canManageClasses ? (
                          <form action={removeClassAttendee} className="inline">
                            <input type="hidden" name="classId" value={id} />
                            <input type="hidden" name="personId" value={row.person.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              aria-label="Remove from roster"
                            >
                              <Trash2 size={14} className="text-red-500" />
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        {active === 'completion' ? (
          <Card>
            <CardHeader>
              <CardTitle>Mark completion</CardTitle>
            </CardHeader>
            <CardContent>
              {isCompleted ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Class was marked complete on{' '}
                  {formatDateTime(new Date(cls.completedAt!), ctx.timezone)}. Training records have
                  been created for everyone who passed.
                </p>
              ) : !canManageClasses ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  You have read-only access to this class. Marking completion and issuing training
                  records requires the Manage classes permission.
                </p>
              ) : attendees.length === 0 ? (
                <EmptyState
                  icon={<GraduationCap size={24} />}
                  title="No attendees"
                  description="Add attendees on the Roster tab before marking completion."
                />
              ) : (
                <form action={markClassComplete} className="space-y-3 text-sm">
                  <input type="hidden" name="classId" value={id} />
                  <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-800">
                        <tr className="text-left text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                          <th className="px-3 py-2">Person</th>
                          <th className="w-24 px-3 py-2 text-center">Attended</th>
                          <th className="w-24 px-3 py-2">Grade %</th>
                          <th className="w-20 px-3 py-2 text-center">Passed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                        {attendees.map((row) => {
                          const quiz = quizByPerson.get(row.person.id)
                          return (
                            <tr key={row.att.id}>
                              <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                                {row.person.lastName}, {row.person.firstName}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <input
                                  type="checkbox"
                                  name={`attended__${row.person.id}`}
                                  defaultChecked
                                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  name={`grade__${row.person.id}`}
                                  type="number"
                                  min="0"
                                  max="100"
                                  placeholder="—"
                                  defaultValue={quiz?.score != null ? String(quiz.score) : ''}
                                />
                                {quiz ? (
                                  <span
                                    className={`mt-1 block text-[11px] ${
                                      quiz.passed
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-amber-600 dark:text-amber-400'
                                    }`}
                                  >
                                    Quiz {quiz.score != null ? `${quiz.score}%` : '—'} ·{' '}
                                    {quiz.passed ? 'passed' : 'did not pass'}
                                  </span>
                                ) : hasQuiz ? (
                                  <span className="mt-1 block text-[11px] text-slate-400 dark:text-slate-500">
                                    No quiz attempt yet
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <input
                                  type="checkbox"
                                  name={`passed__${row.person.id}`}
                                  defaultChecked={quiz ? quiz.passed : true}
                                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
                                />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Uncheck "Attended" for no-shows. Checking "Passed" creates a training record for
                    the person; grades are optional.
                    {hasQuiz
                      ? ' Grades and pass state are pre-filled from each person’s best quiz attempt — adjust any before completing.'
                      : ''}
                  </p>
                  <div className="flex justify-end">
                    <Button type="submit">
                      <Check size={14} /> Mark class complete
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </DetailPageLayout>
  )
}

// datetime-local needs a tz-naive "YYYY-MM-DDTHH:mm" string. Format in the
// server's local tz to round-trip with how the update action parses it back.
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
