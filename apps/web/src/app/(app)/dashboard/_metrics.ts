// Dashboard KPI queries. Centralised so the page stays readable and so we
// can re-use them from /reports/dashboard previews later.

import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import type { RequestContext } from '@beaconhs/tenant'
import {
  complianceObligations,
  complianceStatus,
  correctiveActions,
  equipmentCheckouts,
  equipmentItems,
  equipmentTypes,
  formResponses,
  hazidAssessments,
  incidentHoursPeriods,
  incidents,
  inspectionRecords,
  inspectionTypes,
  journalEntries,
  notifications,
  orgUnits,
  people,
  ppeItems,
  ppeIssueReports,
  ppeTypes,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'

/**
 * One 12-element series of monthly values, oldest -> newest. Used to draw the
 * tiny inline-SVG sparklines on the hero rate tiles. Values are scalar (incident
 * counts or rates); `null` means "no data that month".
 */
export type MonthlySeries = ReadonlyArray<number | null>

export type DashboardMetrics = {
  // Headline tiles
  incidents30: number
  incidentsPrev30: number
  openCAs: number
  overdueCAs: number
  submissionsToday: number
  expiringCertsCount: number
  lwActive: number
  ppeOpenIssues: number
  ppeInspectionsOverdue: number
  peopleCount: number
  inspectionsThisMonth: number

  // Computed safety rates
  trir: {
    value: number | null
    recordableCount: number
    hoursWorked: number
    periodLabel: string
    /** Rolling 12-mo rate ending one year earlier; used for delta arrow. */
    prevValue: number | null
    /** Last 12 months of recordable counts, oldest -> newest. */
    trend: MonthlySeries
  }
  dart: {
    value: number | null
    dartCount: number
    hoursWorked: number
    prevValue: number | null
    trend: MonthlySeries
  }

  // Compliance %
  trainingCompliancePct: number | null
  trainingComplianceCounts: { completed: number; total: number }
  documentCompliancePct: number | null
  documentComplianceCounts: { acknowledged: number; expected: number }

  /**
   * Synthetic compliance trends. We don't store snapshot history for training/
   * document compliance, so we estimate the curve by easing from a baseline (10
   * percentage points below current) up to the present value. This gives the
   * sparkline something honest-feeling without claiming numbers we don't have.
   * Future iteration: hydrate from a snapshots table.
   */
  trainingComplianceTrend: MonthlySeries
  documentComplianceTrend: MonthlySeries

  // CA aging
  openCAAgingDays: number | null
  /** Open CAs bucketed by age. Used by the CAPA aging card on the dashboard. */
  openCABuckets: { lt7: number; lt30: number; lt60: number; ge60: number }

  // EHS cultural counters
  /** Wall-clock days since the most recent recordable incident in this tenant. */
  daysSinceLastRecordable: number | null
  lastRecordableAt: Date | null

  /** 12-month severity distribution — drives Heinrich-pyramid widget. */
  severityDistribution: {
    fatality: number
    lostTime: number
    medicalAid: number
    firstAid: number
    nearMiss: number
    noInjury: number
    propertyDamage: number
  }

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

  // Personal — "my" widgets, scoped to the logged-in user's person record.
  // Empty / zeroed when the account isn't linked to a person (`linked: false`).
  myPpe: Array<{
    id: string
    typeName: string
    serialNumber: string | null
    size: string | null
    status: string
    nextInspectionDue: string | null
    nextAnnualInspectionDue: string | null
    expiresOn: string | null
  }>
  myEquipment: Array<{
    id: string
    checkoutId: string
    name: string
    assetTag: string
    typeName: string | null
    status: string
    requiresAnnualInspection: boolean
    nextAnnualInspectionDue: string | null
    expectedReturnOn: string | null
  }>
  myCompliance: {
    /** False when the user has no linked person record. */
    linked: boolean
    total: number
    completed: number
    overdue: number
    dueSoon: number
    pending: number
    /** completed ÷ total, or null when nothing is assigned. */
    percent: number | null
    outstanding: Array<{
      obligationId: string
      kind: string
      title: string
      status: string
      dueOn: string | null
    }>
  }

  // In-progress entries the current user has started but not finished, across
  // modules (journals, hazard assessments, incidents, inspections). Newest-
  // touched first. Empty for accounts with no tenant membership (e.g. super-admin).
  inProgressEntries: Array<{
    id: string
    kind: 'journal' | 'hazard_assessment' | 'incident' | 'inspection'
    title: string
    href: string
    updatedAt: string
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
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
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
        .where(and(isNotNull(trainingRecords.expiresOn), lte(trainingRecords.expiresOn, ninetyIso)))
        .then((r) => r[0]),
      tx
        .select({ c: count() })
        .from(formResponses)
        .where(eq(formResponses.monitorStatus, 'active'))
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

    // --- Safety rates (TRIR / DART) --------------------------------------
    // Hours come from the recorded incident_hours_periods. We DO NOT estimate
    // hours — when a tenant hasn't recorded any, the rate is null (shown as "—"),
    // never a fabricated number. OSHA: rate = events × 200,000 ÷ hours.
    const headcount = Number(peopleCount?.c ?? 0)

    // 24-month lookback so we can compute current vs prior 12-month windows
    // and also bucket the last 12 months for the sparkline.
    const twentyFourMonthsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate())

    const recordableMonthly = await tx
      .select({
        bucket: sql<string>`to_char(${incidents.occurredAt}, 'YYYY-MM')`,
        c: count(),
      })
      .from(incidents)
      .where(
        and(
          gte(incidents.occurredAt, twentyFourMonthsAgo),
          inArray(incidents.severity, ['medical_aid', 'lost_time', 'fatality']),
        ),
      )
      .groupBy(sql`to_char(${incidents.occurredAt}, 'YYYY-MM')`)

    const dartMonthly = await tx
      .select({
        bucket: sql<string>`to_char(${incidents.occurredAt}, 'YYYY-MM')`,
        c: count(),
      })
      .from(incidents)
      .where(and(gte(incidents.occurredAt, twentyFourMonthsAgo), eq(incidents.lostTime, true)))
      .groupBy(sql`to_char(${incidents.occurredAt}, 'YYYY-MM')`)

    // Real hours worked per month, from recorded periods (bucketed by start month).
    const hoursMonthly = await tx
      .select({
        bucket: sql<string>`to_char(${incidentHoursPeriods.periodStart}, 'YYYY-MM')`,
        h: sql<number>`COALESCE(SUM(${incidentHoursPeriods.totalHours}), 0)::float`,
      })
      .from(incidentHoursPeriods)
      .where(gte(incidentHoursPeriods.periodStart, twentyFourMonthsAgo.toISOString().slice(0, 10)))
      .groupBy(sql`to_char(${incidentHoursPeriods.periodStart}, 'YYYY-MM')`)

    // Build month-key list for the last 24 months, oldest -> newest. `YYYY-MM`.
    const monthKeys: string[] = []
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    const recordableByMonth = new Map<string, number>()
    for (const r of recordableMonthly) recordableByMonth.set(r.bucket, Number(r.c))
    const dartByMonth = new Map<string, number>()
    for (const r of dartMonthly) dartByMonth.set(r.bucket, Number(r.c))
    const hoursByMonth = new Map<string, number>()
    for (const r of hoursMonthly) hoursByMonth.set(r.bucket, Number(r.h))

    const recordable24 = monthKeys.map((k) => recordableByMonth.get(k) ?? 0)
    const dart24 = monthKeys.map((k) => dartByMonth.get(k) ?? 0)
    const hours24 = monthKeys.map((k) => hoursByMonth.get(k) ?? 0)

    // Last 12 months -> current window, prior 12 -> previous window
    const recordablePrev12 = recordable24.slice(0, 12).reduce((a, b) => a + b, 0)
    const recordable12 = recordable24.slice(12).reduce((a, b) => a + b, 0)
    const dartPrev12 = dart24.slice(0, 12).reduce((a, b) => a + b, 0)
    const dart12 = dart24.slice(12).reduce((a, b) => a + b, 0)
    const hoursPrev12 = hours24.slice(0, 12).reduce((a, b) => a + b, 0)
    const hours12mo = hours24.slice(12).reduce((a, b) => a + b, 0)

    const recordableCount = recordable12
    const dartCount = dart12
    // Null when no hours are recorded — never a fabricated rate.
    const rate = (events: number, hours: number): number | null =>
      hours > 0 ? Number(((events * 200_000) / hours).toFixed(2)) : null
    const trir = rate(recordable12, hours12mo)
    const dart = rate(dart12, hours12mo)
    const trirPrev = rate(recordablePrev12, hoursPrev12)
    const dartPrev = rate(dartPrev12, hoursPrev12)

    // Per-month real rates for the sparkline (last 12 months) — null where a
    // month has no recorded hours.
    const trirTrend: ReadonlyArray<number | null> = recordable24
      .slice(12)
      .map((n, i) => rate(n, hours24[12 + i] ?? 0))
    const dartTrend: ReadonlyArray<number | null> = dart24
      .slice(12)
      .map((n, i) => rate(n, hours24[12 + i] ?? 0))

    // --- Training compliance % -------------------------------------------
    // From the unified compliance engine's materialised scoreboard
    // (compliance_status) filtered to training + cert obligations — NOT the
    // decommissioned legacy assignment table (empty post-cutover). Matches the
    // Insights "Training compliance" card.
    const tcRows = await tx
      .select({ status: complianceStatus.status, c: count() })
      .from(complianceStatus)
      .innerJoin(complianceObligations, eq(complianceObligations.id, complianceStatus.obligationId))
      .where(inArray(complianceObligations.sourceModule, ['training', 'cert_requirement']))
      .groupBy(complianceStatus.status)
    const trainingTotal = tcRows.reduce((acc, r) => acc + Number(r.c), 0)
    const trainingCompleted = tcRows
      .filter((r) => r.status === 'completed')
      .reduce((acc, r) => acc + Number(r.c), 0)
    const trainingCompliancePct =
      trainingTotal === 0 ? null : Math.round((trainingCompleted / trainingTotal) * 100)

    // --- Document compliance % -------------------------------------------
    // From compliance_status (document obligations) — the unified engine already
    // resolved audiences + acknowledgments, so it's a simple completed ÷ total
    // (no per-tier audience approximation). Matches the Insights card.
    const dcRows = await tx
      .select({ status: complianceStatus.status, c: count() })
      .from(complianceStatus)
      .innerJoin(complianceObligations, eq(complianceObligations.id, complianceStatus.obligationId))
      .where(eq(complianceObligations.sourceModule, 'document'))
      .groupBy(complianceStatus.status)
    const documentExpected = dcRows.reduce((acc, r) => acc + Number(r.c), 0)
    const documentAcked = dcRows
      .filter((r) => r.status === 'completed')
      .reduce((acc, r) => acc + Number(r.c), 0)
    const documentCompliancePct =
      documentExpected === 0 ? null : Math.round((documentAcked / documentExpected) * 100)

    // --- Compliance trends -----------------------------------------------
    // We don't snapshot historical compliance, so there is NO trend to show —
    // a flat null series, never a fabricated curve. Wire to a real snapshots
    // table when one exists.
    const trainingComplianceTrend: ReadonlyArray<number | null> = Array.from(
      { length: 12 },
      () => null,
    )
    const documentComplianceTrend: ReadonlyArray<number | null> = Array.from(
      { length: 12 },
      () => null,
    )

    // --- CA aging --------------------------------------------------------
    const [agingRow] = await tx
      .select({
        avgDays: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (now() - ${correctiveActions.createdAt})) / 86400), 0)::float`,
      })
      .from(correctiveActions)
      .where(isNull(correctiveActions.closedAt))
    const openCAAgingDays =
      agingRow && Number(agingRow.avgDays) > 0 ? Math.round(Number(agingRow.avgDays)) : null

    // CA bucket counts by age — the dashboard surfaces these as four small
    // chips so safety leads can see at a glance whether actions are
    // languishing.
    const [bucketRow] = await tx
      .select({
        lt7: sql<number>`SUM(CASE WHEN now() - ${correctiveActions.createdAt} < interval '7 days' THEN 1 ELSE 0 END)::int`,
        lt30: sql<number>`SUM(CASE WHEN now() - ${correctiveActions.createdAt} >= interval '7 days' AND now() - ${correctiveActions.createdAt} < interval '30 days' THEN 1 ELSE 0 END)::int`,
        lt60: sql<number>`SUM(CASE WHEN now() - ${correctiveActions.createdAt} >= interval '30 days' AND now() - ${correctiveActions.createdAt} < interval '60 days' THEN 1 ELSE 0 END)::int`,
        ge60: sql<number>`SUM(CASE WHEN now() - ${correctiveActions.createdAt} >= interval '60 days' THEN 1 ELSE 0 END)::int`,
      })
      .from(correctiveActions)
      .where(isNull(correctiveActions.closedAt))
    const openCABuckets = {
      lt7: Number(bucketRow?.lt7 ?? 0),
      lt30: Number(bucketRow?.lt30 ?? 0),
      lt60: Number(bucketRow?.lt60 ?? 0),
      ge60: Number(bucketRow?.ge60 ?? 0),
    }

    // --- Days since last recordable --------------------------------------
    // "Recordable" follows the OSHA definition: medical_aid + lost_time +
    // fatality. The number is iconic on safety dashboards — culture > data.
    const [lastRecRow] = await tx
      .select({
        when: sql<Date | null>`MAX(${incidents.occurredAt})`,
      })
      .from(incidents)
      .where(
        and(
          inArray(incidents.severity, ['medical_aid', 'lost_time', 'fatality']),
          lte(incidents.occurredAt, now),
        ),
      )
    const lastRecordableAt = lastRecRow?.when ? new Date(lastRecRow.when) : null
    const daysSinceLastRecordable = lastRecordableAt
      ? Math.max(0, Math.floor((now.getTime() - lastRecordableAt.getTime()) / 86400000))
      : null

    // --- 12-month severity distribution (Heinrich pyramid) ---------------
    const severityRows = await tx
      .select({
        sev: incidents.severity,
        n: count(),
      })
      .from(incidents)
      .where(gte(incidents.occurredAt, twelveMonthsAgo))
      .groupBy(incidents.severity)
    const severityDistribution = {
      fatality: 0,
      lostTime: 0,
      medicalAid: 0,
      firstAid: 0,
      nearMiss: 0,
      noInjury: 0,
      propertyDamage: 0,
    }
    for (const r of severityRows) {
      const n = Number(r.n ?? 0)
      switch (r.sev) {
        case 'fatality':
          severityDistribution.fatality = n
          break
        case 'lost_time':
          severityDistribution.lostTime = n
          break
        case 'medical_aid':
          severityDistribution.medicalAid = n
          break
        case 'first_aid_only':
          severityDistribution.firstAid = n
          break
        case 'no_injury':
          severityDistribution.noInjury = n
          break
      }
    }
    // Near-misses + property damage live on the incident.type column rather
    // than the severity enum, so they need their own count.
    const [nmRow] = await tx
      .select({ n: count() })
      .from(incidents)
      .where(and(gte(incidents.occurredAt, twelveMonthsAgo), eq(incidents.type, 'near_miss')))
    severityDistribution.nearMiss = Number(nmRow?.n ?? 0)
    const [pdRow] = await tx
      .select({ n: count() })
      .from(incidents)
      .where(and(gte(incidents.occurredAt, twelveMonthsAgo), eq(incidents.type, 'property_damage')))
    severityDistribution.propertyDamage = Number(pdRow?.n ?? 0)

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
      const days = r.dueOn ? Math.round((today.getTime() - new Date(r.dueOn).getTime()) / dayMs) : 0
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

    // --- Personal "my" widgets -------------------------------------------
    // Resolve the logged-in user's person record once; all three personal
    // widgets key off it. Unlinked users (no person row) get empty states.
    const [myPerson] = ctx.userId
      ? await tx
          .select({ id: people.id })
          .from(people)
          .where(and(eq(people.userId, ctx.userId), isNull(people.deletedAt)))
          .limit(1)
      : []
    const myPersonId = myPerson?.id ?? null

    // PPE currently issued to me — soonest pre-use inspection first.
    const myPpe = myPersonId
      ? (
          await tx
            .select({
              id: ppeItems.id,
              serialNumber: ppeItems.serialNumber,
              size: ppeItems.size,
              status: ppeItems.status,
              nextInspectionDue: ppeItems.nextInspectionDue,
              nextAnnualInspectionDue: ppeItems.nextAnnualInspectionDue,
              expiresOn: ppeItems.expiresOn,
              typeName: ppeTypes.name,
            })
            .from(ppeItems)
            .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
            .where(
              and(
                eq(ppeItems.currentHolderPersonId, myPersonId),
                eq(ppeItems.status, 'issued'),
                isNull(ppeItems.deletedAt),
              ),
            )
            .orderBy(asc(ppeItems.nextInspectionDue))
            .limit(12)
        ).map((r) => ({
          id: r.id,
          typeName: r.typeName,
          serialNumber: r.serialNumber,
          size: r.size,
          status: r.status,
          nextInspectionDue: r.nextInspectionDue ? String(r.nextInspectionDue) : null,
          nextAnnualInspectionDue: r.nextAnnualInspectionDue
            ? String(r.nextAnnualInspectionDue)
            : null,
          expiresOn: r.expiresOn ? String(r.expiresOn) : null,
        }))
      : []

    // Equipment checked out to me — open checkouts (returnedAt IS NULL) are the
    // source of truth; oldest checkout first.
    const myEquipment = myPersonId
      ? (
          await tx
            .select({
              id: equipmentItems.id,
              checkoutId: equipmentCheckouts.id,
              name: equipmentItems.name,
              assetTag: equipmentItems.assetTag,
              status: equipmentItems.status,
              requiresAnnualInspection: equipmentItems.requiresAnnualInspection,
              nextAnnualInspectionDue: equipmentItems.nextAnnualInspectionDue,
              typeName: equipmentTypes.name,
              expectedReturnOn: equipmentCheckouts.expectedReturnOn,
            })
            .from(equipmentCheckouts)
            .innerJoin(equipmentItems, eq(equipmentItems.id, equipmentCheckouts.equipmentItemId))
            .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
            .where(
              and(
                eq(equipmentCheckouts.holderPersonId, myPersonId),
                isNull(equipmentCheckouts.returnedAt),
                isNull(equipmentItems.deletedAt),
              ),
            )
            .orderBy(asc(equipmentCheckouts.checkedOutAt))
            .limit(12)
        ).map((r) => ({
          id: r.id,
          checkoutId: r.checkoutId,
          name: r.name,
          assetTag: r.assetTag,
          typeName: r.typeName,
          status: r.status,
          requiresAnnualInspection: r.requiresAnnualInspection,
          nextAnnualInspectionDue: r.nextAnnualInspectionDue
            ? String(r.nextAnnualInspectionDue)
            : null,
          expectedReturnOn: r.expectedReturnOn ? String(r.expectedReturnOn) : null,
        }))
      : []

    // My compliance — read the materialised scoreboard for active obligations.
    const complianceRows = myPersonId
      ? await tx
          .select({
            obligationId: complianceObligations.id,
            kind: complianceObligations.sourceModule,
            title: complianceObligations.title,
            status: complianceStatus.status,
            dueOn: complianceStatus.dueOn,
          })
          .from(complianceStatus)
          .innerJoin(
            complianceObligations,
            eq(complianceObligations.id, complianceStatus.obligationId),
          )
          .where(
            and(
              eq(complianceStatus.tenantId, ctx.tenantId),
              eq(complianceStatus.personId, myPersonId),
              isNull(complianceObligations.deletedAt),
              eq(complianceObligations.status, 'active'),
            ),
          )
          .limit(1000)
      : []
    const cTotal = complianceRows.length
    const cCompleted = complianceRows.filter((r) => r.status === 'completed').length
    const cOverdue = complianceRows.filter((r) => r.status === 'overdue').length
    const cDueSoon = complianceRows.filter((r) => r.status === 'expiring').length
    const cPending = complianceRows.filter(
      (r) => r.status === 'pending' || r.status === 'in_progress',
    ).length
    const outstandingRank = (s: string) =>
      s === 'overdue' ? 0 : s === 'expiring' ? 1 : s === 'in_progress' ? 2 : 3
    const cOutstanding = complianceRows
      .filter((r) => ['overdue', 'expiring', 'pending', 'in_progress'].includes(r.status))
      .sort(
        (a, b) =>
          outstandingRank(a.status) - outstandingRank(b.status) ||
          (a.dueOn ?? '9999-12-31').localeCompare(b.dueOn ?? '9999-12-31'),
      )
      .slice(0, 5)
      .map((r) => ({
        obligationId: r.obligationId,
        kind: r.kind as string,
        title: r.title,
        status: r.status,
        dueOn: r.dueOn ? String(r.dueOn) : null,
      }))
    const myCompliance = {
      linked: myPersonId !== null,
      total: cTotal,
      completed: cCompleted,
      overdue: cOverdue,
      dueSoon: cDueSoon,
      pending: cPending,
      percent: cTotal === 0 ? null : Math.round((cCompleted / cTotal) * 100),
      outstanding: cOutstanding,
    }

    // --- In-progress entries (current user's unfinished work) ------------
    // Drafts / in-progress records the logged-in user authored across modules,
    // newest-touched first. Keyed by tenant-user id (ctx.membership.id); an
    // account without a membership (e.g. super-admin) simply gets an empty list.
    const myTenantUserId = ctx.membership?.id ?? null
    const inProgressEntries: DashboardMetrics['inProgressEntries'] = []
    if (myTenantUserId) {
      const toIso = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d))
      const [jDrafts, hzDrafts, incDrafts, insDrafts] = await Promise.all([
        tx
          .select({
            id: journalEntries.id,
            title: journalEntries.title,
            updatedAt: journalEntries.updatedAt,
          })
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.createdByTenantUserId, myTenantUserId),
              eq(journalEntries.status, 'draft'),
              isNull(journalEntries.deletedAt),
            ),
          )
          .orderBy(desc(journalEntries.updatedAt))
          .limit(8),
        tx
          .select({
            id: hazidAssessments.id,
            reference: hazidAssessments.reference,
            jobScope: hazidAssessments.jobScope,
            updatedAt: hazidAssessments.updatedAt,
          })
          .from(hazidAssessments)
          .where(
            and(
              eq(hazidAssessments.reportedByTenantUserId, myTenantUserId),
              eq(hazidAssessments.inProgress, true),
              eq(hazidAssessments.locked, false),
              isNull(hazidAssessments.deletedAt),
            ),
          )
          .orderBy(desc(hazidAssessments.updatedAt))
          .limit(8),
        tx
          .select({
            id: incidents.id,
            title: incidents.title,
            reference: incidents.reference,
            updatedAt: incidents.updatedAt,
          })
          .from(incidents)
          .where(
            and(
              eq(incidents.reportedByTenantUserId, myTenantUserId),
              eq(incidents.isDraft, true),
              isNull(incidents.deletedAt),
            ),
          )
          .orderBy(desc(incidents.updatedAt))
          .limit(8),
        tx
          .select({
            id: inspectionRecords.id,
            reference: inspectionRecords.reference,
            typeName: inspectionTypes.name,
            updatedAt: inspectionRecords.updatedAt,
          })
          .from(inspectionRecords)
          .leftJoin(inspectionTypes, eq(inspectionTypes.id, inspectionRecords.typeId))
          .where(
            and(
              eq(inspectionRecords.inspectorTenantUserId, myTenantUserId),
              inArray(inspectionRecords.status, ['draft', 'in_progress']),
              isNull(inspectionRecords.deletedAt),
            ),
          )
          .orderBy(desc(inspectionRecords.updatedAt))
          .limit(8),
      ])
      for (const r of jDrafts)
        inProgressEntries.push({
          id: r.id,
          kind: 'journal',
          title: r.title?.trim() || 'Untitled journal entry',
          href: `/journals/${r.id}`,
          updatedAt: toIso(r.updatedAt),
        })
      for (const r of hzDrafts)
        inProgressEntries.push({
          id: r.id,
          kind: 'hazard_assessment',
          title: r.jobScope?.trim() || r.reference,
          href: `/hazard-assessments/${r.id}`,
          updatedAt: toIso(r.updatedAt),
        })
      for (const r of incDrafts)
        inProgressEntries.push({
          id: r.id,
          kind: 'incident',
          title: r.title?.trim() || r.reference,
          href: `/incidents/${r.id}`,
          updatedAt: toIso(r.updatedAt),
        })
      for (const r of insDrafts)
        inProgressEntries.push({
          id: r.id,
          kind: 'inspection',
          title: r.typeName?.trim() || r.reference,
          href: `/inspections/records/${r.id}`,
          updatedAt: toIso(r.updatedAt),
        })
      // Newest-touched first across every module, then cap the merged list.
      inProgressEntries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      inProgressEntries.splice(12)
    }

    return {
      incidents30: Number(incRow?.c ?? 0),
      incidentsPrev30: Number(incPrev?.c ?? 0),
      openCAs: Number(caRow?.c ?? 0),
      overdueCAs: Number(caOverdue?.c ?? 0),
      submissionsToday: Number(subRow?.c ?? 0),
      expiringCertsCount: Number(certRow?.c ?? 0),
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
        prevValue: trirPrev,
        trend: trirTrend,
      },
      dart: {
        value: dart,
        dartCount,
        hoursWorked: hours12mo,
        prevValue: dartPrev,
        trend: dartTrend,
      },

      trainingCompliancePct,
      trainingComplianceCounts: { completed: trainingCompleted, total: trainingTotal },
      documentCompliancePct,
      documentComplianceCounts: { acknowledged: documentAcked, expected: documentExpected },
      trainingComplianceTrend,
      documentComplianceTrend,

      openCAAgingDays,
      openCABuckets,
      daysSinceLastRecordable,
      lastRecordableAt,
      severityDistribution,

      recentIncidents,
      dueCAs,
      expiringCertsList,
      myInbox,
      topSitesByIncidents,
      topOverdueCAs,
      expiringTraining30d,

      myPpe,
      myEquipment,
      myCompliance,
      inProgressEntries,
    }
  })
}
