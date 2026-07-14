import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, count, eq, ilike, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { Ban, Check, GraduationCap, Presentation, RotateCcw, Trash2, UserCheck } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
} from '@beaconhs/ui'
import {
  orgUnits,
  people,
  tenantUsers,
  trainingAssessments,
  trainingClasses,
  trainingClassAttendees,
  trainingCourses,
  trainingLessons,
  users,
} from '@beaconhs/db/schema'
import { primaryPersonTitleName } from '@beaconhs/db'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { datetimeLocalValue, formatDateTime } from '@/lib/datetime'
import { clamp, isUuid, parseListParams, pickString } from '@/lib/list-params'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { ClassDetailFields } from '../_class-fields'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { DetailPageLayout } from '@/components/page-layout'
import {
  addClassAttendee,
  cancelClass,
  deleteClass,
  markClassComplete,
  removeClassAttendee,
  reopenClass,
  saveClassCompletionPage,
  updateClassField,
} from '../_actions'
import { DeleteClassButton } from './_delete-class-button'
import { CompletionDecisionFields } from './_completion-decision-fields'
import { ClassAttendeePicker } from './_attendee-picker'

export const dynamic = 'force-dynamic'

const TABS = ['details', 'roster', 'completion'] as const
type Tab = (typeof TABS)[number]
const ROSTER_SORTS = ['person'] as const

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Training class · ${id.slice(0, 8)}` }
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
  const rosterParams = parseListParams(sp, {
    sort: 'person',
    dir: 'asc',
    perPage: 25,
    allowedSorts: ROSTER_SORTS,
  })
  const completionQ = pickString(sp.completionQ)?.trim() || undefined
  const completionPage = clamp(Number(pickString(sp.completionPage) ?? '1'), 1, 10_000)
  const completionPerPage = 25
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [cls] = await tx.select().from(trainingClasses).where(eq(trainingClasses.id, id)).limit(1)
    if (!cls) return null
    const [course] = await tx
      .select()
      .from(trainingCourses)
      .where(eq(trainingCourses.id, cls.courseId))
      .limit(1)
    const attendeeBase = eq(trainingClassAttendees.classId, id)
    const rosterSearch = rosterParams.q
      ? or(
          ilike(people.firstName, `%${rosterParams.q}%`),
          ilike(people.lastName, `%${rosterParams.q}%`),
          ilike(people.employeeNo, `%${rosterParams.q}%`),
          ilike(primaryPersonTitleName(people.id, people.tenantId), `%${rosterParams.q}%`),
        )
      : undefined
    const completionSearch = completionQ
      ? or(
          ilike(people.firstName, `%${completionQ}%`),
          ilike(people.lastName, `%${completionQ}%`),
          ilike(people.employeeNo, `%${completionQ}%`),
          ilike(primaryPersonTitleName(people.id, people.tenantId), `%${completionQ}%`),
        )
      : undefined
    const rosterWhere = and(attendeeBase, rosterSearch)
    const completionWhere = and(attendeeBase, completionSearch)
    const [[attendeeCountRow], [filteredAttendeeCountRow], [reviewedAttendeeCountRow], attendees] =
      await Promise.all([
        tx.select({ c: count() }).from(trainingClassAttendees).where(attendeeBase),
        active === 'roster' || active === 'completion'
          ? tx
              .select({ c: count() })
              .from(trainingClassAttendees)
              .innerJoin(people, eq(people.id, trainingClassAttendees.personId))
              .where(active === 'roster' ? rosterWhere : completionWhere)
          : Promise.resolve([]),
        active === 'completion'
          ? tx
              .select({ c: count() })
              .from(trainingClassAttendees)
              .where(
                and(
                  attendeeBase,
                  isNotNull(trainingClassAttendees.completionReviewedAt),
                  isNotNull(trainingClassAttendees.completionAttended),
                  isNotNull(trainingClassAttendees.completionPassed),
                ),
              )
          : Promise.resolve([]),
        active === 'roster'
          ? tx
              .select({
                att: trainingClassAttendees,
                person: people,
                jobTitle: primaryPersonTitleName(people.id, people.tenantId),
              })
              .from(trainingClassAttendees)
              .innerJoin(people, eq(people.id, trainingClassAttendees.personId))
              .where(rosterWhere)
              .orderBy(asc(people.lastName), asc(people.firstName), asc(trainingClassAttendees.id))
              .limit(rosterParams.perPage)
              .offset((rosterParams.page - 1) * rosterParams.perPage)
          : active === 'completion'
            ? tx
                .select({
                  att: trainingClassAttendees,
                  person: people,
                  jobTitle: primaryPersonTitleName(people.id, people.tenantId),
                })
                .from(trainingClassAttendees)
                .innerJoin(people, eq(people.id, trainingClassAttendees.personId))
                .where(completionWhere)
                .orderBy(
                  asc(people.lastName),
                  asc(people.firstName),
                  asc(trainingClassAttendees.id),
                )
                .limit(completionPerPage)
                .offset((completionPage - 1) * completionPerPage)
            : Promise.resolve([]),
      ])
    const attendeeCount = Number(attendeeCountRow?.c ?? 0)
    const filteredAttendeeCount =
      active === 'roster' || active === 'completion'
        ? Number(filteredAttendeeCountRow?.c ?? 0)
        : attendeeCount
    const reviewedAttendeeCount = Number(reviewedAttendeeCountRow?.c ?? 0)
    const memberIds = attendees.map((a) => a.person.id)
    // Hydrate only the current values. Candidate lists come from the bounded,
    // permission-scoped picker endpoint while a manager searches.
    const [selectedSiteRows, selectedInstructorRows] = await Promise.all([
      cls.siteOrgUnitId
        ? tx
            .select({ id: orgUnits.id, name: orgUnits.name, code: orgUnits.code })
            .from(orgUnits)
            .where(eq(orgUnits.id, cls.siteOrgUnitId))
            .limit(1)
        : Promise.resolve([]),
      cls.instructorTenantUserId
        ? tx
            .select({
              id: tenantUsers.id,
              name: users.name,
              displayName: tenantUsers.displayName,
              email: users.email,
            })
            .from(tenantUsers)
            .innerJoin(users, eq(users.id, tenantUsers.userId))
            .where(eq(tenantUsers.id, cls.instructorTenantUserId))
            .limit(1)
        : Promise.resolve([]),
    ])
    // Does the course have in-app content to present in the classroom?
    const [lessonCount] = await tx
      .select({ c: count() })
      .from(trainingLessons)
      .where(and(eq(trainingLessons.courseId, cls.courseId), isNull(trainingLessons.deletedAt)))

    // Pre-fill the completion grades from each attendee's own quiz result: the
    // assessment type(s) this course's quiz lessons point at, then each
    // attendee's best submitted attempt. Instructors can still override.
    const quizTypeIds =
      active === 'completion'
        ? [
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
        : []
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
      attendeeCount,
      filteredAttendeeCount,
      reviewedAttendeeCount,
      selectedSite: selectedSiteRows[0] ?? null,
      selectedInstructor: selectedInstructorRows[0] ?? null,
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
    attendeeCount,
    filteredAttendeeCount,
    reviewedAttendeeCount,
    selectedSite,
    selectedInstructor,
    hasContent,
    hasQuiz,
    quizByPerson,
  } = data
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
          subtitle={`${course?.name ?? 'Course'} · ${formatDateTime(startsAt, ctx.timezone, ctx.locale)}`}
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
            { key: 'roster', label: 'Roster', count: attendeeCount },
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
              startsAt: datetimeLocalValue(startsAt, ctx.timezone),
              endsAt: datetimeLocalValue(endsAt, ctx.timezone),
              siteOrgUnitId: cls.siteOrgUnitId,
              instructorTenantUserId: cls.instructorTenantUserId,
              capacity: cls.capacity != null ? String(cls.capacity) : null,
              notes: cls.notes,
            }}
            options={{
              course: course
                ? { value: course.id, label: `${course.name} (${course.code})`, hint: course.code }
                : undefined,
              site: selectedSite
                ? {
                    value: selectedSite.id,
                    label: selectedSite.name,
                    hint: selectedSite.code ?? undefined,
                  }
                : undefined,
              instructor: selectedInstructor
                ? {
                    value: selectedInstructor.id,
                    label: selectedInstructor.displayName ?? selectedInstructor.name,
                    hint: selectedInstructor.email,
                  }
                : undefined,
            }}
            disabled={isCompleted || isCancelled || !canManageClasses}
            courseHref={course ? `/training/courses/${course.id}` : null}
            notice={
              isCompleted ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  This class is complete — details are locked. Training records have been issued
                  from the roster.
                </p>
              ) : isCancelled ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  This class is cancelled. Reopen it before changing its details or roster.
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
              <CardTitle>Roster ({attendeeCount})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <TableToolbar>
                <SearchInput placeholder="Search roster…" />
              </TableToolbar>
              {!isCompleted && !isCancelled && canManageClasses ? (
                <div className="space-y-3 border-b border-slate-100 pb-4 dark:border-slate-800">
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      Add an attendee
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Search by name, employee number, job title, or email.
                    </p>
                  </div>
                  <ClassAttendeePicker classId={id} action={addClassAttendee} />
                </div>
              ) : null}
              {attendees.length === 0 ? (
                <EmptyState
                  icon={<UserCheck size={24} />}
                  title={
                    rosterParams.q ? 'No attendees match your search' : 'No attendees registered'
                  }
                  description={
                    rosterParams.q
                      ? 'Try a different name, employee number, or job title.'
                      : isCompleted
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
                        {row.jobTitle ? (
                          <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                            {row.jobTitle}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{row.att.status}</Badge>
                        {!isCompleted && !isCancelled && canManageClasses ? (
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
              <Pagination
                basePath={basePath}
                currentParams={sp}
                total={filteredAttendeeCount}
                page={rosterParams.page}
                perPage={rosterParams.perPage}
              />
            </CardContent>
          </Card>
        ) : null}

        {active === 'completion' ? (
          <Card>
            <CardHeader>
              <CardTitle>Mark completion</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isCompleted ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Class was marked complete on{' '}
                  {formatDateTime(new Date(cls.completedAt!), ctx.timezone, ctx.locale)}. Training
                  records have been created for everyone who passed.
                </p>
              ) : isCancelled ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Reopen this class before reviewing attendance or marking it complete.
                </p>
              ) : !canManageClasses ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  You have read-only access to this class. Marking completion and issuing training
                  records requires the Manage classes permission.
                </p>
              ) : attendeeCount === 0 ? (
                <EmptyState
                  icon={<GraduationCap size={24} />}
                  title="No attendees"
                  description="Add attendees on the Roster tab before marking completion."
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <p className="text-slate-600 dark:text-slate-300">
                      <strong className="font-medium text-slate-900 dark:text-slate-100">
                        {reviewedAttendeeCount.toLocaleString()}
                      </strong>{' '}
                      of {attendeeCount.toLocaleString()} attendees reviewed
                    </p>
                    <Badge
                      variant={reviewedAttendeeCount === attendeeCount ? 'success' : 'warning'}
                    >
                      {reviewedAttendeeCount === attendeeCount
                        ? 'Ready to finalize'
                        : `${(attendeeCount - reviewedAttendeeCount).toLocaleString()} remaining`}
                    </Badge>
                  </div>
                  <TableToolbar>
                    <SearchInput
                      placeholder="Search attendees…"
                      paramKey="completionQ"
                      pageParamKey="completionPage"
                    />
                  </TableToolbar>
                  {attendees.length === 0 ? (
                    <EmptyState
                      icon={<GraduationCap size={24} />}
                      title={
                        completionQ
                          ? 'No attendees match your search'
                          : 'This completion page has no attendees'
                      }
                      description={
                        completionQ
                          ? 'Try a different name, employee number, or job title.'
                          : 'Use the page control below to return to a page with attendees.'
                      }
                    />
                  ) : (
                    <form action={saveClassCompletionPage} className="space-y-3 text-sm">
                      <input type="hidden" name="classId" value={id} />
                      <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
                        <table className="w-full min-w-[680px] text-sm">
                          <thead className="bg-slate-50 dark:bg-slate-800">
                            <tr className="text-left text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                              <th className="px-3 py-2">Person</th>
                              <th className="w-24 px-3 py-2 text-center">Attended</th>
                              <th className="w-28 px-3 py-2">Grade %</th>
                              <th className="w-20 px-3 py-2 text-center">Passed</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                            {attendees.map((row) => {
                              const quiz = quizByPerson.get(row.person.id) ?? null
                              const reviewed = row.att.completionReviewedAt != null
                              const initialAttended = reviewed
                                ? row.att.completionAttended === true
                                : true
                              const initialPassed = reviewed
                                ? row.att.completionPassed === true
                                : (quiz?.passed ?? true)
                              const initialGrade = reviewed
                                ? row.att.completionGrade
                                : (quiz?.score ?? null)
                              return (
                                <tr key={row.att.id}>
                                  <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                                    <input type="hidden" name="attendeeId" value={row.att.id} />
                                    <span className="block">
                                      {row.person.lastName}, {row.person.firstName}
                                    </span>
                                    <span
                                      className={`text-[11px] font-normal ${
                                        reviewed
                                          ? 'text-emerald-600 dark:text-emerald-400'
                                          : 'text-amber-600 dark:text-amber-400'
                                      }`}
                                    >
                                      {reviewed ? 'Reviewed' : 'Not reviewed'}
                                    </span>
                                  </td>
                                  <CompletionDecisionFields
                                    attendeeId={row.att.id}
                                    initialAttended={initialAttended}
                                    initialPassed={initialPassed}
                                    initialGrade={initialGrade}
                                    quiz={quiz}
                                    hasQuiz={hasQuiz}
                                  />
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Save this page before moving to another page. A no-show cannot be marked as
                        passed. Passing creates a training record when the class is finalized;
                        grades are optional.
                        {hasQuiz
                          ? ' New decisions are pre-filled from each person’s best quiz attempt and can be adjusted before saving.'
                          : ''}
                      </p>
                      <div className="flex justify-end">
                        <Button type="submit" variant="outline">
                          <Check size={14} /> Save this page
                        </Button>
                      </div>
                    </form>
                  )}
                  <Pagination
                    basePath={basePath}
                    currentParams={sp}
                    total={filteredAttendeeCount}
                    page={completionPage}
                    perPage={completionPerPage}
                    pageParamKey="completionPage"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                    <p className="max-w-2xl text-xs text-slate-500 dark:text-slate-400">
                      Finalizing locks the class and issues records for every reviewed attendee
                      marked as passed. It is available only after the entire roster is reviewed.
                    </p>
                    <form action={markClassComplete}>
                      <input type="hidden" name="classId" value={id} />
                      <Button
                        type="submit"
                        disabled={reviewedAttendeeCount !== attendeeCount}
                        title={
                          reviewedAttendeeCount === attendeeCount
                            ? 'Finalize class completion'
                            : 'Review every attendee first'
                        }
                      >
                        <Check size={14} /> Mark class complete
                      </Button>
                    </form>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </DetailPageLayout>
  )
}
