// Dashboard KPI queries. Centralised so the page stays readable and so we
// can re-use them from /reports/dashboard previews later.

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from 'drizzle-orm'
import type { RequestContext } from '@beaconhs/tenant'
import {
  correctiveActions,
  csPermits,
  documentAcknowledgments,
  documentAssignments,
  documentAssignmentAudience,
  formResponses,
  incidents,
  inspectionRecords,
  lwSessions,
  notifications,
  orgUnits,
  people,
  ppeItems,
  ppeIssueReports,
  trainingAudienceAssignmentRecords,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'

export type DashboardMetrics = {
  // Headline tiles
  incidents30: number
  incidentsPrev30: number
  openCAs: number
  overdueCAs: number
  submissionsToday: number
  expiringCertsCount: number
  csActive: number
  lwActive: number
  ppeOpenIssues: number
  ppeInspectionsOverdue: number
  peopleCount: number
  inspectionsThisMonth: number

  // Computed safety rates
  trir: { value: number | null; recordableCount: number; hoursWorked: number; periodLabel: string }
  dart: { value: number | null; dartCount: number; hoursWorked: number }

  // Compliance %
  trainingCompliancePct: number | null
  trainingComplianceCounts: { completed: number; total: number }
  documentCompliancePct: number | null
  documentComplianceCounts: { acknowledged: number; expected: number }

  // CA aging
  openCAAgingDays: number | null

  // List widgets
  recentIncidents: Array<typeof incidents.$inferSelect>
  dueCAs: Array<typeof correctiveActions.$inferSelect>
  expiringCertsList: Array<{
    record: typeof trainingRecords.$inferSelect
    person: typeof people.$inferSelect
    course: typeof trainingCourses.$inferSelect
  }>
  myInbox: Array<typeof notifications.$inferSelect>
  topSitesByIncidents: Array<{ siteId: string | null; siteName: string; incidents: number }>
  topOverdueCAs: Array<{
    id: string
    reference: string
    title: string
    dueOn: string | null
    daysOverdue: number
  }>
  expiringTraining30d: Array<{
    personId: string
    personName: string
    courseName: string
    expiresOn: string
  }>
}

/** Returns the per-tenant dashboard payload. Single transaction. */
export async function loadDashboardMetrics(
  ctx: RequestContext,
  now: Date = new Date(),
): Promise<DashboardMetrics> {
  const today = new Date(now)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000)
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 86_400_000)
  const ninetyDaysAhead = new Date(now.getTime() + 90 * 86_400_000)
  const thirtyDaysAhead = new Date(now.getTime() + 30 * 86_400_000)
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000)
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const todayStart = new Date(today)
  todayStart.setHours(0, 0, 0, 0)
  const todayIso = today.toISOString().slice(0, 10)
  const ninetyIso = ninetyDaysAhead.toISOString().slice(0, 10)
  const thirtyIso = thirtyDaysAhead.toISOString().slice(0, 10)

  return await ctx.db(async (tx) => {
    const [
      incRow,
      incPrev,
      caRow,
      caOverdue,
      subRow,
      certRow,
      csActive,
      lwActive,
      ppeOpen,
      ppeOverdue,
      peopleCount,
      inspThisMonth,
    ] = await Promise.all([
      tx
        .select({ c: count() })
        .from(incidents)
        .where(gte(incidents.occurredAt, thirtyDaysAgo))
        .then((r) => r[0]),
      tx
        .select({ c: count() })
        .from(incidents)
        .where(
          and(gte(incidents.occurredAt, sixtyDaysAgo), lte(incidents.occurredAt, thirtyDaysAgo)),
        )
        .then((r) => r[0]),
      tx
        .select({ c: count() })
        .from(correctiveActions)
        .where(isNull(correctiveActions.closedAt))
        .then((r) => r[0]),
      tx
        .select({ c: count() })
        .from(correctiveActions)
        .where(
          and(
            isNull(correctiveActions.closedAt),
            isNotNull(correctiveActions.dueOn),
            lte(correctiveActions.dueOn, todayIso),
          ),
        )
        .then((r) => r[0]),
      tx
        .select({ c: count() })
        .from(formResponses)
        .where(gte(formResponses.submittedAt, todayStart))
        .then((r) => r[0]),
      tx
        .select({ c: count() })
        .from(trainingRecords)
        .where(
          and(
            isNotNull(trainingRecords.expiresOn),
            lte(trainingRecords.expiresOn, ninetyIso),
          ),
        )
        .then((r) => r[0]),
      tx
        .select({ c: count() })
        .from(csPermits)
        .where(eq(csPermits.status, 'active'))
        .then((r) => r[0]),
      tx
        .select({ c: count() })
        .from(lwSessions)
        .where(eq(lwSessions.status, 'active'))
        .then((r) => r[0]),
      tx
        .select({ c: count() })
        .from(ppeIssueReports)
        .where(eq(ppeIssueReports.status, 'open'))
        .then((r) => r[0]),
      tx
        .select({ c: count() })
        .from(ppeItems)
        .where(
          and(
            isNotNull(ppeItems.nextAnnualInspectionDue),
            lte(ppeItems.nextAnnualInspectionDue, todayIso),
          ),
        )
        .then((r) => r[0]),
      tx
        .select({ c: count() })
        .from(people)
        .where(eq(people.status, 'active'))
        .then((r) => r[0]),
      tx
        .select({ c: count() })
        .from(inspectionRecords)
        .where(
          and(
            gte(inspectionRecords.occurredAt, startOfMonth),
            inArray(inspectionRecords.status, ['submitted', 'closed']),
          ),
        )
        .then((r) => r[0]),
    ])

    // --- Safety rates ----------------------------------------------------
    // We don't have a work-hours table — estimate using active head-count ×
    // 2,000 hours/year over the lookback period. This matches the standard
    // OSHA convention (200,000 hour-equivalents == 100 FTE-years).
    const headcount = Number(peopleCount?.c ?? 0)
    const hours12mo = headcount * 2000

    const [recordable12mo] = await tx
      .select({ c: count() })
      .from(incidents)
      .where(
        and(
          gte(incidents.occurredAt, twelveMonthsAgo),
          inArray(incidents.severity, ['medical_aid', 'lost_time', 'fatality']),
        ),
      )

    const [dart12mo] = await tx
      .select({ c: count() })
      .from(incidents)
      .where(
        and(
          gte(incidents.occurredAt, twelveMonthsAgo),
          eq(incidents.lostTime, true),
        ),
      )

    const recordableCount = Number(recordable12mo?.c ?? 0)
    const dartCount = Number(dart12mo?.c ?? 0)
    const trir =
      hours12mo > 0 ? Number(((recordableCount * 200_000) / hours12mo).toFixed(2)) : null
    const dart =
      hours12mo > 0 ? Number(((dartCount * 200_000) / hours12mo).toFixed(2)) : null

    // --- Training compliance % -------------------------------------------
    const tcRows = await tx
      .select({
        status: trainingAudienceAssignmentRecords.status,
        c: count(),
      })
      .from(trainingAudienceAssignmentRecords)
      .groupBy(trainingAudienceAssignmentRecords.status)
    const trainingTotal = tcRows.reduce((acc, r) => acc + Number(r.c), 0)
    const trainingCompleted = tcRows
      .filter((r) => r.status === 'completed')
      .reduce((acc, r) => acc + Number(r.c), 0)
    const trainingCompliancePct =
      trainingTotal === 0 ? null : Math.round((trainingCompleted / trainingTotal) * 100)

    // --- Document compliance % -------------------------------------------
    // Expected = sum over assignments of audience-resolved people for that doc.
    // We approximate by counting distinct people per assignment via the
    // audience table (person rows count 1 each; other audience types contribute
    // 0 since we don't materialise their resolved sets in this tier).
    //
    // For acknowledgments we count distinct (assignment_id, person_id) pairs
    // where the person has acknowledged the document tied to the assignment.
    const docAssignments = await tx
      .select({
        id: documentAssignments.id,
        documentId: documentAssignments.documentId,
      })
      .from(documentAssignments)
    const personAudienceCounts =
      docAssignments.length > 0
        ? await tx
            .select({
              assignmentId: documentAssignmentAudience.assignmentId,
              c: count(),
            })
            .from(documentAssignmentAudience)
            .where(
              and(
                eq(documentAssignmentAudience.type, 'person'),
                inArray(
                  documentAssignmentAudience.assignmentId,
                  docAssignments.map((d) => d.id),
                ),
              ),
            )
            .groupBy(documentAssignmentAudience.assignmentId)
        : []
    const expectedMap = new Map<string, number>()
    for (const r of personAudienceCounts) expectedMap.set(r.assignmentId, Number(r.c))

    let documentExpected = 0
    let documentAcked = 0
    if (docAssignments.length > 0) {
      // Get ack counts per (assignment.documentId), counting unique people.
      const ackRows = await tx
        .select({
          documentId: documentAcknowledgments.documentId,
          personId: documentAcknowledgments.personId,
        })
        .from(documentAcknowledgments)
        .where(
          inArray(
            documentAcknowledgments.documentId,
            docAssignments.map((d) => d.documentId),
          ),
        )
      // Map doc -> set of person ids who've acked.
      const ackedByDoc = new Map<string, Set<string>>()
      for (const r of ackRows) {
        const set = ackedByDoc.get(r.documentId) ?? new Set<string>()
        set.add(r.personId)
        ackedByDoc.set(r.documentId, set)
      }
      // Get person-audience for each assignment to compute hits.
      const audByAssignment = new Map<string, Set<string>>()
      if (personAudienceCounts.length > 0) {
        const audRows = await tx
          .select({
            assignmentId: documentAssignmentAudience.assignmentId,
            entityKey: documentAssignmentAudience.entityKey,
          })
          .from(documentAssignmentAudience)
          .where(
            and(
              eq(documentAssignmentAudience.type, 'person'),
              inArray(
                documentAssignmentAudience.assignmentId,
                docAssignments.map((d) => d.id),
              ),
            ),
          )
        for (const r of audRows) {
          const set = audByAssignment.get(r.assignmentId) ?? new Set<string>()
          set.add(r.entityKey)
          audByAssignment.set(r.assignmentId, set)
        }
      }
      for (const a of docAssignments) {
        const expected = expectedMap.get(a.id) ?? 0
        documentExpected += expected
        const audSet = audByAssignment.get(a.id)
        const acks = ackedByDoc.get(a.documentId)
        if (audSet && acks) {
          for (const personId of audSet) if (acks.has(personId)) documentAcked++
        }
      }
    }
    const documentCompliancePct =
      documentExpected === 0
        ? null
        : Math.round((documentAcked / documentExpected) * 100)

    // --- CA aging --------------------------------------------------------
    const [agingRow] = await tx
      .select({
        avgDays: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (now() - ${correctiveActions.createdAt})) / 86400), 0)::float`,
      })
      .from(correctiveActions)
      .where(isNull(correctiveActions.closedAt))
    const openCAAgingDays =
      agingRow && Number(agingRow.avgDays) > 0 ? Math.round(Number(agingRow.avgDays)) : null

    // --- List widgets ----------------------------------------------------
    const recentIncidents = await tx
      .select()
      .from(incidents)
      .orderBy(desc(incidents.occurredAt))
      .limit(5)

    const dueCAs = await tx
      .select()
      .from(correctiveActions)
      .where(isNull(correctiveActions.closedAt))
      .orderBy(asc(correctiveActions.dueOn))
      .limit(5)

    const expiringCertsList = await tx
      .select({ record: trainingRecords, person: people, course: trainingCourses })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(and(isNotNull(trainingRecords.expiresOn), lte(trainingRecords.expiresOn, ninetyIso)))
      .orderBy(asc(trainingRecords.expiresOn))
      .limit(5)

    const myInbox = await tx
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.userId!), isNull(notifications.readAt)))
      .orderBy(desc(notifications.occurredAt))
      .limit(5)

    // Top 5 sites by incident count (last 90 days)
    const topSitesRaw = await tx
      .select({
        siteId: incidents.siteOrgUnitId,
        siteName: orgUnits.name,
        c: count(),
      })
      .from(incidents)
      .leftJoin(orgUnits, eq(orgUnits.id, incidents.siteOrgUnitId))
      .where(gte(incidents.occurredAt, ninetyDaysAgo))
      .groupBy(incidents.siteOrgUnitId, orgUnits.name)
      .orderBy(desc(count()))
      .limit(5)
    const topSitesByIncidents = topSitesRaw.map((r) => ({
      siteId: r.siteId,
      siteName: r.siteName ?? '(no site)',
      incidents: Number(r.c),
    }))

    // Top 5 most-overdue CAs
    const topOverdueRaw = await tx
      .select({
        id: correctiveActions.id,
        reference: correctiveActions.reference,
        title: correctiveActions.title,
        dueOn: correctiveActions.dueOn,
      })
      .from(correctiveActions)
      .where(
        and(
          isNull(correctiveActions.closedAt),
          isNotNull(correctiveActions.dueOn),
          lte(correctiveActions.dueOn, todayIso),
        ),
      )
      .orderBy(asc(correctiveActions.dueOn))
      .limit(5)
    const topOverdueCAs = topOverdueRaw.map((r) => {
      const dayMs = 86_400_000
      const days = r.dueOn
        ? Math.round((today.getTime() - new Date(r.dueOn).getTime()) / dayMs)
        : 0
      return {
        id: r.id,
        reference: r.reference,
        title: r.title,
        dueOn: r.dueOn,
        daysOverdue: Math.max(days, 0),
      }
    })

    // People expiring training in next 30 days
    const expiringRaw = await tx
      .select({
        personId: people.id,
        personFirst: people.firstName,
        personLast: people.lastName,
        courseName: trainingCourses.name,
        expiresOn: trainingRecords.expiresOn,
      })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(
        and(
          isNotNull(trainingRecords.expiresOn),
          gte(trainingRecords.expiresOn, todayIso),
          lte(trainingRecords.expiresOn, thirtyIso),
        ),
      )
      .orderBy(asc(trainingRecords.expiresOn))
      .limit(10)
    const expiringTraining30d = expiringRaw.map((r) => ({
      personId: r.personId,
      personName: `${r.personLast}, ${r.personFirst}`,
      courseName: r.courseName,
      expiresOn: String(r.expiresOn),
    }))

    return {
      incidents30: Number(incRow?.c ?? 0),
      incidentsPrev30: Number(incPrev?.c ?? 0),
      openCAs: Number(caRow?.c ?? 0),
      overdueCAs: Number(caOverdue?.c ?? 0),
      submissionsToday: Number(subRow?.c ?? 0),
      expiringCertsCount: Number(certRow?.c ?? 0),
      csActive: Number(csActive?.c ?? 0),
      lwActive: Number(lwActive?.c ?? 0),
      ppeOpenIssues: Number(ppeOpen?.c ?? 0),
      ppeInspectionsOverdue: Number(ppeOverdue?.c ?? 0),
      peopleCount: headcount,
      inspectionsThisMonth: Number(inspThisMonth?.c ?? 0),

      trir: {
        value: trir,
        recordableCount,
        hoursWorked: hours12mo,
        periodLabel: '12-month rolling',
      },
      dart: {
        value: dart,
        dartCount,
        hoursWorked: hours12mo,
      },

      trainingCompliancePct,
      trainingComplianceCounts: { completed: trainingCompleted, total: trainingTotal },
      documentCompliancePct,
      documentComplianceCounts: { acknowledged: documentAcked, expected: documentExpected },

      openCAAgingDays,

      recentIncidents,
      dueCAs,
      expiringCertsList,
      myInbox,
      topSitesByIncidents,
      topOverdueCAs,
      expiringTraining30d,
    }
  })
}
