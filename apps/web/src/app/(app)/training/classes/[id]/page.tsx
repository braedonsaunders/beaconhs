import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, notInArray } from 'drizzle-orm'
import { Ban, Check, GraduationCap, Plus, RotateCcw, Trash2, UserCheck } from 'lucide-react'
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
  trainingClasses,
  trainingClassAttendees,
  trainingCourses,
  trainingRecords,
  users,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { runIntegrations, type TrainingClassCompletedEvent } from '@/lib/integrations'
import { PersonSelectField } from '@/components/person-select-field'
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
  const classId = String(formData.get('classId') ?? '')
  if (!classId) return

  // Pull all entries from the form. Field names are:
  //   grade__<personId>, passed__<personId>
  const attendeeGrades: { personId: string; grade: number | null; passed: boolean }[] = []
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('grade__')) {
      const personId = key.slice('grade__'.length)
      const raw = String(value ?? '').trim()
      const grade = raw ? Number(raw) : null
      const passed = formData.get(`passed__${personId}`) === 'on'
      attendeeGrades.push({ personId, grade, passed })
    }
  }

  const completed = await ctx.db(async (tx) => {
    const [cls] = await tx
      .select()
      .from(trainingClasses)
      .where(eq(trainingClasses.id, classId))
      .limit(1)
    if (!cls) return null
    const [course] = await tx
      .select()
      .from(trainingCourses)
      .where(eq(trainingCourses.id, cls.courseId))
      .limit(1)
    if (!course) return null
    const completedOn = (cls.endsAt ?? new Date()).toISOString().slice(0, 10)
    const expiresOn = course.validForMonths
      ? (() => {
          const d = new Date(cls.endsAt ?? new Date())
          d.setMonth(d.getMonth() + course.validForMonths!)
          return d.toISOString().slice(0, 10)
        })()
      : null

    for (const ag of attendeeGrades) {
      // Update attendee row.
      await tx
        .update(trainingClassAttendees)
        .set({ status: ag.passed ? 'attended' : 'no_show' })
        .where(
          and(
            eq(trainingClassAttendees.classId, classId),
            eq(trainingClassAttendees.personId, ag.personId),
          ),
        )
      // Only write a training record if they actually passed (or there's no grade and the box is checked).
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
    return { cls, course }
  })

  await recordAudit(ctx, {
    entityType: 'training_class',
    entityId: classId,
    action: 'update',
    summary: 'Marked class complete',
    after: {
      count: attendeeGrades.length,
      passed: attendeeGrades.filter((a) => a.passed).length,
    },
  })

  // Emit a generic completion event for any enabled outbound integration
  // (e.g. the adminapp2 training-time export). Best-effort: an integration must
  // never break class completion.
  if (completed) {
    try {
      const { cls, course } = completed
      const passedByPerson = new Map(attendeeGrades.map((a) => [a.personId, a.passed]))
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
      const event: TrainingClassCompletedEvent = {
        type: 'training.class.completed',
        tenantId: ctx.tenantId,
        classId,
        course: { code: course.code, name: course.name },
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        hoursPerDay,
        lengthDays,
        attendees: roster.map((r) => {
          const attended = passedByPerson.get(r.personId) ?? false
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
      }
      await runIntegrations(ctx, event)
    } catch {
      // Swallow — completion already succeeded.
    }
  }

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
    return { cls, course, attendees, availablePeople, courses, sites, instructors }
  })

  if (!data) notFound()
  const { cls, course, attendees, availablePeople, courses, sites, instructors } = data
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
          subtitle={`${course?.name ?? 'Course'} · ${startsAt.toLocaleString()}`}
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
            isCompleted ? null : (
              <div className="flex items-center gap-2">
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
            options={{ courses, sites, instructors }}
            disabled={isCompleted}
            courseHref={course ? `/training/courses/${course.id}` : null}
            notice={
              isCompleted ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  This class is complete — details are locked. Training records have been issued
                  from the roster.
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
              {!isCompleted ? (
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
                        {!isCompleted ? (
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
                  Class was marked complete on {new Date(cls.completedAt!).toLocaleString()}.
                  Training records have been created for everyone who passed.
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
                          <th className="w-24 px-3 py-2">Grade %</th>
                          <th className="w-20 px-3 py-2 text-center">Passed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                        {attendees.map((row) => (
                          <tr key={row.att.id}>
                            <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                              {row.person.lastName}, {row.person.firstName}
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                name={`grade__${row.person.id}`}
                                type="number"
                                min="0"
                                max="100"
                                placeholder="—"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                name={`passed__${row.person.id}`}
                                defaultChecked
                                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Checking "Passed" creates a training record for the person. Grades are optional.
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
