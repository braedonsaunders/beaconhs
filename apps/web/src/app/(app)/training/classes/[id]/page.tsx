import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { getGeneratedTranslations } from '@/i18n/generated.server'
import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_000778b56725e9', { value0: id.slice(0, 8) }) }
}

// ---------- Page ----------

export default async function TrainingClassPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
          title={tGeneratedValue(cls.title)}
          subtitle={tGeneratedValue(
            `${course?.name ?? 'Course'} · ${formatDateTime(startsAt, ctx.timezone, ctx.locale)}`,
          )}
          badge={
            isCancelled ? (
              <Badge variant="destructive">
                <GeneratedText id="m_1a7e1cf2be443e" />
              </Badge>
            ) : isCompleted ? (
              <Badge variant="success">
                <GeneratedText id="m_0ba7a5e1b2fa32" />
              </Badge>
            ) : inPast ? (
              <Badge variant="warning">
                <GeneratedText id="m_1ea7f550466859" />
              </Badge>
            ) : (
              <Badge variant="secondary">
                <GeneratedText id="m_14ad4ca1d87e79" />
              </Badge>
            )
          }
          actions={
            !canManageClasses ? null : (
              <div className="flex items-center gap-2">
                <GeneratedValue
                  value={
                    hasContent ? (
                      <Link
                        href={`/training/courses/${cls.courseId}/present?from=${encodeURIComponent(basePath)}`}
                      >
                        <Button size="sm">
                          <Presentation size={14} /> <GeneratedText id="m_04b4cec328eb40" />
                        </Button>
                      </Link>
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    isCompleted ? null : (
                      <>
                        <GeneratedValue
                          value={
                            isCancelled ? (
                              <form action={reopenAction}>
                                <Button type="submit" variant="outline" size="sm">
                                  <RotateCcw size={14} /> <GeneratedText id="m_05f723a26fdf25" />
                                </Button>
                              </form>
                            ) : (
                              <form action={cancelAction}>
                                <Button type="submit" variant="outline" size="sm">
                                  <Ban size={14} /> <GeneratedText id="m_0027081fc0fece" />
                                </Button>
                              </form>
                            )
                          }
                        />
                        <form action={deleteAction}>
                          <DeleteClassButton />
                        </form>
                      </>
                    )
                  }
                />
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
        <GeneratedValue
          value={
            active === 'details' ? (
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
                    ? {
                        value: course.id,
                        label: `${course.name} (${course.code})`,
                        hint: course.code,
                      }
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
                      <GeneratedText id="m_19891cc76a49d0" />
                    </p>
                  ) : isCancelled ? (
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      <GeneratedText id="m_1274df3b0c211b" />
                    </p>
                  ) : !canManageClasses ? (
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      <GeneratedText id="m_1c6bdea258511d" />
                    </p>
                  ) : null
                }
                updateAction={updateClassField}
              />
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'roster' ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <GeneratedText id="m_06fabcb809e0a4" />
                    <GeneratedValue value={attendeeCount} />)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <TableToolbar>
                    <SearchInput placeholder={tGenerated('m_060600df8339fd')} />
                  </TableToolbar>
                  <GeneratedValue
                    value={
                      !isCompleted && !isCancelled && canManageClasses ? (
                        <div className="space-y-3 border-b border-slate-100 pb-4 dark:border-slate-800">
                          <div>
                            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                              <GeneratedText id="m_09ccba48857eaf" />
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              <GeneratedText id="m_1873f380e47616" />
                            </p>
                          </div>
                          <ClassAttendeePicker classId={id} action={addClassAttendee} />
                        </div>
                      ) : null
                    }
                  />
                  <GeneratedValue
                    value={
                      attendees.length === 0 ? (
                        <EmptyState
                          icon={<UserCheck size={24} />}
                          title={tGeneratedValue(
                            rosterParams.q
                              ? tGenerated('m_02c09be3bc2a79')
                              : tGenerated('m_038d0f32e1f9ce'),
                          )}
                          description={tGeneratedValue(
                            rosterParams.q
                              ? tGenerated('m_142fb76a25756c')
                              : isCompleted
                                ? tGenerated('m_1523552c30aa27')
                                : tGenerated('m_0239989f3045ae'),
                          )}
                        />
                      ) : (
                        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                          <GeneratedValue
                            value={attendees.map((row) => (
                              <li
                                key={row.att.id}
                                className="flex items-center justify-between gap-3 py-2"
                              >
                                <div className="min-w-0">
                                  <Link
                                    href={`/people/${row.person.id}`}
                                    className="font-medium hover:underline"
                                  >
                                    <GeneratedValue value={row.person.lastName} />,{' '}
                                    <GeneratedValue value={row.person.firstName} />
                                  </Link>
                                  <GeneratedValue
                                    value={
                                      row.jobTitle ? (
                                        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                                          {row.jobTitle}
                                        </span>
                                      ) : null
                                    }
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary">
                                    <GeneratedValue value={row.att.status} />
                                  </Badge>
                                  <GeneratedValue
                                    value={
                                      !isCompleted && !isCancelled && canManageClasses ? (
                                        <form action={removeClassAttendee} className="inline">
                                          <input type="hidden" name="classId" value={id} />
                                          <input
                                            type="hidden"
                                            name="personId"
                                            value={row.person.id}
                                          />
                                          <Button
                                            type="submit"
                                            variant="ghost"
                                            size="sm"
                                            aria-label={tGenerated('m_035950db958dfa')}
                                          >
                                            <Trash2 size={14} className="text-red-500" />
                                          </Button>
                                        </form>
                                      ) : null
                                    }
                                  />
                                </div>
                              </li>
                            ))}
                          />
                        </ul>
                      )
                    }
                  />
                  <Pagination
                    basePath={basePath}
                    currentParams={sp}
                    total={filteredAttendeeCount}
                    page={rosterParams.page}
                    perPage={rosterParams.perPage}
                  />
                </CardContent>
              </Card>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'completion' ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <GeneratedText id="m_192e86df5245d5" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <GeneratedValue
                    value={
                      isCompleted ? (
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          <GeneratedText id="m_166f7c414551e6" />
                          <GeneratedValue value={' '} />
                          <GeneratedValue
                            value={formatDateTime(
                              new Date(cls.completedAt!),
                              ctx.timezone,
                              ctx.locale,
                            )}
                          />
                          <GeneratedText id="m_08dc4ea8b62366" />
                        </p>
                      ) : isCancelled ? (
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          <GeneratedText id="m_1bb53e1185b70c" />
                        </p>
                      ) : !canManageClasses ? (
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          <GeneratedText id="m_09053f3cde1c3c" />
                        </p>
                      ) : attendeeCount === 0 ? (
                        <EmptyState
                          icon={<GraduationCap size={24} />}
                          title={tGenerated('m_17ddd2a87631df')}
                          description={tGenerated('m_18670096faf9e2')}
                        />
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <p className="text-slate-600 dark:text-slate-300">
                              <strong className="font-medium text-slate-900 dark:text-slate-100">
                                <GeneratedValue value={reviewedAttendeeCount.toLocaleString()} />
                              </strong>
                              <GeneratedValue value={' '} />
                              <GeneratedText id="m_00e704d1194796" />{' '}
                              <GeneratedValue value={attendeeCount.toLocaleString()} />{' '}
                              <GeneratedText id="m_053245ab492054" />
                            </p>
                            <Badge
                              variant={
                                reviewedAttendeeCount === attendeeCount ? 'success' : 'warning'
                              }
                            >
                              <GeneratedValue
                                value={
                                  reviewedAttendeeCount === attendeeCount ? (
                                    <GeneratedText id="m_19d2f461ebe062" />
                                  ) : (
                                    <GeneratedText
                                      id="m_0ed86fd90900c0"
                                      values={{
                                        value0: (
                                          attendeeCount - reviewedAttendeeCount
                                        ).toLocaleString(),
                                      }}
                                    />
                                  )
                                }
                              />
                            </Badge>
                          </div>
                          <TableToolbar>
                            <SearchInput
                              placeholder={tGenerated('m_0c6939337c9351')}
                              paramKey="completionQ"
                              pageParamKey="completionPage"
                            />
                          </TableToolbar>
                          <GeneratedValue
                            value={
                              attendees.length === 0 ? (
                                <EmptyState
                                  icon={<GraduationCap size={24} />}
                                  title={tGeneratedValue(
                                    completionQ
                                      ? tGenerated('m_02c09be3bc2a79')
                                      : tGenerated('m_19b3485454d3f3'),
                                  )}
                                  description={tGeneratedValue(
                                    completionQ
                                      ? tGenerated('m_142fb76a25756c')
                                      : tGenerated('m_1127170d33ed62'),
                                  )}
                                />
                              ) : (
                                <form
                                  action={saveClassCompletionPage}
                                  className="space-y-3 text-sm"
                                >
                                  <input type="hidden" name="classId" value={id} />
                                  <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
                                    <table className="w-full min-w-[680px] text-sm">
                                      <thead className="bg-slate-50 dark:bg-slate-800">
                                        <tr className="text-left text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                                          <th className="px-3 py-2">
                                            <GeneratedText id="m_12e926c9216094" />
                                          </th>
                                          <th className="w-24 px-3 py-2 text-center">
                                            <GeneratedText id="m_02497d0c780d25" />
                                          </th>
                                          <th className="w-28 px-3 py-2">
                                            <GeneratedText id="m_1f58a1228c4406" />
                                          </th>
                                          <th className="w-20 px-3 py-2 text-center">
                                            <GeneratedText id="m_10cad12b9fc18d" />
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                                        <GeneratedValue
                                          value={attendees.map((row) => {
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
                                                  <input
                                                    type="hidden"
                                                    name="attendeeId"
                                                    value={row.att.id}
                                                  />
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
                                                    {reviewed ? (
                                                      <GeneratedText id="m_08791cd0d5daff" />
                                                    ) : (
                                                      <GeneratedText id="m_1b91e1a434803f" />
                                                    )}
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
                                        />
                                      </tbody>
                                    </table>
                                  </div>
                                  <p className="text-xs text-slate-500 dark:text-slate-400">
                                    <GeneratedText id="m_0b6364c784d557" />
                                    <GeneratedValue
                                      value={hasQuiz ? <GeneratedText id="m_10e2fdad1ac89b" /> : ''}
                                    />
                                  </p>
                                  <div className="flex justify-end">
                                    <Button type="submit" variant="outline">
                                      <Check size={14} /> <GeneratedText id="m_0e1b1d5b0d7aca" />
                                    </Button>
                                  </div>
                                </form>
                              )
                            }
                          />
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
                              <GeneratedText id="m_1313b66bcedb32" />
                            </p>
                            <form action={markClassComplete}>
                              <input type="hidden" name="classId" value={id} />
                              <Button
                                type="submit"
                                disabled={reviewedAttendeeCount !== attendeeCount}
                                title={tGeneratedValue(
                                  reviewedAttendeeCount === attendeeCount
                                    ? tGenerated('m_0170a9cc8fe423')
                                    : tGenerated('m_06e57440cc12e6'),
                                )}
                              >
                                <Check size={14} /> <GeneratedText id="m_0cb51d790d3f0c" />
                              </Button>
                            </form>
                          </div>
                        </>
                      )
                    }
                  />
                </CardContent>
              </Card>
            ) : null
          }
        />
      </div>
    </DetailPageLayout>
  )
}
