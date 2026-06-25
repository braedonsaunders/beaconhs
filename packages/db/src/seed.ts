import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { createClient } from './client'
import {
  BUILTIN_ROLES,
  correctiveActions,
  crews,
  customerContacts,
  departments,
  documents,
  documentAcknowledgments,
  documentReviews,
  documentVersions,
  documentTypes,
  documentCategories,
  documentReferenceTypes,
  documentReferenceCategories,
  equipmentCategories,
  equipmentExpenses,
  equipmentItems,
  equipmentLogEntries,
  equipmentRates,
  equipmentTypes,
  equipmentWorkOrders,
  equipmentLocationHistory,
  formAssignments,
  formResponses,
  formTemplates,
  formTemplateVersions,
  incidentClassifications,
  incidentHoursPeriods,
  incidentInjuries,
  incidentInjuryTypes,
  incidentLostTimeEvents,
  incidentPeople,
  incidents,
  inspectionBankCriteria,
  inspectionBanks,
  inspectionRecordCriteria,
  inspectionRecords,
  inspectionTypeCriteria,
  inspectionTypeGroups,
  inspectionTypes,
  notifications,
  orgUnits,
  people,
  ppeAnnualRecords,
  ppeInspections,
  ppeIssueReports,
  ppeIssues,
  ppeItems,
  ppeTypeInspectionCriteria,
  ppeTypes,
  reportDefinitions,
  roles,
  tenants,
  tenantUsers,
  safeDistanceRecords,
  safeDistanceSegments,
  trades,
  trainingCourses,
  trainingRecords,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
  trainingAssessments,
  trainingAssessmentResults,
  trainingAssessmentTypes,
  trainingAssessmentTypeQuestions,
  user,
  // HazID / JSHA
  hazidAssessmentTypePPE,
  hazidAssessmentTypeApps,
  hazidAssessmentTypeQuestions,
  hazidAssessmentTypes,
  hazidHazardSets,
  hazidHazardTypes,
  hazidHazards,
  hazidTasks,
  // People groups / titles + per-title tasks
  jobTitleTaskAcknowledgments,
  jobTitleTasks,
  personGroupMemberships,
  personGroups,
  personTitleAssignments,
  personTitles,
} from './schema'
import type { FormSchemaV1 } from './schema'
import { CANONICAL_TEMPLATES } from './canonical-templates'
import { seedHazardAssessmentAppTemplates } from './seed/hazard-assessment-app-templates'
import { seedLiftPlanTemplate } from './seed/lift-plan-template'
import { seedToolboxTemplate } from './seed/toolbox-template'

async function main() {
  const { db, sql: pg } = createClient()
  console.log('▶ Seeding…')

  // --- Report definitions (cross-tenant catalogue) ---------------------
  // Run every seed invocation so new definitions land even on re-seed.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    await tx
      .insert(reportDefinitions)
      .values([
        {
          slug: 'incidents_weekly',
          kind: 'built_in',
          name: 'Weekly Incidents Summary',
          description:
            'All incidents in the configured date range (default last 7 days), grouped by severity, with status summary cards.',
          category: 'incidents',
          queryKind: 'incidents_summary',
        },
        {
          slug: 'training_expiring_30d',
          kind: 'built_in',
          name: 'Training Expiring (30 days)',
          description:
            'Training records expiring in the next N days (default 30), grouped by course.',
          category: 'training',
          queryKind: 'training_expiring',
        },
        {
          slug: 'corrective_actions_open',
          kind: 'built_in',
          name: 'Open Corrective Actions',
          description:
            'All open, in-progress, and pending-verification corrective actions grouped by status, sorted by due date.',
          category: 'corrective_actions',
          queryKind: 'corrective_actions_open',
        },
        {
          slug: 'inspections_completed_weekly',
          kind: 'built_in',
          name: 'Inspections Completed (weekly)',
          description: 'Completed inspections in the configured date range, grouped by template.',
          category: 'inspections',
          queryKind: 'inspections_completed',
        },
        {
          slug: 'documents_overdue_review',
          kind: 'built_in',
          name: 'Documents Overdue Review',
          description:
            'Published documents whose next-review date has passed, grouped by category.',
          category: 'documents',
          queryKind: 'documents_overdue_review',
        },
        // ----- Cross-module shared infrastructure reports ----------------
        {
          slug: 'safety_kpi_monthly',
          kind: 'built_in',
          name: 'Monthly Safety KPI Pack',
          description:
            'Headline safety KPIs over the configured window (default last 30 days): incident totals by severity, open CA aging, training compliance %, document compliance %, and inspection volume.',
          category: 'cross_module',
          queryKind: 'safety_kpi_summary',
        },
        {
          slug: 'site_safety_scorecard',
          kind: 'built_in',
          name: 'Site Safety Scorecard',
          description:
            'Per-site rollup of incidents, open CAs, completed inspections, and lone-worker activity in the configured window. Sorted by incident count desc.',
          category: 'cross_module',
          queryKind: 'site_scorecard',
        },
        {
          slug: 'overdue_everything',
          kind: 'built_in',
          name: 'Overdue Items (All Modules)',
          description:
            'Single roll-up of every overdue item across CAs, documents, training, equipment annual inspections, and PPE inspections. Useful as a weekly Monday-morning blast.',
          category: 'cross_module',
          queryKind: 'overdue_rollup',
        },
        {
          slug: 'lone_worker_weekly',
          kind: 'built_in',
          name: 'Weekly Monitored Sessions',
          description:
            'Monitored sessions started in the configured window, grouped by status — useful for spotting missed/escalated patterns.',
          category: 'lone_worker',
          queryKind: 'lone_worker_summary',
        },
        {
          slug: 'training_compliance_snapshot',
          kind: 'built_in',
          name: 'Training Compliance Snapshot',
          description:
            'Audience-assignment compliance summary as of report time, grouped by status (pending / in_progress / completed / overdue) with per-assignment counts.',
          category: 'training',
          queryKind: 'training_compliance_snapshot',
        },
        {
          slug: 'document_compliance_snapshot',
          kind: 'built_in',
          name: 'Document Compliance Snapshot',
          description:
            'Per-assignment document acknowledgment compliance: how many of the audience have acknowledged the current version vs. still owe.',
          category: 'documents',
          queryKind: 'document_compliance_snapshot',
        },
        {
          slug: 'incidents_trend_12m',
          kind: 'built_in',
          name: 'Incidents Trend (12 months)',
          description:
            'Monthly incident counts by severity for the last 12 calendar months. Useful for board packs.',
          category: 'incidents',
          queryKind: 'incidents_trend_12m',
        },
        {
          slug: 'osha_300_log',
          kind: 'built_in',
          name: 'OSHA 300 Recordable Log',
          description:
            'OSHA 300/300A-style log of recordable incidents in the configured window (default last 12 months): case number, employee, classification, days away / restricted, and outcome. Export to PDF for filing.',
          category: 'incidents',
          queryKind: 'osha_300_log',
        },
        // ----- Legacy BeaconHS report parity --------------------------------
        // Faithful ports of the legacy Laravel app's on-demand + scheduled
        // reports, expressed as custom-query definitions over the curated
        // entities (training_matrix / skill_assignments / equipment / ppe /
        // corrective_actions). The matrix views pre-compute coverage_status on
        // a 90-day "expiring" window — matching the legacy reports exactly.
        {
          slug: 'legacy_training_cert_matrix',
          kind: 'built_in',
          name: 'Training — Certificate Matrix',
          description:
            'Every active person × course with the latest certificate status (valid / expiring / expired / missing), grouped by person. Mirrors the legacy Training Certificates Matrix.',
          category: 'training',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'training_matrix',
            mode: 'rows',
            columns: [
              'person_name',
              'employee_no',
              'course_code',
              'course_name',
              'completed_on',
              'expires_on',
              'coverage_status',
            ],
            groupBy: 'person_name',
            sort: { column: 'person_name', direction: 'asc' },
            chart: { type: 'donut', dimension: 'coverage_status', metric: 'count' },
            limit: 10000,
          },
        },
        {
          slug: 'legacy_training_certificates',
          kind: 'built_in',
          name: 'Training — Certificates',
          description:
            'Held training certificates (valid, expiring, or expired — excludes never-trained), grouped by course. Mirrors the legacy Training Certificates listing.',
          category: 'training',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'training_matrix',
            mode: 'rows',
            columns: [
              'course_name',
              'person_name',
              'employee_no',
              'completed_on',
              'expires_on',
              'coverage_status',
            ],
            filtersV2: {
              combinator: 'and',
              rules: [
                { field: 'coverage_status', op: 'in', value: ['valid', 'expiring', 'expired'] },
              ],
            },
            groupBy: 'course_name',
            sort: { column: 'person_name', direction: 'asc' },
            limit: 10000,
          },
        },
        {
          slug: 'legacy_training_expired',
          kind: 'built_in',
          name: 'Training — Expired & Upcoming',
          description:
            'Training certificates that are expired or expiring within 90 days, grouped by course. Mirrors the legacy Training Certificates Expired & Upcoming report.',
          category: 'training',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'training_matrix',
            mode: 'rows',
            columns: ['person_name', 'employee_no', 'course_name', 'expires_on', 'coverage_status'],
            filtersV2: {
              combinator: 'and',
              rules: [{ field: 'coverage_status', op: 'in', value: ['expired', 'expiring'] }],
            },
            groupBy: 'course_name',
            sort: { column: 'expires_on', direction: 'asc' },
            limit: 5000,
          },
        },
        {
          slug: 'legacy_training_missing',
          kind: 'built_in',
          name: 'Training — Missing',
          description:
            'People who are missing a required course entirely or whose certificate has expired, grouped by course. Mirrors the legacy Training Certificates Missing report.',
          category: 'training',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'training_matrix',
            mode: 'rows',
            columns: ['person_name', 'employee_no', 'course_name', 'expires_on', 'coverage_status'],
            filtersV2: {
              combinator: 'and',
              rules: [{ field: 'coverage_status', op: 'in', value: ['missing', 'expired'] }],
            },
            groupBy: 'course_name',
            sort: { column: 'person_name', direction: 'asc' },
            limit: 10000,
          },
        },
        {
          slug: 'legacy_skills_matrix',
          kind: 'built_in',
          name: 'Skills — Matrix',
          description:
            'Externally-issued skills & certifications per person — authority, certificate, granted/expiry, and current status — grouped by issuing authority. Mirrors the legacy Training Skills Matrix.',
          category: 'training',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'skill_assignments',
            mode: 'rows',
            columns: [
              'last_name',
              'first_name',
              'employee_no',
              'trade',
              'authority',
              'certification_name',
              'granted_on',
              'expires_on',
              'status',
            ],
            groupBy: 'authority',
            sort: { column: 'last_name', direction: 'asc' },
            chart: { type: 'donut', dimension: 'status', metric: 'count' },
            limit: 5000,
          },
        },
        {
          slug: 'legacy_skills_expired',
          kind: 'built_in',
          name: 'Skills — Expired & Upcoming',
          description:
            'Skills & certifications expiring within 90 days or already expired, grouped by certification. Mirrors the legacy Training Skills Expired & Upcoming report.',
          category: 'training',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'skill_assignments',
            mode: 'rows',
            columns: [
              'last_name',
              'first_name',
              'employee_no',
              'authority',
              'certification_name',
              'expires_on',
              'status',
            ],
            filtersV2: {
              combinator: 'and',
              rules: [{ field: 'expires_on', op: 'due_within_days', value: 90 }],
            },
            groupBy: 'certification_name',
            sort: { column: 'expires_on', direction: 'asc' },
            limit: 5000,
          },
        },
        {
          slug: 'legacy_skills_cwb',
          kind: 'built_in',
          name: 'Skills — CWB (Welding)',
          description:
            'Canadian Welding Bureau qualifications roster — qualified people with certificate, granted/expiry, and status. Mirrors the legacy CWB report (the W47 Type/Process/Position/Level fields live on each skill record).',
          category: 'training',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'skill_assignments',
            mode: 'rows',
            columns: [
              'last_name',
              'first_name',
              'employee_no',
              'trade',
              'certification_code',
              'certification_name',
              'granted_on',
              'expires_on',
              'status',
            ],
            filtersV2: {
              combinator: 'and',
              rules: [{ field: 'authority', op: 'eq', value: 'Canadian Welding Bureau' }],
            },
            sort: { column: 'last_name', direction: 'asc' },
            limit: 5000,
          },
        },
        {
          slug: 'legacy_corrective_list',
          kind: 'built_in',
          name: 'Corrective Actions — List',
          description:
            'Every corrective action across all statuses, grouped by status and sorted by due date. Mirrors the legacy Corrective Actions List report.',
          category: 'corrective_actions',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'corrective_actions',
            mode: 'rows',
            columns: [
              'reference',
              'title',
              'severity',
              'status',
              'source',
              'assigned_on',
              'due_on',
            ],
            groupBy: 'status',
            sort: { column: 'due_on', direction: 'desc' },
            chart: { type: 'donut', dimension: 'status', metric: 'count' },
            limit: 5000,
          },
        },
        {
          slug: 'legacy_ppe_list',
          kind: 'built_in',
          name: 'PPE — List',
          description:
            'All active PPE items (issued or in stock) with serial, size, status, and inspection dates. Mirrors the legacy PPE List report.',
          category: 'ppe',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'ppe',
            mode: 'rows',
            columns: [
              'serial_number',
              'size',
              'status',
              'next_inspection_due',
              'next_annual_inspection_due',
              'expires_on',
            ],
            filtersV2: {
              combinator: 'and',
              rules: [{ field: 'status', op: 'in', value: ['issued', 'in_stock'] }],
            },
            sort: { column: 'serial_number', direction: 'asc' },
            limit: 5000,
          },
        },
        {
          slug: 'legacy_ppe_expired',
          kind: 'built_in',
          name: 'PPE — Expired & Upcoming',
          description:
            'Active PPE whose annual inspection is overdue or due within 90 days, soonest first. Mirrors the legacy PPE Expired & Upcoming report.',
          category: 'ppe',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'ppe',
            mode: 'rows',
            columns: ['serial_number', 'size', 'status', 'next_annual_inspection_due'],
            filtersV2: {
              combinator: 'and',
              rules: [
                { field: 'status', op: 'in', value: ['issued', 'in_stock'] },
                { field: 'next_annual_inspection_due', op: 'due_within_days', value: 90 },
              ],
            },
            sort: { column: 'next_annual_inspection_due', direction: 'asc' },
            limit: 5000,
          },
        },
        {
          slug: 'ppe_expiring',
          kind: 'built_in',
          name: 'PPE — Expiring soon',
          description: 'Active PPE whose service life expires within 30 days, soonest first.',
          category: 'ppe',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'ppe',
            mode: 'rows',
            columns: ['serial_number', 'size', 'status', 'expires_on'],
            filtersV2: {
              combinator: 'and',
              rules: [
                { field: 'status', op: 'in', value: ['issued', 'in_stock'] },
                { field: 'expires_on', op: 'gte', value: '2000-01-01' },
                { field: 'expires_on', op: 'due_within_days', value: 30 },
              ],
            },
            sort: { column: 'expires_on', direction: 'asc' },
            limit: 5000,
          },
        },
        {
          slug: 'ppe_inspection_due',
          kind: 'built_in',
          name: 'PPE — Inspection due',
          description:
            'Active PPE whose next pre-use inspection is overdue or due within 14 days, soonest first.',
          category: 'ppe',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'ppe',
            mode: 'rows',
            columns: [
              'serial_number',
              'size',
              'status',
              'last_inspection_on',
              'next_inspection_due',
            ],
            filtersV2: {
              combinator: 'and',
              rules: [
                { field: 'status', op: 'in', value: ['issued', 'in_stock'] },
                { field: 'next_inspection_due', op: 'gte', value: '2000-01-01' },
                { field: 'next_inspection_due', op: 'due_within_days', value: 14 },
              ],
            },
            sort: { column: 'next_inspection_due', direction: 'asc' },
            limit: 5000,
          },
        },
      ])
      .onConflictDoNothing({ target: reportDefinitions.slug })

    // Equipment reports — migrated out of the retired native /equipment/reports
    // pages into the global engine. Upserted (not insert-once) so the upgraded
    // definitions reach already-seeded tenants too. They read the join-baked
    // report_equipment_fleet / report_equipment_charges views, so type/site/holder
    // names, YTD + all-time usage, ROI, and per-project charges all resolve.
    await tx
      .insert(reportDefinitions)
      .values([
        {
          slug: 'legacy_equipment_fleet',
          kind: 'built_in',
          name: 'Equipment — Fleet',
          description:
            'In-service assets with type, current site/holder, YTD usage and cost, and next annual inspection — the fleet register.',
          category: 'equipment',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'equipment_fleet',
            mode: 'rows',
            columns: [
              'asset_tag',
              'name',
              'equipment_type',
              'status',
              'site_name',
              'holder_name',
              'hours_ytd',
              'km_ytd',
              'expenses_ytd',
              'last_annual_inspection_on',
              'next_annual_inspection_due',
            ],
            filtersV2: {
              combinator: 'and',
              rules: [{ field: 'status', op: 'eq', value: 'in_service' }],
            },
            sort: { column: 'asset_tag', direction: 'asc' },
            limit: 5000,
          },
        },
        {
          slug: 'legacy_equipment_roi',
          kind: 'built_in',
          name: 'Equipment — Return on investment',
          description:
            'Revenue (type rate × all-time hours) minus expenses minus purchase price per asset, highest net first.',
          category: 'equipment',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'equipment_fleet',
            mode: 'rows',
            columns: [
              'asset_tag',
              'name',
              'equipment_type',
              'hours_total',
              'hourly_rate',
              'revenue_total',
              'expenses_total',
              'purchase_price',
              'net_total',
            ],
            sort: { column: 'net_total', direction: 'desc' },
            limit: 5000,
          },
        },
        {
          slug: 'legacy_equipment_inspections',
          kind: 'built_in',
          name: 'Equipment — Upcoming & overdue inspections',
          description:
            'Assets whose annual inspection is overdue or due within 30 days, soonest first.',
          category: 'equipment',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'equipment_fleet',
            mode: 'rows',
            columns: [
              'asset_tag',
              'name',
              'equipment_type',
              'site_name',
              'holder_name',
              'last_annual_inspection_on',
              'next_annual_inspection_due',
            ],
            filtersV2: {
              combinator: 'and',
              rules: [
                { field: 'requires_annual_inspection', op: 'is_true' },
                { field: 'next_annual_inspection_due', op: 'due_within_days', value: 30 },
              ],
            },
            sort: { column: 'next_annual_inspection_due', direction: 'asc' },
            limit: 5000,
          },
        },
        {
          slug: 'legacy_equipment_oilchange',
          kind: 'built_in',
          name: 'Equipment — Upcoming & overdue oil changes',
          description: 'Assets whose oil change is overdue or due within 30 days, soonest first.',
          category: 'equipment',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'equipment_fleet',
            mode: 'rows',
            columns: [
              'asset_tag',
              'name',
              'equipment_type',
              'site_name',
              'holder_name',
              'last_oil_change_on',
              'next_oil_change_due',
              'oil_change_interval_months',
            ],
            filtersV2: {
              combinator: 'and',
              rules: [
                { field: 'requires_oil_change', op: 'is_true' },
                { field: 'next_oil_change_due', op: 'due_within_days', value: 30 },
              ],
            },
            sort: { column: 'next_oil_change_due', direction: 'asc' },
            limit: 5000,
          },
        },
        {
          slug: 'legacy_equipment_charges',
          kind: 'built_in',
          name: 'Equipment — Charges by project',
          description:
            'Per-project rollup of expenses plus type rate × usage hours across the fleet. Filter “Charged on” for a billing period.',
          category: 'equipment',
          queryKind: 'custom_query',
          customQuery: {
            entity: 'equipment_charges',
            mode: 'summarize',
            columns: [],
            breakouts: [{ column: 'project_name' }],
            measures: [
              { fn: 'sum', column: 'total_chargeable', label: 'Total chargeable' },
              { fn: 'sum', column: 'revenue', label: 'Revenue' },
              { fn: 'sum', column: 'expenses', label: 'Expenses' },
              { fn: 'sum', column: 'hours', label: 'Hours' },
              { fn: 'count_distinct', column: 'equipment_item_id', label: 'Equipment used' },
            ],
            limit: 5000,
          },
        },
      ])
      .onConflictDoUpdate({
        target: reportDefinitions.slug,
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          category: sql`excluded.category`,
          queryKind: sql`excluded.query_kind`,
          customQuery: sql`excluded.custom_query`,
          updatedAt: sql`now()`,
        },
      })
  })

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)

    // --- Super-admin ----------------------------------------------------
    const adminId = randomUUID()
    const inserted = await tx
      .insert(user)
      .values({
        id: adminId,
        email: 'admin@beaconhs.local',
        name: 'Super Admin',
        emailVerified: true,
        isSuperAdmin: true,
      })
      .onConflictDoNothing()
      .returning()

    if (inserted.length === 0) {
      console.log('  · super-admin already exists, skipping')
      return
    }
    const admin = inserted[0]!

    // --- Demo tenant ----------------------------------------------------
    const [tenant] = await tx
      .insert(tenants)
      .values({
        slug: 'demo',
        name: 'Acme Industrial',
        defaultLanguage: 'en',
        enabledLanguages: ['en'],
        branding: { primaryColor: '#0f766e' },
        riskMatrix: {
          axes: {
            severity: { values: ['Trivial', 'Minor', 'Moderate', 'Major', 'Catastrophic'] },
            likelihood: { values: ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'] },
          },
          cells: build5x5(),
        },
      })
      .returning()
    if (!tenant) throw new Error('Failed to create tenant')

    const [membership] = await tx
      .insert(tenantUsers)
      .values({
        tenantId: tenant.id,
        userId: admin.id,
        status: 'active',
        joinedAt: new Date(),
        displayName: 'Super Admin',
      })
      .returning()
    if (!membership) throw new Error('Failed to create membership')

    for (const [key, def] of Object.entries(BUILTIN_ROLES)) {
      await tx.insert(roles).values({
        tenantId: tenant.id,
        key,
        name: def.name,
        description: def.description,
        isBuiltIn: true,
        permissions: def.permissions as unknown as string[],
      })
    }

    // --- Org hierarchy --------------------------------------------------
    const customer = await insertOrgUnit(tx, tenant.id, null, 'customer', 'Acme Refinery')
    const project = await insertOrgUnit(tx, tenant.id, customer.id, 'project', 'Turnaround 2026')
    const siteA = await insertOrgUnit(tx, tenant.id, project.id, 'site', 'Site A — Tank Farm', {
      lat: 43.6532,
      lng: -79.3832,
      geofenceMeters: 250,
    })
    const siteB = await insertOrgUnit(tx, tenant.id, project.id, 'site', 'Site B — Cracker Unit', {
      lat: 43.6629,
      lng: -79.3957,
      geofenceMeters: 250,
    })

    // --- Departments + Trades + Crews ----------------------------------
    const [fieldOps] = await tx
      .insert(departments)
      .values({ tenantId: tenant.id, name: 'Field Operations' })
      .returning()
    const [office] = await tx
      .insert(departments)
      .values({ tenantId: tenant.id, name: 'Office' })
      .returning()

    const [carp] = await tx
      .insert(trades)
      .values({ tenantId: tenant.id, name: 'Carpenter' })
      .returning()
    const [elec] = await tx
      .insert(trades)
      .values({ tenantId: tenant.id, name: 'Electrician' })
      .returning()
    const [weld] = await tx
      .insert(trades)
      .values({ tenantId: tenant.id, name: 'Welder' })
      .returning()
    const [supervisorTrade] = await tx
      .insert(trades)
      .values({ tenantId: tenant.id, name: 'Supervisor' })
      .returning()

    const [crewAlpha] = await tx
      .insert(crews)
      .values({ tenantId: tenant.id, name: 'Crew Alpha' })
      .returning()
    const [crewBravo] = await tx
      .insert(crews)
      .values({ tenantId: tenant.id, name: 'Crew Bravo' })
      .returning()

    // --- People ---------------------------------------------------------
    const peopleData = [
      {
        firstName: 'John',
        lastName: 'Anderson',
        formalName: 'John D. Anderson',
        jobTitle: 'Site Supervisor',
        employeeNo: 'E001',
        tradeId: supervisorTrade!.id,
        crewId: crewAlpha!.id,
        dept: fieldOps!.id,
        email: 'janderson@acme.example',
        phone: '+1-647-555-0101',
        emergencyContactName: 'Mary Anderson',
        emergencyContactPhone: '+1-647-555-9001',
        notes: 'Lead supervisor for Tank Farm operations. 15 years on site.',
      },
      {
        firstName: 'Sarah',
        lastName: 'Bell',
        formalName: 'Sarah J. Bell',
        jobTitle: 'Lead Carpenter',
        employeeNo: 'E002',
        tradeId: carp!.id,
        crewId: crewAlpha!.id,
        dept: fieldOps!.id,
        email: 'sbell@acme.example',
        phone: '+1-647-555-0102',
        emergencyContactName: 'Tom Bell',
        emergencyContactPhone: '+1-647-555-9002',
      },
      {
        firstName: 'Marcus',
        lastName: 'Chen',
        formalName: 'Marcus K. Chen',
        jobTitle: 'Journeyman Electrician',
        employeeNo: 'E003',
        tradeId: elec!.id,
        crewId: crewAlpha!.id,
        dept: fieldOps!.id,
        email: 'mchen@acme.example',
        phone: '+1-647-555-0103',
        emergencyContactName: 'Lisa Chen',
        emergencyContactPhone: '+1-647-555-9003',
      },
      {
        firstName: 'Priya',
        lastName: 'Desai',
        formalName: 'Priya N. Desai',
        jobTitle: 'Pipe Welder',
        employeeNo: 'E004',
        tradeId: weld!.id,
        crewId: crewAlpha!.id,
        dept: fieldOps!.id,
        email: 'pdesai@acme.example',
        phone: '+1-647-555-0104',
        emergencyContactName: 'Arjun Desai',
        emergencyContactPhone: '+1-647-555-9004',
      },
      {
        firstName: 'Tom',
        lastName: 'Eaton',
        formalName: 'Thomas Eaton',
        jobTitle: 'Site Supervisor',
        employeeNo: 'E005',
        tradeId: supervisorTrade!.id,
        crewId: crewBravo!.id,
        dept: fieldOps!.id,
        email: 'teaton@acme.example',
        phone: '+1-647-555-0105',
        emergencyContactName: 'Jane Eaton',
        emergencyContactPhone: '+1-647-555-9005',
      },
      {
        firstName: 'Maya',
        lastName: 'Foster',
        jobTitle: 'Apprentice Carpenter',
        employeeNo: 'E006',
        tradeId: carp!.id,
        crewId: crewBravo!.id,
        dept: fieldOps!.id,
      },
      {
        firstName: 'Daniel',
        lastName: 'Gonzales',
        jobTitle: 'Apprentice Electrician',
        employeeNo: 'E007',
        tradeId: elec!.id,
        crewId: crewBravo!.id,
        dept: fieldOps!.id,
      },
      {
        firstName: 'Aisha',
        lastName: 'Hamid',
        jobTitle: 'Welder',
        employeeNo: 'E008',
        tradeId: weld!.id,
        crewId: crewBravo!.id,
        dept: fieldOps!.id,
      },
      {
        firstName: 'Linda',
        lastName: 'Iverson',
        jobTitle: 'HSE Coordinator',
        employeeNo: 'E009',
        tradeId: null,
        crewId: null,
        dept: office!.id,
      },
      {
        firstName: 'Robert',
        lastName: 'Jensen',
        jobTitle: 'Project Manager',
        employeeNo: 'E010',
        tradeId: null,
        crewId: null,
        dept: office!.id,
      },
    ]

    const insertedPeople = await Promise.all(
      peopleData.map(async (p) => {
        const [row] = await tx
          .insert(people)
          .values({
            tenantId: tenant.id,
            firstName: p.firstName,
            lastName: p.lastName,
            formalName: (p as any).formalName ?? null,
            jobTitle: (p as any).jobTitle ?? null,
            employeeNo: p.employeeNo,
            departmentId: p.dept,
            tradeId: p.tradeId,
            crewId: p.crewId,
            hireDate: '2023-01-15',
            status: 'active',
            email: (p as any).email ?? null,
            phone: (p as any).phone ?? null,
            emergencyContactName: (p as any).emergencyContactName ?? null,
            emergencyContactPhone: (p as any).emergencyContactPhone ?? null,
            notes: (p as any).notes ?? null,
          })
          .returning()
        return row!
      }),
    )
    const [john, sarah, marcus, priya, tom] = insertedPeople

    // --- Training courses + records -------------------------------------
    const courseDefs = [
      {
        code: 'WHMIS',
        name: 'WHMIS 2015',
        deliveryType: 'self_paced' as const,
        valid: 36,
        description:
          'Workplace Hazardous Materials Information System — federally mandated chemical hazard training.',
      },
      {
        code: 'H2S',
        name: 'H2S Alive',
        deliveryType: 'classroom' as const,
        valid: 36,
        description:
          'Hydrogen sulfide hazard recognition + SCBA familiarisation (ENFORM standard).',
      },
      {
        code: 'FALL',
        name: 'Fall Protection',
        deliveryType: 'classroom' as const,
        valid: 36,
        description: 'Proper use of harness, lanyard, anchor points, rescue planning.',
      },
      {
        code: 'CSE',
        name: 'Confined Space Entry',
        deliveryType: 'classroom' as const,
        valid: 12,
        description: 'Permit-required confined space awareness for entrants/attendants.',
      },
      {
        code: 'FA',
        name: 'Standard First Aid',
        deliveryType: 'classroom' as const,
        valid: 36,
        description: 'Canadian Red Cross 16-hour SFA + CPR-C certification.',
      },
    ]
    const courses = await Promise.all(
      courseDefs.map(async (c) => {
        const [row] = await tx
          .insert(trainingCourses)
          .values({
            tenantId: tenant.id,
            code: c.code,
            name: c.name,
            description: c.description,
            deliveryType: c.deliveryType,
            validForMonths: c.valid,
            durationMinutes: 60,
          })
          .returning()
        return row!
      }),
    )

    const today = new Date()
    const dayMs = 24 * 3600 * 1000
    for (const p of insertedPeople) {
      const issue = isoDate(new Date(today.getTime() - 365 * dayMs))
      const expires = isoDate(new Date(today.getTime() + 700 * dayMs))
      await tx.insert(trainingRecords).values({
        tenantId: tenant.id,
        personId: p.id,
        courseId: courses[0]!.id,
        source: 'self_paced',
        completedOn: issue,
        expiresOn: expires,
        certificateType: 'auto',
        grade: 92,
        instructor: 'Online module',
      })
    }
    // Sarah's Fall Protection expires in 24 days
    await tx.insert(trainingRecords).values({
      tenantId: tenant.id,
      personId: sarah!.id,
      courseId: courses[2]!.id,
      source: 'class',
      completedOn: isoDate(new Date(today.getTime() - 1070 * dayMs)),
      expiresOn: isoDate(new Date(today.getTime() + 24 * dayMs)),
      certificateType: 'auto',
      instructor: 'L. Iverson',
      grade: 88,
      details: 'In-person session at Site A muster point.',
    })
    // Marcus' H2S expired 6 days ago
    await tx.insert(trainingRecords).values({
      tenantId: tenant.id,
      personId: marcus!.id,
      courseId: courses[1]!.id,
      source: 'class',
      completedOn: isoDate(new Date(today.getTime() - 1100 * dayMs)),
      expiresOn: isoDate(new Date(today.getTime() - 6 * dayMs)),
      certificateType: 'auto',
      instructor: 'ENFORM',
      grade: 84,
    })
    // First aid for HSE Coordinator (current)
    await tx.insert(trainingRecords).values({
      tenantId: tenant.id,
      personId: insertedPeople[8]!.id,
      courseId: courses[4]!.id,
      source: 'class',
      completedOn: isoDate(new Date(today.getTime() - 60 * dayMs)),
      expiresOn: isoDate(new Date(today.getTime() + (3 * 365 - 60) * dayMs)),
      certificateType: 'auto',
      instructor: 'Canadian Red Cross',
      grade: 96,
    })

    // --- Equipment + PPE -----------------------------------------------
    const [tools] = await tx
      .insert(equipmentTypes)
      .values({ tenantId: tenant.id, name: 'Hand Tools', category: 'tool' })
      .returning()
    const [vehicles] = await tx
      .insert(equipmentTypes)
      .values({ tenantId: tenant.id, name: 'Light Vehicle', category: 'vehicle' })
      .returning()

    const equipmentIds: string[] = []
    for (let i = 1; i <= 8; i++) {
      const isTool = i <= 5
      const [eq] = await tx
        .insert(equipmentItems)
        .values({
          tenantId: tenant.id,
          typeId: isTool ? tools!.id : vehicles!.id,
          assetTag: `AT-${String(i).padStart(4, '0')}`,
          name: isTool ? `Cordless Drill #${i}` : `Pickup Truck #${i - 5}`,
          serialNumber: isTool ? `DRL-${1000 + i}` : `VIN-1HGBH${10000 + i}`,
          qrToken: `bhs-eq-${randomUUID()}`,
          status: 'in_service',
          currentSiteOrgUnitId: i % 2 === 0 ? siteA.id : siteB.id,
          currentHolderPersonId: isTool ? insertedPeople[i % insertedPeople.length]!.id : null,
          purchaseDate: '2024-03-15',
          warrantyExpiresOn: '2027-03-15',
          requiresPreUseInspection: isTool ? true : true,
          requiresAnnualInspection: !isTool,
          lastAnnualInspectionOn: !isTool ? isoDate(new Date(today.getTime() - 120 * dayMs)) : null,
          nextAnnualInspectionDue: !isTool
            ? isoDate(new Date(today.getTime() + 240 * dayMs))
            : null,
          lastPreUseInspectionAt: new Date(today.getTime() - 2 * dayMs),
          billingRateCategory: isTool ? 'tools' : 'vehicles',
        })
        .returning()
      equipmentIds.push(eq!.id)

      // Add a little location history
      await tx.insert(equipmentLocationHistory).values({
        tenantId: tenant.id,
        itemId: eq!.id,
        siteOrgUnitId: i % 2 === 0 ? siteA.id : siteB.id,
        holderPersonId: isTool ? insertedPeople[i % insertedPeople.length]!.id : null,
        recordedAt: new Date(today.getTime() - 7 * dayMs),
        note: 'Issued from yard',
      })
      await tx.insert(equipmentLocationHistory).values({
        tenantId: tenant.id,
        itemId: eq!.id,
        siteOrgUnitId: i % 2 === 0 ? siteB.id : siteA.id,
        recordedAt: new Date(today.getTime() - 30 * dayMs),
        note: 'Transferred',
      })
    }
    // A work order on the first pickup truck
    await tx.insert(equipmentWorkOrders).values({
      tenantId: tenant.id,
      itemId: equipmentIds[5]!,
      reference: 'WO-2026-0001',
      status: 'in_progress',
      summary: 'Replace front-left tire',
      description: 'Sidewall puncture noticed during pre-trip inspection.',
      openedAt: new Date(today.getTime() - 1 * dayMs),
    })
    await tx.insert(equipmentWorkOrders).values({
      tenantId: tenant.id,
      itemId: equipmentIds[5]!,
      reference: 'WO-2026-0002',
      status: 'closed',
      summary: 'Annual safety inspection',
      description: 'Provincial annual inspection completed; certificate filed.',
      openedAt: new Date(today.getTime() - 120 * dayMs),
      closedAt: new Date(today.getTime() - 118 * dayMs),
    })

    // Canonical PPE types + criteria — uses the dedicated seed helper so
    // both the schema relationships and the audit story stay consistent.
    const seededPpeTypes = await seedPpeTypesWithCriteria(tx, tenant.id)
    const harness = seededPpeTypes.find((t) => t.name === 'Full-body harness')!
    const harnessIds: string[] = []
    for (let i = 1; i <= 6; i++) {
      const [item] = await tx
        .insert(ppeItems)
        .values({
          tenantId: tenant.id,
          typeId: harness.id,
          serialNumber: `HARN-${i}`,
          size: i % 2 === 0 ? 'L' : 'M',
          status: i <= 3 ? 'issued' : 'in_stock',
          currentHolderPersonId: i <= 3 ? insertedPeople[i - 1]!.id : null,
          purchaseDate: '2024-01-10',
          expiresOn: '2029-01-10',
          lastInspectionOn: isoDate(new Date(today.getTime() - 14 * dayMs)),
          nextInspectionDue: isoDate(new Date(today.getTime() + 16 * dayMs)),
          lastAnnualInspectionOn: isoDate(new Date(today.getTime() - 200 * dayMs)),
          nextAnnualInspectionDue: isoDate(new Date(today.getTime() + 165 * dayMs)),
        })
        .returning()
      harnessIds.push(item!.id)

      // Inspection history (3 pre-use, 1 annual per item)
      for (let n = 0; n < 3; n++) {
        await tx.insert(ppeInspections).values({
          tenantId: tenant.id,
          itemId: item!.id,
          kind: 'pre_use',
          result: 'pass',
          inspectedOn: isoDate(new Date(today.getTime() - (14 + n * 14) * dayMs)),
          nextDueOn: isoDate(new Date(today.getTime() - (14 + n * 14) * dayMs + 30 * dayMs)),
          inspectedByTenantUserId: membership.id,
        })
      }
      await tx.insert(ppeInspections).values({
        tenantId: tenant.id,
        itemId: item!.id,
        kind: 'annual',
        result: 'pass',
        inspectedOn: isoDate(new Date(today.getTime() - 200 * dayMs)),
        nextDueOn: isoDate(new Date(today.getTime() + 165 * dayMs)),
        inspectedByTenantUserId: membership.id,
        notes: 'Annual inspection by certified competent person.',
      })

      // For items 1-3 (issued), add the issuance receipt
      if (i <= 3) {
        await tx.insert(ppeIssues).values({
          tenantId: tenant.id,
          itemId: item!.id,
          personId: insertedPeople[i - 1]!.id,
          action: 'issue',
          quantity: 1,
          issuedByTenantUserId: membership.id,
          occurredAt: new Date(today.getTime() - 30 * dayMs),
          note: 'Initial issue at site induction.',
        })
      }
    }
    // An open issue report against harness #2
    await tx.insert(ppeIssueReports).values({
      tenantId: tenant.id,
      itemId: harnessIds[1]!,
      reportedByTenantUserId: membership.id,
      description: 'Frayed webbing noticed on leg strap. Removed from service pending inspection.',
      status: 'open',
    })

    // Annual third-party recertification records — drives /ppe/[id]?tab=annual.
    for (const harnessId of harnessIds) {
      const inspectedOn = isoDate(new Date(today.getTime() - 200 * dayMs))
      await tx
        .insert(ppeAnnualRecords)
        .values({
          tenantId: tenant.id,
          itemId: harnessId,
          year: String(new Date(inspectedOn).getFullYear()),
          inspectedOn,
          nextDueOn: isoDate(new Date(today.getTime() + 165 * dayMs)),
          inspectorName: 'Joe Rigger',
          inspectorCompany: 'Acme Riggers Ltd',
          result: 'pass',
          notes: 'Annual third-party certification — webbing, hardware, and stitching inspected.',
        })
        .onConflictDoNothing()
    }

    // --- Form template (daily toolbox talk) -----------------------------
    const [tmpl] = await tx
      .insert(formTemplates)
      .values({
        tenantId: tenant.id,
        key: 'daily-toolbox-talk',
        name: 'Daily Toolbox Talk',
        category: 'toolbox_talk',
        description: 'Pre-shift hazard discussion + attendance sign-in.',
        status: 'published',
        createdBy: admin.id,
      })
      .returning()
    const toolboxSchema: FormSchemaV1 = {
      schemaVersion: 1,
      title: { en: 'Daily Toolbox Talk' },
      sections: [
        {
          id: 'crew',
          title: { en: 'Crew & Site' },
          fields: [
            { id: 'site', type: 'site_picker', label: { en: 'Site' }, required: true },
            { id: 'foreman', type: 'person_picker', label: { en: 'Foreman' }, required: true },
            { id: 'attendees', type: 'person_picker', label: { en: 'Attendees' }, required: true },
          ],
        },
        {
          id: 'topics',
          title: { en: 'Topics Covered' },
          repeating: true,
          fields: [
            { id: 'topic', type: 'text', label: { en: 'Topic' }, required: true },
            { id: 'discussion', type: 'textarea', label: { en: 'Discussion notes' } },
          ],
        },
        {
          id: 'signoff',
          title: { en: 'Sign-off' },
          fields: [
            {
              id: 'incidentsDiscussed',
              type: 'yes_no_comment',
              label: { en: 'Were recent incidents reviewed?' },
              required: true,
            },
            {
              id: 'signature',
              type: 'signature',
              label: { en: 'Foreman signature' },
              required: true,
            },
          ],
        },
      ],
      workflow: {
        steps: [
          {
            key: 'submit',
            title: { en: 'Submit' },
            assignee: { type: 'expression', expr: '$submitter' },
          },
        ],
      },
    }
    const [tv1] = await tx
      .insert(formTemplateVersions)
      .values({
        tenantId: tenant.id,
        templateId: tmpl!.id,
        version: 1,
        schema: toolboxSchema,
        publishedAt: new Date(),
        publishedBy: admin.id,
        changelog: 'Initial version',
      })
      .returning()
    await tx.insert(formAssignments).values({
      tenantId: tenant.id,
      templateId: tmpl!.id,
      mode: 'scheduled',
      cron: '0 7 * * 1-5',
      targetRoleKeys: ['foreman'],
      enabled: true,
      createdBy: admin.id,
    })

    // Sample form responses
    for (let i = 0; i < 4; i++) {
      await tx.insert(formResponses).values({
        tenantId: tenant.id,
        templateId: tmpl!.id,
        templateVersionId: tv1!.id,
        status: i === 0 ? 'submitted' : i === 1 ? 'submitted' : i === 2 ? 'in_progress' : 'closed',
        siteOrgUnitId: i % 2 === 0 ? siteA.id : siteB.id,
        submittedBy: membership.id,
        submittedAt: i < 3 ? new Date(today.getTime() - i * dayMs) : new Date(),
        data: {
          foreman: john!.id,
          attendees: insertedPeople.slice(1, 4).map((p) => p.id),
          topics: [
            {
              topic: 'Pinch points around tank manways',
              discussion: 'Always use spotters when handling >50lb lids.',
            },
            {
              topic: 'Heat stress',
              discussion: 'Mandatory 15-min water breaks every hour above 28°C.',
            },
          ],
          incidentsDiscussed: { answer: 'yes', comment: 'Reviewed near-miss INC-2026-0001.' },
        },
      })
    }

    // --- Incidents (rich) ----------------------------------------------
    const [inc1] = await tx
      .insert(incidents)
      .values({
        tenantId: tenant.id,
        reference: 'INC-2026-0001',
        type: 'near_miss',
        severity: 'no_injury',
        status: 'closed',
        title: 'Hand tool dropped from scaffold',
        description:
          '8" wrench fell from level-2 scaffold into a barricaded area below pump P-103. No personnel in the drop zone — caught by toe-boards.',
        occurredAt: new Date(today.getTime() - 14 * dayMs),
        reportedAt: new Date(today.getTime() - 14 * dayMs + 2 * 3600 * 1000),
        siteOrgUnitId: siteA.id,
        location: 'P-103 pump bay, north scaffold level 2',
        weather: '17°C, light wind',
        departmentId: fieldOps!.id,
        supervisorPersonId: john!.id,
        witnesses: 'M. Foster, D. Gonzales',
        ppeWorn: 'Hard hat, safety glasses, gloves, fall arrest',
        eventsLeadingUp:
          'Working at height removing valve packing. Tool was set down on scaffold deck instead of being tethered. A gust knocked it through the toe-board gap.',
        immediateActionTaken:
          'Work stopped. Area inspected. Toe-board gap shimmed. Tool tethering tailgate held immediately after.',
        actualSeverity: 1,
        potentialSeverity: 4,
        rootCause: 'Tool not tethered when set down on scaffold deck.',
        contributingFactors: [
          'Inadequate toe-board height',
          'No tool-tethering policy enforcement',
        ],
        assignedInvestigatorTenantUserId: membership.id,
        inProgress: false,
        locked: true,
        closedAt: new Date(today.getTime() - 10 * dayMs),
        closedByTenantUserId: membership.id,
      })
      .returning()

    const [inc2] = await tx
      .insert(incidents)
      .values({
        tenantId: tenant.id,
        reference: 'INC-2026-0002',
        type: 'injury',
        severity: 'first_aid_only',
        status: 'closed',
        title: 'Cut on right hand while opening crate',
        description:
          'Box cutter slipped while opening valve crate. Small laceration to right thumb, treated on site.',
        occurredAt: new Date(today.getTime() - 9 * dayMs),
        siteOrgUnitId: siteA.id,
        location: 'Materials lay-down yard',
        supervisorPersonId: john!.id,
        ppeWorn: 'Cut-resistant gloves (level 3)',
        firstAidReceived: true,
        firstAidProvider: 'L. Iverson (HSE Coordinator)',
        actualSeverity: 2,
        potentialSeverity: 2,
        rootCause:
          'Box cutter blade fully extended, no proper cut-resistant glove rating for this task.',
        inProgress: false,
        locked: true,
        closedAt: new Date(today.getTime() - 6 * dayMs),
      })
      .returning()
    await tx.insert(incidentInjuries).values({
      tenantId: tenant.id,
      incidentId: inc2!.id,
      personId: sarah!.id,
      personName: 'Sarah Bell',
      bodyParts: ['Right hand', 'Thumb'],
      injuryTypes: ['Laceration'],
      treatment: 'Wound cleaned, butterfly bandage applied, advised follow-up if redness develops.',
      treatedAtFacility: 'On-site first aid station',
      workedHoursPriorTo: 4,
    })
    await tx.insert(incidentPeople).values({
      tenantId: tenant.id,
      incidentId: inc2!.id,
      personId: sarah!.id,
      role: 'involved',
    })

    const [inc3] = await tx
      .insert(incidents)
      .values({
        tenantId: tenant.id,
        reference: 'INC-2026-0003',
        type: 'injury',
        severity: 'medical_aid',
        status: 'under_investigation',
        title: 'Slip on wet floor in mechanical room',
        description:
          'Worker slipped after a hose was left dripping at the access point. Treated at walk-in clinic, x-rays clear.',
        occurredAt: new Date(today.getTime() - 3 * dayMs),
        siteOrgUnitId: siteB.id,
        location: 'Mechanical Room 2A, near east entrance',
        supervisorPersonId: tom!.id,
        witnesses: 'Marcus Chen',
        externalPeopleInvolved: 'None',
        eventsLeadingUp:
          "Cleaning crew finished pressure-washing equipment and coiled the hose without draining it. Wet patch wasn't flagged with a cone.",
        immediateActionTaken:
          'Area mopped, cones placed, hose drained, worker driven to MedExpress clinic.',
        ppeWorn: 'Safety boots (SRC slip-resistant), high-vis vest, hard hat',
        actualSeverity: 3,
        potentialSeverity: 3,
        criticalInjury: false,
        ministryOfLabourNotified: false,
        emsNotified: false,
        firstAidReceived: true,
        firstAidProvider: 'L. Iverson',
        medicalAttentionReceived: true,
        treatedAtHospital: 'MedExpress Walk-In Clinic',
        treatedInCity: 'Toronto',
        transportation: 'Private vehicle (supervisor drove)',
        modifiedDuty: true,
        modifiedDutyFirstDay: isoDate(new Date(today.getTime() - 2 * dayMs)),
        modifiedDutyDays: 3,
        externallyReportable: false,
        rootCause:
          'Procedure for hose handling at clean-up did not require draining/coning. Cleaning subcontractor not briefed on site policy.',
        contributingFactors: ['Subcontractor onboarding gap', 'No signage placement standard'],
        inProgress: true,
        locked: false,
        assignedInvestigatorTenantUserId: membership.id,
      })
      .returning()
    await tx.insert(incidentInjuries).values({
      tenantId: tenant.id,
      incidentId: inc3!.id,
      personId: priya!.id,
      personName: 'Priya Desai',
      bodyParts: ['Lower back', 'Left wrist'],
      injuryTypes: ['Strain', 'Bruise'],
      treatment: 'X-ray clear, anti-inflammatories prescribed, modified duty for 3 days.',
      treatedAtFacility: 'MedExpress Walk-In Clinic',
      workedHoursPriorTo: 5,
    })
    await tx.insert(incidentLostTimeEvents).values({
      tenantId: tenant.id,
      incidentId: inc3!.id,
      status: 'restricted_duty',
      validFrom: isoDate(new Date(today.getTime() - 2 * dayMs)),
      validTo: isoDate(new Date(today.getTime() + 1 * dayMs)),
      notes: 'No overhead reaching, no carrying > 5kg.',
    })
    await tx.insert(incidentPeople).values({
      tenantId: tenant.id,
      incidentId: inc3!.id,
      personId: priya!.id,
      role: 'involved',
    })

    const [inc4] = await tx
      .insert(incidents)
      .values({
        tenantId: tenant.id,
        reference: 'INC-2026-0004',
        type: 'property_damage',
        severity: 'no_injury',
        status: 'reported',
        title: 'Forklift bumped overhead conduit',
        description:
          'Forklift forks struck low-hanging electrical conduit while turning. Conduit dented; circuit isolated as a precaution.',
        occurredAt: new Date(today.getTime() - 1 * dayMs),
        siteOrgUnitId: siteB.id,
        location: 'Warehouse aisle 3',
        supervisorPersonId: tom!.id,
        immediateActionTaken:
          'Forklift parked. Electrical isolated by qualified person. Conduit photographed and tagged.',
        ppeWorn: 'Standard site PPE',
        actualSeverity: 1,
        potentialSeverity: 4,
        inProgress: true,
        locked: false,
      })
      .returning()

    // --- Corrective actions --------------------------------------------
    const caRows = [
      {
        reference: 'CA-2026-0001',
        title: 'Install drip pan + cone protocol for cleaning crew',
        severity: 'high' as const,
        status: 'in_progress' as const,
        daysToDue: 7,
        source: 'incident' as const,
        sourceEntityId: inc3!.id,
        actionTaken:
          'Drip pans ordered (ETA 3 days). Cone-placement SOP drafted; awaiting sign-off.',
        rootCause: 'Subcontractor onboarding gap.',
      },
      {
        reference: 'CA-2026-0002',
        title: 'Daily scaffold inspection during turnaround',
        severity: 'high' as const,
        status: 'open' as const,
        daysToDue: 3,
        source: 'jsha' as const,
        actionTaken: null,
        rootCause: null,
      },
      {
        reference: 'CA-2026-0003',
        title: 'Refresh slip-trip awareness in monthly toolbox',
        severity: 'low' as const,
        status: 'open' as const,
        daysToDue: 14,
        source: 'inspection' as const,
        actionTaken: null,
        rootCause: null,
      },
      {
        reference: 'CA-2026-0004',
        title: 'Replace damaged conduit section',
        severity: 'high' as const,
        status: 'pending_verification' as const,
        daysToDue: 1,
        source: 'incident' as const,
        sourceEntityId: inc4!.id,
        actionTaken:
          'Conduit section replaced by qualified electrician. Awaiting verification by site safety.',
        rootCause: 'Forklift route clearance not validated against installed services.',
      },
    ]
    for (const c of caRows) {
      await tx.insert(correctiveActions).values({
        tenantId: tenant.id,
        reference: c.reference,
        title: c.title,
        severity: c.severity,
        status: c.status,
        siteOrgUnitId: siteA.id,
        assignedOn: isoDate(new Date(today.getTime() - 5 * dayMs)),
        dueOn: isoDate(new Date(today.getTime() + c.daysToDue * dayMs)),
        source: c.source,
        sourceEntityType: c.source === 'incident' ? 'incident' : null,
        sourceEntityId: (c as any).sourceEntityId ?? null,
        actionTaken: c.actionTaken,
        rootCause: c.rootCause,
        ownerTenantUserId: membership.id,
        assignedByTenantUserId: membership.id,
      })
    }

    // --- Documents ------------------------------------------------------
    const docDefs = [
      {
        key: 'corporate-hs-policy',
        title: 'Corporate Health & Safety Policy',
        category: 'policy',
        reviewFreq: 12,
        body: '## Purpose\n\nAcme Industrial is committed to providing a safe and healthy workplace for all employees…',
      },
      {
        key: 'sds-acetone',
        title: 'SDS — Acetone',
        category: 'sds',
        reviewFreq: 36,
        body: '## Acetone — Safety Data Sheet\n\n**Hazard class:** Flammable liquid, category 2…',
      },
      {
        key: 'wah-procedure',
        title: 'Work at Height Procedure',
        category: 'procedure',
        reviewFreq: 24,
        body: '## Scope\n\nThis procedure applies to all work performed >3m above grade…',
      },
    ]
    for (const d of docDefs) {
      const [doc] = await tx
        .insert(documents)
        .values({
          tenantId: tenant.id,
          key: d.key,
          title: d.title,
          category: d.category,
          status: 'published',
          reviewFrequencyMonths: d.reviewFreq,
          nextReviewOn: isoDate(new Date(today.getTime() + d.reviewFreq * 30 * dayMs - 30 * dayMs)),
          ownerTenantUserId: membership.id,
          printHeader: true,
          printFooter: true,
        })
        .returning()
      const [v1] = await tx
        .insert(documentVersions)
        .values({
          tenantId: tenant.id,
          documentId: doc!.id,
          version: 1,
          contentMarkdown: d.body,
          publishedAt: new Date(today.getTime() - 200 * dayMs),
          publishedBy: admin.id,
          changelog: 'Initial release',
        })
        .returning()
      const [v2] = await tx
        .insert(documentVersions)
        .values({
          tenantId: tenant.id,
          documentId: doc!.id,
          version: 2,
          contentMarkdown: d.body + '\n\n## Revision\n\nUpdated reporting contact emails.',
          publishedAt: new Date(today.getTime() - 30 * dayMs),
          publishedBy: admin.id,
          changelog: 'Updated emergency contact roster',
        })
        .returning()
      // Some acknowledgments
      for (let i = 0; i < 5; i++) {
        await tx.insert(documentAcknowledgments).values({
          tenantId: tenant.id,
          documentId: doc!.id,
          versionId: v2!.id,
          personId: insertedPeople[i]!.id,
          acknowledgedAt: new Date(today.getTime() - (28 - i) * dayMs),
        })
      }
      // Review history
      await tx.insert(documentReviews).values({
        tenantId: tenant.id,
        documentId: doc!.id,
        reviewedByTenantUserId: membership.id,
        reviewedAt: new Date(today.getTime() - 30 * dayMs),
        outcome: 'updated',
        nextReviewOn: isoDate(new Date(today.getTime() + d.reviewFreq * 30 * dayMs)),
        notes: 'Reviewed emergency contact list and updated. No structural changes needed.',
      })
    }

    // --- Customer contacts ---
    await tx.insert(customerContacts).values([
      {
        tenantId: tenant.id,
        orgUnitId: customer.id,
        name: 'Karen Whitaker',
        role: 'Site Operations Manager',
        email: 'kwhitaker@acmerefinery.com',
        phone: '+1-647-555-7001',
        isPrimary: true,
      },
      {
        tenantId: tenant.id,
        orgUnitId: customer.id,
        name: 'David Park',
        role: 'HSE Lead',
        email: 'dpark@acmerefinery.com',
        phone: '+1-647-555-7002',
      },
      {
        tenantId: tenant.id,
        orgUnitId: siteA.id,
        name: 'Marco Rossi',
        role: 'Site Foreman',
        phone: '+1-647-555-7003',
      },
    ])

    // --- Welcome notification --------------------
    await tx.insert(notifications).values({
      tenantId: tenant.id,
      userId: admin.id,
      category: 'system',
      type: 'tenant.welcome',
      title: 'Welcome to Acme Industrial',
      body: 'Sample data has been seeded. Click around — every list is paginated/sortable and every row clicks through to a real detail page.',
      linkPath: '/dashboard',
    })

    // --- Inspection Bank ------------------------------------------------
    const [bank1] = await tx
      .insert(inspectionBanks)
      .values({
        tenantId: tenant.id,
        name: 'Site Daily Walk-Through',
        description:
          'Routine site safety walk-through criteria used by site supervisors at start of shift.',
        category: 'site_inspection',
        isPublished: true,
        createdBy: admin.id,
      })
      .returning()
    if (bank1) {
      await tx.insert(inspectionBankCriteria).values([
        {
          tenantId: tenant.id,
          bankId: bank1.id,
          sequence: 1,
          text: 'Are walkways clear and unobstructed?',
          responseType: 'pass_fail_na',
          requiresPhoto: false,
          requiresComment: false,
        },
        {
          tenantId: tenant.id,
          bankId: bank1.id,
          sequence: 2,
          text: 'Is fire extinguisher signage visible from all working areas?',
          responseType: 'pass_fail_na',
          requiresPhoto: true,
          requiresComment: false,
        },
        {
          tenantId: tenant.id,
          bankId: bank1.id,
          sequence: 3,
          text: 'Are MSDS binders accessible at the chemical storage?',
          responseType: 'yes_no',
          requiresPhoto: false,
          requiresComment: true,
        },
        {
          tenantId: tenant.id,
          bankId: bank1.id,
          sequence: 4,
          text: 'Eyewash stations functional and unobstructed?',
          responseType: 'pass_fail_na',
          requiresPhoto: true,
          requiresComment: true,
        },
      ])
    }
    const [bank2] = await tx
      .insert(inspectionBanks)
      .values({
        tenantId: tenant.id,
        name: 'PPE Pre-Use Inspection (Harness)',
        description: 'Draft template — to be reviewed before publishing.',
        category: 'ppe_check',
        isPublished: false,
        createdBy: admin.id,
      })
      .returning()
    if (bank2) {
      await tx.insert(inspectionBankCriteria).values([
        {
          tenantId: tenant.id,
          bankId: bank2.id,
          sequence: 1,
          text: 'Webbing free from cuts, frays, burns, or chemical damage?',
          responseType: 'pass_fail_na',
          requiresPhoto: true,
          requiresComment: false,
        },
        {
          tenantId: tenant.id,
          bankId: bank2.id,
          sequence: 2,
          text: 'D-rings free from cracks, sharp edges, or deformation?',
          responseType: 'pass_fail_na',
          requiresPhoto: false,
          requiresComment: false,
        },
        {
          tenantId: tenant.id,
          bankId: bank2.id,
          sequence: 3,
          text: 'Buckles function and lock correctly?',
          responseType: 'pass_fail_na',
          requiresPhoto: false,
          requiresComment: false,
        },
      ])
    }

    // --- Training Skill Authorities + Types + Assignments --------------
    const [authority1] = await tx
      .insert(trainingSkillAuthorities)
      .values({
        tenantId: tenant.id,
        name: 'In-house Quality Control',
        code: 'IHQC',
        jurisdiction: 'Internal',
        notes: 'Internal evaluator sign-off for in-house competencies.',
      })
      .returning()
    const [authority2] = await tx
      .insert(trainingSkillAuthorities)
      .values({
        tenantId: tenant.id,
        name: 'Boilermakers Local 128',
        code: 'BM128',
        jurisdiction: 'Ontario',
      })
      .returning()
    if (authority1) {
      const [skill1] = await tx
        .insert(trainingSkillTypes)
        .values({
          tenantId: tenant.id,
          authorityId: authority1.id,
          name: 'Forklift Operator',
          code: 'FORK',
          validForMonths: 36,
          description: 'Class 4/5 sit-down counterbalance forklift competency.',
        })
        .returning()
      const [skill2] = await tx
        .insert(trainingSkillTypes)
        .values({
          tenantId: tenant.id,
          authorityId: authority1.id,
          name: 'Confined Space Attendant',
          code: 'CSA',
          validForMonths: 12,
          description: 'Permit-required confined space attendant role.',
        })
        .returning()
      if (skill1) {
        await tx.insert(trainingSkillAssignments).values([
          {
            tenantId: tenant.id,
            personId: john!.id,
            skillTypeId: skill1.id,
            grantedOn: isoDate(new Date(today.getTime() - 200 * dayMs)),
            expiresOn: isoDate(new Date(today.getTime() + 900 * dayMs)),
            grantedByTenantUserId: membership.id,
          },
          {
            tenantId: tenant.id,
            personId: tom!.id,
            skillTypeId: skill1.id,
            grantedOn: isoDate(new Date(today.getTime() - 100 * dayMs)),
            expiresOn: isoDate(new Date(today.getTime() + 1000 * dayMs)),
            grantedByTenantUserId: membership.id,
          },
        ])
      }
      if (skill2) {
        await tx.insert(trainingSkillAssignments).values({
          tenantId: tenant.id,
          personId: john!.id,
          skillTypeId: skill2.id,
          grantedOn: isoDate(new Date(today.getTime() - 340 * dayMs)),
          expiresOn: isoDate(new Date(today.getTime() + 25 * dayMs)),
          grantedByTenantUserId: membership.id,
          notes: 'Expires soon — schedule recertification.',
        })
      }
    }
    if (authority2) {
      await tx.insert(trainingSkillTypes).values({
        tenantId: tenant.id,
        authorityId: authority2.id,
        name: 'Pressure Welding Certification',
        code: 'PWELD',
        validForMonths: 24,
        description: 'Provincially-recognised pressure welding ticket.',
      })
    }

    // --- Inspection types (3 sample types reusing the seeded banks) -----
    await seedInspectionTypes(tx, tenant.id)

    // --- Lift Plan + Toolbox Talk form templates (built-in; surfaced as
    //     pinned forms in the sidebar rather than native modules) ---------
    await seedLiftPlanTemplate(tx, tenant.id)
    await seedToolboxTemplate(tx, tenant.id)

    // --- Inspection records (5 sample records against the seeded types) -
    await seedInspectionRecords(tx, tenant.id)

    // --- Equipment rates + expenses + log + checkouts -------------------
    await seedEquipmentRatesAndExpenses(tx, tenant.id)

    // --- HazID / JSHA library (hazards, sets, tasks, assessment types) --
    await seedHazidLibraries(tx, tenant.id)

    // --- Training assessment type templates ----------------------------
    await seedTrainingAssessmentTypes(tx, tenant.id)

    // --- Training assessment attempts (5 sample completed quizzes) ------
    await seedTrainingAssessmentAttempts(tx, tenant.id)

    // --- Safe Distance sample records (electrical / drone / vehicle) ---
    await seedSafeDistanceRecords(tx, tenant.id)

    // --- Incident taxonomy + hours-worked + classify existing rows -----
    await seedIncidentClassifications(tx, tenant.id)

    // --- People groups + titles + job-description tasks ----
    await seedPeopleGroupsAndTitles(tx, tenant.id)

    console.log(`  · tenant: ${tenant.name} (${tenant.slug})`)
    console.log(`  · super-admin: ${admin.email}`)
    console.log(
      `  · seeded: ${insertedPeople.length} people, ${courses.length} courses, 4 incidents (1 rich), ${caRows.length} CAs, ${docDefs.length} documents w/ versions+acks, 8 equipment, 6 harnesses w/ inspections, 5 toolbox talks`,
    )
    console.log(`  · sign in via Magic link (Mailpit: http://localhost:8025)`)
  })

  // Canonical templates (JSHA / Toolbox Talk / Lift Plan / WAH Rescue) ----
  // These are seeded for the first tenant only — every other tenant clones
  // them on demand from the /apps/templates/new gallery.
  await seedCanonicalTemplates(db)

  // Documentation lookups — types + hierarchical categories + reference
  // types + reference categories. Idempotent and scoped to the first tenant.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    const [first] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .orderBy(tenants.createdAt)
      .limit(1)
    if (!first) return
    await seedDocumentTypesAndCategories(tx as any, first.id)
  })

  await pg.end()
  console.log('✔ Seed complete')
}

/**
 * Idempotently insert the standard set of document/reference types + categories
 * for the given tenant. Safe to re-run — uses ON CONFLICT for types
 * (unique on (tenant_id, key)), and name-existence checks for categories.
 */
export async function seedDocumentTypesAndCategories(tx: any, tenantId: string): Promise<void> {
  // --- Document Types (5) ---------------------------------------------
  const docTypeRows = [
    {
      key: 'policy',
      name: 'Policy',
      color: '#0f766e',
      description: 'Company-wide policies and stances.',
    },
    {
      key: 'procedure',
      name: 'Procedure / SOP',
      color: '#2563eb',
      description: 'Step-by-step instructions for routine work.',
    },
    {
      key: 'sds',
      name: 'SDS / MSDS',
      color: '#ea580c',
      description: 'Safety data sheets for hazardous materials.',
    },
    {
      key: 'manual',
      name: 'Manual / handbook',
      color: '#7c3aed',
      description: 'Equipment manuals and reference handbooks.',
    },
    {
      key: 'form',
      name: 'Form / template',
      color: '#0891b2',
      description: 'Blank forms and printable templates.',
    },
  ]
  let typesInserted = 0
  for (const row of docTypeRows) {
    const inserts = await tx
      .insert(documentTypes)
      .values({
        tenantId,
        key: row.key,
        name: row.name,
        color: row.color,
        description: row.description,
      })
      .onConflictDoNothing({ target: [documentTypes.tenantId, documentTypes.key] })
      .returning({ id: documentTypes.id })
    if (inserts.length > 0) typesInserted += 1
  }

  // --- Document Categories (5, hierarchical) --------------------------
  // The root category "Safety" with three children (PPE, Permits, Working
  // at Heights), plus a sibling "Operations" category.
  const categoryDefs: { name: string; parent?: string; description?: string }[] = [
    { name: 'Safety', description: 'All safety-related policies and procedures.' },
    { name: 'PPE', parent: 'Safety', description: 'Personal protective equipment policies.' },
    {
      name: 'Permits',
      parent: 'Safety',
      description: 'Hot work, confined-space, working-at-heights permits.',
    },
    { name: 'Working at Heights', parent: 'Safety', description: 'Fall-arrest and ladder safety.' },
    { name: 'Operations', description: 'Day-to-day operational SOPs.' },
  ]
  const insertedCats = new Map<string, string>()
  let catsInserted = 0
  for (const def of categoryDefs) {
    const parentId = def.parent ? (insertedCats.get(def.parent) ?? null) : null
    // Existence check by (tenant_id, name) since there's a unique index on
    // (tenant_id, name).
    const existing = await tx
      .select({ id: documentCategories.id })
      .from(documentCategories)
      .where(
        sql`${documentCategories.tenantId} = ${tenantId} AND ${documentCategories.name} = ${def.name}`,
      )
      .limit(1)
    if (existing.length > 0) {
      insertedCats.set(def.name, existing[0]!.id)
      continue
    }
    const [row] = await tx
      .insert(documentCategories)
      .values({ tenantId, name: def.name, parentId, description: def.description ?? null })
      .returning({ id: documentCategories.id })
    if (row) {
      insertedCats.set(def.name, row.id)
      catsInserted += 1
    }
  }

  // --- Reference Types (3) ---------------------------------------------
  const refTypeRows = [
    {
      key: 'sds',
      name: 'Safety Data Sheet',
      description: 'SDS / MSDS pointer to vendor or governmental site.',
    },
    { key: 'manual', name: 'Equipment manual', description: 'Vendor manuals for owned equipment.' },
    {
      key: 'standard',
      name: 'Standard / regulation',
      description: 'External standards (CSA, ANSI, OHS) referenced.',
    },
  ]
  let refTypesInserted = 0
  for (const row of refTypeRows) {
    const inserts = await tx
      .insert(documentReferenceTypes)
      .values({ tenantId, key: row.key, name: row.name, description: row.description })
      .onConflictDoNothing({
        target: [documentReferenceTypes.tenantId, documentReferenceTypes.key],
      })
      .returning({ id: documentReferenceTypes.id })
    if (inserts.length > 0) refTypesInserted += 1
  }

  // --- Reference Categories (5, hierarchical) --------------------------
  const refCategoryDefs: { name: string; parent?: string; description?: string }[] = [
    { name: 'Chemicals', description: 'Hazardous chemical references.' },
    { name: 'Solvents', parent: 'Chemicals' },
    { name: 'Acids', parent: 'Chemicals' },
    { name: 'Tooling', description: 'Power tools and shop equipment.' },
    { name: 'Vehicles', description: 'Fleet vehicle manuals and recalls.' },
  ]
  const insertedRefCats = new Map<string, string>()
  let refCatsInserted = 0
  for (const def of refCategoryDefs) {
    const parentId = def.parent ? (insertedRefCats.get(def.parent) ?? null) : null
    const existing = await tx
      .select({ id: documentReferenceCategories.id })
      .from(documentReferenceCategories)
      .where(
        sql`${documentReferenceCategories.tenantId} = ${tenantId} AND ${documentReferenceCategories.name} = ${def.name}`,
      )
      .limit(1)
    if (existing.length > 0) {
      insertedRefCats.set(def.name, existing[0]!.id)
      continue
    }
    const [row] = await tx
      .insert(documentReferenceCategories)
      .values({ tenantId, name: def.name, parentId, description: def.description ?? null })
      .returning({ id: documentReferenceCategories.id })
    if (row) {
      insertedRefCats.set(def.name, row.id)
      refCatsInserted += 1
    }
  }

  console.log(
    `  · doc lookups: ${typesInserted}/${docTypeRows.length} types, ${catsInserted}/${categoryDefs.length} categories, ${refTypesInserted}/${refTypeRows.length} ref types, ${refCatsInserted}/${refCategoryDefs.length} ref categories`,
  )
}

/**
 * Idempotently insert the four canonical form templates (JSHA, Toolbox Talk,
 * Lift Plan, WAH Rescue Plan) for the FIRST tenant in the database.
 *
 * Safe to re-run: uses ON CONFLICT (tenant_id, key) DO NOTHING for templates,
 * and version 1 is inserted only when the template was actually new.
 *
 * Re-export of CANONICAL_TEMPLATES means the same shape is consumed by the
 * "Start from template" gallery at /apps/templates/new (the gallery clones
 * each template into the user's own tenant on click).
 */
async function seedCanonicalTemplates(db: ReturnType<typeof createClient>['db']): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)

    // Pick the first tenant (by createdAt). If there is none, skip — this is
    // a fresh DB with no tenants.
    const [first] = await tx
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .orderBy(tenants.createdAt)
      .limit(1)
    if (!first) {
      console.log('  · seedCanonicalTemplates: no tenants found, skipping')
      return
    }

    // Find a super-admin user to attribute the `created_by` field, if available.
    const [superAdmin] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.isSuperAdmin, true))
      .limit(1)
    const createdBy = superAdmin?.id ?? null

    let inserted = 0
    let skipped = 0
    for (const canonical of CANONICAL_TEMPLATES) {
      // Insert the template shell. ON CONFLICT (tenant_id, key) DO NOTHING — if
      // an admin already cloned + renamed one, we don't fight them.
      const inserts = await tx
        .insert(formTemplates)
        .values({
          tenantId: first.id,
          key: canonical.key,
          name: canonical.name,
          category: canonical.category,
          description: canonical.description,
          status: 'published',
          moduleBinding: canonical.moduleBinding,
          createdBy,
        })
        .onConflictDoNothing({ target: [formTemplates.tenantId, formTemplates.key] })
        .returning({ id: formTemplates.id })

      const tmpl = inserts[0]
      if (!tmpl) {
        skipped += 1
        continue
      }

      await tx.insert(formTemplateVersions).values({
        tenantId: first.id,
        templateId: tmpl.id,
        version: 1,
        schema: canonical.schema as FormSchemaV1,
        publishedAt: new Date(),
        publishedBy: createdBy,
        changelog: 'Canonical template v1',
      })
      inserted += 1
    }
    console.log(
      `  · canonical templates: ${inserted} inserted, ${skipped} already present (tenant: ${first.slug ?? first.id})`,
    )
  })
}

async function insertOrgUnit(
  tx: any,
  tenantId: string,
  parentId: string | null,
  level: 'customer' | 'project' | 'site' | 'area',
  name: string,
  extras: { lat?: number; lng?: number; geofenceMeters?: number } = {},
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(orgUnits)
    .values({ tenantId, parentId, level, name, ...extras })
    .returning()
  return row
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function build5x5() {
  const cells: Record<string, { score: number; label: string; color: string }> = {}
  const labels = ['Low', 'Low', 'Medium', 'High', 'Extreme']
  const colors = ['#22c55e', '#86efac', '#eab308', '#f97316', '#dc2626']
  for (let s = 0; s < 5; s++) {
    for (let l = 0; l < 5; l++) {
      const score = (s + 1) * (l + 1)
      const tier = score <= 4 ? 0 : score <= 8 ? 1 : score <= 12 ? 2 : score <= 19 ? 3 : 4
      cells[`${s}:${l}`] = { score, label: labels[tier]!, color: colors[tier]! }
    }
  }
  return cells
}

/**
 * Idempotently seed 3 sample inspection types (Site Walk, Equipment Daily,
 * Crew Toolbox), importing the existing seeded inspection_banks' criteria into
 * a group on each type where the categories line up. Safe to re-run — keyed off
 * the unique (tenant_id, name) index on inspection_types so we never insert twice.
 */
export async function seedInspectionTypes(tx: any, tenantId: string): Promise<void> {
  // Idempotency guard
  const existing = await tx
    .select({ id: inspectionTypes.id, name: inspectionTypes.name })
    .from(inspectionTypes)
    .where(sql`${inspectionTypes.tenantId} = ${tenantId}`)
  if (existing.length > 0) {
    console.log(`  · inspection types: ${existing.length} already present, skipping`)
    return
  }

  // Find the seeded banks so we can link by category.
  const banks = await tx
    .select({
      id: inspectionBanks.id,
      name: inspectionBanks.name,
      category: inspectionBanks.category,
    })
    .from(inspectionBanks)
    .where(sql`${inspectionBanks.tenantId} = ${tenantId}`)

  const siteBank = banks.find((b: { category: string | null }) => b.category === 'site_inspection')
  const ppeBank = banks.find((b: { category: string | null }) => b.category === 'ppe_check')
  const equipBank = banks.find((b: { category: string | null }) => b.category === 'equipment_check')

  const samples = [
    {
      name: 'Site Walk',
      description:
        'Daily site walk-through — supervisor walks the work zone with the foreman, captures customer sign-off.',
      requiresForeman: true,
      requiresCustomerSignature: true,
      enableCorrectiveActions: true,
      defaultCadence: 'day',
      bankIds: [siteBank?.id, ppeBank?.id].filter((v): v is string => Boolean(v)),
    },
    {
      name: 'Equipment Daily',
      description:
        'Per-shift equipment safety check. No customer signature needed; auto-spawns corrective actions on serious failures.',
      requiresForeman: false,
      requiresCustomerSignature: false,
      enableCorrectiveActions: true,
      defaultCadence: 'day',
      bankIds: [equipBank?.id, ppeBank?.id].filter((v): v is string => Boolean(v)),
    },
    {
      name: 'Crew Toolbox',
      description:
        'Weekly crew safety review. Foreman-led, no customer signature, fewer criteria — quick to complete.',
      requiresForeman: true,
      requiresCustomerSignature: false,
      enableCorrectiveActions: true,
      defaultCadence: 'week',
      bankIds: [siteBank?.id].filter((v): v is string => Boolean(v)),
    },
  ] as const

  let createdTypes = 0
  let importedGroups = 0
  for (const sample of samples) {
    const [type] = await tx
      .insert(inspectionTypes)
      .values({
        tenantId,
        name: sample.name,
        description: sample.description,
        requiresForeman: sample.requiresForeman,
        requiresCustomerSignature: sample.requiresCustomerSignature,
        enableCorrectiveActions: sample.enableCorrectiveActions,
        allowCompliantNotes: true,
        defaultCadence: sample.defaultCadence,
        isPublished: true,
      })
      .onConflictDoNothing({ target: [inspectionTypes.tenantId, inspectionTypes.name] })
      .returning()
    if (!type) continue
    createdTypes += 1
    // Import each bank's criteria into its own group on the type. Banks are now
    // just a library — the type owns the resulting groups + criteria outright.
    for (let i = 0; i < sample.bankIds.length; i++) {
      const bankId = sample.bankIds[i]
      if (!bankId) continue
      const bank = banks.find((b: { id: string }) => b.id === bankId)
      const [group] = await tx
        .insert(inspectionTypeGroups)
        .values({
          tenantId,
          typeId: type.id,
          sequence: i,
          label: bank?.name ?? 'Imported criteria',
        })
        .returning()
      const bankCriteria = await tx
        .select()
        .from(inspectionBankCriteria)
        .where(eq(inspectionBankCriteria.bankId, bankId))
        .orderBy(inspectionBankCriteria.sequence)
      if (bankCriteria.length > 0) {
        await tx.insert(inspectionTypeCriteria).values(
          bankCriteria.map((c: any, j: number) => ({
            tenantId,
            typeId: type.id,
            groupId: group?.id ?? null,
            sequence: j,
            text: c.text,
            responseType: c.responseType,
            requiresPhoto: c.requiresPhoto,
            requiresComment: c.requiresComment,
            sourceBankId: bankId,
            sourceBankCriterionId: c.id,
          })),
        )
      }
      importedGroups += 1
    }
  }
  console.log(
    `  · inspection types: ${createdTypes} created, ${importedGroups} group${importedGroups === 1 ? '' : 's'} imported`,
  )
}

/**
 * Sample equipment categories, billing rates for 3 types, and 5 expense
 * entries spread across recent months. Idempotent — every insert uses
 * `onConflictDoNothing` or pre-checks for existing rows so re-running the
 * seed never duplicates.
 */
async function seedEquipmentRatesAndExpenses(tx: any, tenantId: string): Promise<void> {
  // --- Categories ----------------------------------------------------
  const categoryDefs = [
    { slug: 'vehicles', name: 'Vehicles', description: 'Trucks, vans, pickups', sortOrder: 1 },
    { slug: 'tools', name: 'Tools', description: 'Hand and power tools', sortOrder: 2 },
    { slug: 'lifts', name: 'Lifts', description: 'Aerial lifts, scissor lifts', sortOrder: 3 },
  ]
  for (const c of categoryDefs) {
    await tx
      .insert(equipmentCategories)
      .values({
        tenantId,
        name: c.name,
        slug: c.slug,
        description: c.description,
        sortOrder: c.sortOrder,
      })
      .onConflictDoNothing({ target: [equipmentCategories.tenantId, equipmentCategories.slug] })
  }

  // --- Rates (one row per type) --------------------------------------
  const types = await tx
    .select({ id: equipmentTypes.id, name: equipmentTypes.name })
    .from(equipmentTypes)
    .where(eq(equipmentTypes.tenantId, tenantId))
  const rateDefs: {
    match: RegExp
    hourly: string
    daily: string
    weekly: string
    monthly: string
  }[] = [
    {
      match: /tool|drill|hammer/i,
      hourly: '5.00',
      daily: '40.00',
      weekly: '180.00',
      monthly: '600.00',
    },
    {
      match: /vehicle|truck|pickup|van/i,
      hourly: '35.00',
      daily: '275.00',
      weekly: '1250.00',
      monthly: '4250.00',
    },
    {
      match: /lift|scissor|aerial/i,
      hourly: '85.00',
      daily: '650.00',
      weekly: '2750.00',
      monthly: '8500.00',
    },
  ]
  let ratesCreated = 0
  for (const t of types) {
    const def = rateDefs.find((d) => d.match.test(t.name)) ?? rateDefs[0]
    const [existing] = await tx
      .select({ id: equipmentRates.id })
      .from(equipmentRates)
      .where(eq(equipmentRates.typeId, t.id))
      .limit(1)
    if (existing) continue
    await tx.insert(equipmentRates).values({
      tenantId,
      typeId: t.id,
      hourly: def!.hourly,
      daily: def!.daily,
      weekly: def!.weekly,
      monthly: def!.monthly,
      currency: 'CAD',
    })
    ratesCreated += 1
  }

  // --- Expenses (5 entries spread across recent months) ---------------
  const items = await tx
    .select({ id: equipmentItems.id, name: equipmentItems.name })
    .from(equipmentItems)
    .where(eq(equipmentItems.tenantId, tenantId))
    .limit(5)
  const expenseDefs = [
    {
      offsetDays: 7,
      category: 'fuel',
      vendor: 'Petro-Canada',
      description: 'Weekly fuel-up',
      amount: '125.40',
    },
    {
      offsetDays: 21,
      category: 'repair',
      vendor: 'AAA Tire & Auto',
      description: 'Replaced front-left tire',
      amount: '320.00',
    },
    {
      offsetDays: 45,
      category: 'insurance',
      vendor: 'Intact Insurance',
      description: 'Quarterly premium installment',
      amount: '880.00',
    },
    {
      offsetDays: 60,
      category: 'oil_change',
      vendor: 'Mr Lube',
      description: 'Synthetic oil change + filter',
      amount: '95.50',
    },
    {
      offsetDays: 90,
      category: 'registration',
      vendor: 'ServiceOntario',
      description: 'Annual plate renewal',
      amount: '120.00',
    },
  ]
  const dayMs = 24 * 60 * 60 * 1000
  let expensesCreated = 0
  for (let i = 0; i < Math.min(items.length, expenseDefs.length); i++) {
    const item = items[i]
    const def = expenseDefs[i]
    if (!item || !def) continue
    // Pre-check to keep idempotent (vendor + amount + item is unique enough
    // for the seed corpus).
    const [existing] = await tx
      .select({ id: equipmentExpenses.id })
      .from(equipmentExpenses)
      .where(
        and(
          eq(equipmentExpenses.equipmentItemId, item.id),
          eq(equipmentExpenses.vendor, def.vendor),
          eq(equipmentExpenses.amount, def.amount),
        ),
      )
      .limit(1)
    if (existing) continue
    await tx.insert(equipmentExpenses).values({
      tenantId,
      equipmentItemId: item.id,
      incurredOn: new Date(Date.now() - def.offsetDays * dayMs).toISOString().slice(0, 10),
      category: def.category,
      vendor: def.vendor,
      description: def.description,
      amount: def.amount,
      currency: 'CAD',
    })
    expensesCreated += 1
  }

  // --- One sample log entry per item (idempotent) ---------------------
  let logsCreated = 0
  for (const item of items) {
    const [existing] = await tx
      .select({ id: equipmentLogEntries.id })
      .from(equipmentLogEntries)
      .where(eq(equipmentLogEntries.equipmentItemId, item.id))
      .limit(1)
    if (existing) continue
    await tx.insert(equipmentLogEntries).values({
      tenantId,
      equipmentItemId: item.id,
      entryDate: new Date(Date.now() - 14 * dayMs).toISOString().slice(0, 10),
      kind: 'note',
      title: 'Receipt + inspection notes',
      details: 'Initial intake — checked condition, attached receipt, tagged with QR.',
    })
    logsCreated += 1
  }

  console.log(
    `  · equipment rates/expenses: ${ratesCreated} rates, ${expensesCreated} expenses, ${logsCreated} log entries`,
  )
}

/**
 * Idempotently seed two sample training assessment types for a tenant:
 *   1. WHMIS 2015 (5 questions, linked to the WHMIS course if it exists)
 *   2. Basic Safety Quiz (8 questions, course-agnostic)
 *
 * Skips if any assessment type already exists for the tenant (so re-seeding is
 * safe and won't double-insert).
 */
export async function seedTrainingAssessmentTypes(tx: any, tenantId: string): Promise<void> {
  const existing = await tx
    .select({ id: trainingAssessmentTypes.id })
    .from(trainingAssessmentTypes)
    .where(eq(trainingAssessmentTypes.tenantId, tenantId))
    .limit(1)
  if (existing.length > 0) {
    console.log(`  · training assessment types: already seeded for tenant ${tenantId}, skipping`)
    return
  }

  // Try to find the WHMIS course so we can link the quiz to it (passing the
  // quiz then auto-creates a training_records row).
  const [whmisCourse] = await tx
    .select({ id: trainingCourses.id })
    .from(trainingCourses)
    .where(eq(trainingCourses.tenantId, tenantId))
    .limit(50)
  // Find by code if multiple
  let whmisId: string | null = null
  const allCourses = await tx
    .select({ id: trainingCourses.id, code: trainingCourses.code })
    .from(trainingCourses)
    .where(eq(trainingCourses.tenantId, tenantId))
  for (const c of allCourses) {
    if (c.code === 'WHMIS') {
      whmisId = c.id
      break
    }
  }
  // Fallback to the first returned course (rare; only if the WHMIS row isn't
  // present)
  if (!whmisId && whmisCourse) whmisId = whmisCourse.id

  // --- WHMIS quiz ----------------------------------------------------------
  const [whmis] = await tx
    .insert(trainingAssessmentTypes)
    .values({
      tenantId,
      name: 'WHMIS 2015 quiz',
      description:
        'Five-question knowledge check covering WHMIS pictograms, safety data sheets, and supplier vs workplace labels.',
      passingScore: 80,
      courseId: whmisId,
      preAssessmentMessage:
        'Answer all five questions. You need 80% to pass. Passing this quiz will record completion of WHMIS 2015 for you automatically.',
      postAssessmentMessage:
        'Thanks for completing the WHMIS quiz. If you passed, your training record has been updated.',
      graded: true,
      active: true,
    })
    .returning()
  if (whmis) {
    const whmisQuestions = [
      {
        prompt:
          'What does the "skull and crossbones" WHMIS 2015 pictogram indicate about a material?',
        kind: 'single_choice' as const,
        options: [
          { value: 'A', label: 'Acute toxicity (can cause death or serious harm at low doses)' },
          { value: 'B', label: 'Mildly irritating to the skin' },
          { value: 'C', label: 'Environmental damage only' },
          { value: 'D', label: 'Flammable liquid' },
        ],
        correctAnswer: 'A',
        points: 1,
      },
      {
        prompt: 'A workplace label is required when',
        kind: 'single_choice' as const,
        options: [
          {
            value: 'A',
            label: 'A controlled product is decanted into another container at the workplace',
          },
          { value: 'B', label: 'A product is sold to another company' },
          { value: 'C', label: 'A product is stored unopened in original packaging' },
          { value: 'D', label: 'None of the above' },
        ],
        correctAnswer: 'A',
        points: 1,
      },
      {
        prompt: 'Safety data sheets (SDS) must be readily available to all workers.',
        kind: 'true_false' as const,
        options: null,
        correctAnswer: 'true',
        points: 1,
      },
      {
        prompt: 'Which sections of the SDS are most relevant during an emergency?',
        kind: 'multi_choice' as const,
        options: [
          { value: 'A', label: 'Section 4: First-aid measures' },
          { value: 'B', label: 'Section 5: Firefighting measures' },
          { value: 'C', label: 'Section 6: Accidental release measures' },
          { value: 'D', label: 'Section 16: Other information' },
        ],
        correctAnswer: 'A,B,C',
        points: 2,
      },
      {
        prompt:
          'How long must a worker complete WHMIS training before being allowed to work with controlled products?',
        kind: 'text' as const,
        options: null,
        correctAnswer: null,
        points: 1,
      },
    ]
    let order = 1
    for (const q of whmisQuestions) {
      await tx.insert(trainingAssessmentTypeQuestions).values({
        tenantId,
        typeId: whmis.id,
        prompt: q.prompt,
        kind: q.kind,
        options: q.options,
        correctAnswer: q.correctAnswer,
        points: q.points,
        entityOrder: order++,
        mandatory: true,
      })
    }
  }

  // --- Basic Safety Quiz (course-agnostic) ---------------------------------
  const [basic] = await tx
    .insert(trainingAssessmentTypes)
    .values({
      tenantId,
      name: 'Basic site safety quiz',
      description:
        'General safety awareness quiz — hazard recognition, PPE basics, near-miss reporting, and emergency procedures. Useful as part of a site induction.',
      passingScore: 70,
      courseId: null,
      preAssessmentMessage:
        'Eight short questions. You need 70% to pass. There is no course linked to this quiz — it is purely a competency check.',
      postAssessmentMessage:
        'Thanks for completing the basic safety quiz. Review any questions you got wrong with your supervisor.',
      graded: true,
      active: true,
    })
    .returning()
  if (basic) {
    const basicQuestions = [
      {
        prompt: 'What should you do immediately after a near-miss incident?',
        kind: 'single_choice' as const,
        options: [
          { value: 'A', label: 'Keep working and forget about it' },
          { value: 'B', label: 'Report it to your supervisor as soon as possible' },
          { value: 'C', label: 'Only report it if it happens again' },
          { value: 'D', label: 'Discuss it with co-workers only' },
        ],
        correctAnswer: 'B',
        points: 1,
      },
      {
        prompt:
          'Hard hats must be worn whenever overhead work is occurring within a barricaded area.',
        kind: 'true_false' as const,
        options: null,
        correctAnswer: 'true',
        points: 1,
      },
      {
        prompt:
          'What is the minimum distance you should maintain from an unprotected leading edge of a work platform?',
        kind: 'single_choice' as const,
        options: [
          { value: 'A', label: '0.5 m' },
          { value: 'B', label: '1.0 m' },
          { value: 'C', label: '2.0 m' },
          { value: 'D', label: '3.0 m' },
        ],
        correctAnswer: 'C',
        points: 1,
      },
      {
        prompt:
          'How many of the following are valid types of PPE that should be inspected before each use?',
        kind: 'numeric' as const,
        options: null,
        correctAnswer: '4',
        helpText:
          'Consider: full-body harness, hard hat, safety glasses, hearing protection. The answer should be one number.',
        points: 1,
      },
      {
        prompt: 'Select every situation that requires a hot-work permit.',
        kind: 'multi_choice' as const,
        options: [
          { value: 'A', label: 'Welding above grade in a designated welding bay' },
          { value: 'B', label: 'Grinding on piping in an operating unit' },
          { value: 'C', label: 'Cutting steel beams during a turnaround' },
          { value: 'D', label: 'Plugging in a laptop' },
        ],
        correctAnswer: 'B,C',
        points: 2,
      },
      {
        prompt: 'In Canada, the universal emergency number for non-medical workplace incidents is',
        kind: 'numeric' as const,
        options: null,
        correctAnswer: '911',
        points: 1,
      },
      {
        prompt: 'Lockout/tagout is required only when working on equipment that is more than 50 V.',
        kind: 'true_false' as const,
        options: null,
        correctAnswer: 'false',
        points: 1,
      },
      {
        prompt: 'Briefly describe what "STOP work authority" means and when you would use it.',
        kind: 'text' as const,
        options: null,
        correctAnswer: null,
        points: 2,
      },
    ]
    let order = 1
    for (const q of basicQuestions) {
      await tx.insert(trainingAssessmentTypeQuestions).values({
        tenantId,
        typeId: basic.id,
        prompt: q.prompt,
        kind: q.kind,
        options: q.options,
        correctAnswer: q.correctAnswer,
        helpText: (q as any).helpText ?? null,
        points: q.points,
        entityOrder: order++,
        mandatory: true,
      })
    }
  }

  console.log(
    `  · training assessment types: seeded WHMIS quiz (${whmis?.id ? '5q' : 'failed'}) + Basic Safety Quiz (${basic?.id ? '8q' : 'failed'})`,
  )
}

/**
 * Seed the four canonical PPE types (hard hat, harness, glasses, gloves) with
 * a representative inspection-criteria list each. Called from the main seed
 * after the tenant is in place; idempotent on PPE type name within the tenant.
 *
 * Returns the inserted type rows so the caller can chain item-level seeding.
 */
export async function seedPpeTypesWithCriteria(
  tx: any,
  tenantId: string,
): Promise<{ id: string; name: string }[]> {
  const TYPES: {
    name: string
    category: string
    sizing: string[] | null
    isInspectable: boolean
    everyDays?: number
    criteria: {
      kind: 'pre_use' | 'annual'
      question: string
      description?: string
      severity: 'low' | 'medium' | 'high' | 'critical'
      requiresPhoto?: boolean
    }[]
  }[] = [
    {
      name: 'Hard hat',
      category: 'head',
      sizing: ['S', 'M', 'L', 'XL'],
      isInspectable: true,
      everyDays: 30,
      criteria: [
        {
          kind: 'pre_use',
          question: 'Shell free of cracks, gouges, or sun damage?',
          description:
            'Inspect the entire outer shell for stress cracks, deep gouges, or chalky UV degradation.',
          severity: 'high',
          requiresPhoto: true,
        },
        {
          kind: 'pre_use',
          question: 'Suspension straps and crown intact, properly adjusted?',
          severity: 'medium',
        },
        {
          kind: 'pre_use',
          question: 'Chinstrap (if equipped) operates correctly?',
          severity: 'low',
        },
        {
          kind: 'pre_use',
          question: 'Date of manufacture within 5-year service life?',
          description:
            'Locate the inside-shell DOM stamp and confirm the helmet is still in service window.',
          severity: 'critical',
        },
        {
          kind: 'annual',
          question: 'Manufacturer-recommended pressure / drop test passed?',
          severity: 'critical',
          requiresPhoto: true,
        },
      ],
    },
    {
      name: 'Full-body harness',
      category: 'fall',
      sizing: ['S', 'M', 'L', 'XL'],
      isInspectable: true,
      everyDays: 30,
      criteria: [
        {
          kind: 'pre_use',
          question: 'Webbing free of cuts, fraying, or burns?',
          description:
            'Flex the webbing into an inverted U and look for surface damage every 30 cm.',
          severity: 'critical',
          requiresPhoto: true,
        },
        {
          kind: 'pre_use',
          question: 'D-rings + buckles free of cracks, deformation, or corrosion?',
          severity: 'critical',
          requiresPhoto: true,
        },
        {
          kind: 'pre_use',
          question: 'Stitching intact (no cut, pulled, or loose threads)?',
          severity: 'high',
        },
        {
          kind: 'pre_use',
          question: 'Impact indicator on lanyard / SRL not deployed?',
          severity: 'critical',
        },
        {
          kind: 'pre_use',
          question: 'Labels legible and intact?',
          severity: 'medium',
        },
        {
          kind: 'annual',
          question: 'Annual third-party inspection certificate within 12 months?',
          severity: 'critical',
          requiresPhoto: true,
        },
        {
          kind: 'annual',
          question: 'Webbing tensile sample tested if required by jurisdiction?',
          severity: 'high',
        },
      ],
    },
    {
      name: 'Safety glasses',
      category: 'eye',
      sizing: null,
      isInspectable: true,
      everyDays: 30,
      criteria: [
        {
          kind: 'pre_use',
          question: 'Lenses free of cracks, deep scratches, or pitting?',
          severity: 'high',
        },
        {
          kind: 'pre_use',
          question: 'Side shields intact and securely attached?',
          severity: 'medium',
        },
        {
          kind: 'pre_use',
          question: 'Frame / temples not bent or broken?',
          severity: 'low',
        },
        {
          kind: 'pre_use',
          question: 'Anti-fog / mirror coating still functional (no flaking)?',
          severity: 'low',
        },
      ],
    },
    {
      name: 'Cut-resistant gloves',
      category: 'hand',
      sizing: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
      isInspectable: true,
      everyDays: 30,
      criteria: [
        {
          kind: 'pre_use',
          question: 'Outer shell free of cuts, holes, or punctures?',
          description: 'Pull gloves over your knuckles and inspect every finger pad.',
          severity: 'high',
          requiresPhoto: true,
        },
        {
          kind: 'pre_use',
          question: 'Stitching intact, no fingertips exposed?',
          severity: 'medium',
        },
        {
          kind: 'pre_use',
          question: "Cut rating (e.g. ANSI A4) appropriate for today's task?",
          severity: 'high',
        },
        {
          kind: 'pre_use',
          question: 'Cuff / wrist closure functioning correctly?',
          severity: 'low',
        },
      ],
    },
  ]

  const inserted: { id: string; name: string }[] = []
  for (const t of TYPES) {
    // Idempotency — skip if a type with this name already exists in the tenant.
    const existing = await tx
      .select()
      .from(ppeTypes)
      .where(and(eq(ppeTypes.tenantId, tenantId), eq(ppeTypes.name, t.name)))
      .limit(1)
    let typeRow = existing[0]
    if (!typeRow) {
      const rows = await tx
        .insert(ppeTypes)
        .values({
          tenantId,
          name: t.name,
          category: t.category,
          isInspectable: t.isInspectable,
          sizingScheme: t.sizing,
          inspectionSchedule: t.everyDays ? { everyDays: t.everyDays } : null,
        })
        .returning()
      typeRow = rows[0]
    }
    if (!typeRow) continue
    inserted.push({ id: typeRow.id, name: typeRow.name })

    // Insert criteria — skipping any that already exist (matched on question
    // text within type+kind) so repeated seeds are idempotent.
    const existingCriteria = await tx
      .select()
      .from(ppeTypeInspectionCriteria)
      .where(eq(ppeTypeInspectionCriteria.ppeTypeId, typeRow.id))
    const seen = new Set(existingCriteria.map((c: any) => `${c.inspectionKind}::${c.question}`))

    const byKindOrder = { pre_use: 1, annual: 1 }
    for (const c of t.criteria) {
      const key = `${c.kind}::${c.question}`
      if (seen.has(key)) {
        byKindOrder[c.kind]++
        continue
      }
      await tx.insert(ppeTypeInspectionCriteria).values({
        tenantId,
        ppeTypeId: typeRow.id,
        inspectionKind: c.kind,
        question: c.question,
        description: c.description ?? null,
        severity: c.severity,
        requiresPhoto: c.requiresPhoto ?? false,
        entityOrder: byKindOrder[c.kind]++,
      })
    }
  }

  console.log(
    `  · PPE types: ${inserted.length} seeded with criteria — ${inserted.map((i) => i.name).join(', ')}`,
  )
  return inserted
}

/**
 * Idempotently insert 3 sample pressure-test safe-distance records — covering
 * each governing method (NASA, ASME, Lloyd's) — for the given tenant. Skips if
 * any reference matching 'SD-SEED-%' already exists, so re-seeds are safe.
 *
 * Result columns are precomputed from the pipe segments + test pressure using
 * the same formulas as the app's `_lib.ts` (see tools/safe-distance). The SEED
 * prefix keeps these obviously distinct from real records (SD-YYYY-NNNN).
 */
export async function seedSafeDistanceRecords(tx: any, tenantId: string): Promise<void> {
  const existing = await tx
    .select({ reference: safeDistanceRecords.reference })
    .from(safeDistanceRecords)
    .where(
      sql`${safeDistanceRecords.tenantId} = ${tenantId} AND ${safeDistanceRecords.reference} LIKE 'SD-SEED-%'`,
    )
  if (existing.length > 0) {
    console.log(`  · safe distance: ${existing.length} sample already present, skipping`)
    return
  }

  const siteRow = await tx
    .select({ id: orgUnits.id })
    .from(orgUnits)
    .where(sql`${orgUnits.tenantId} = ${tenantId} AND ${orgUnits.level} = 'site'`)
    .limit(1)
  const siteId = siteRow[0]?.id ?? null

  const supervisorRow = await tx
    .select({ id: tenantUsers.id })
    .from(tenantUsers)
    .where(sql`${tenantUsers.tenantId} = ${tenantId} AND ${tenantUsers.status} = 'active'`)
    .limit(1)
  const supervisorId = supervisorRow[0]?.id ?? null

  const operatorRow = await tx
    .select({ id: people.id })
    .from(people)
    .where(sql`${people.tenantId} = ${tenantId} AND ${people.status} = 'active'`)
    .limit(1)
  const operatorId = operatorRow[0]?.id ?? null

  const now = new Date()
  const dayMs = 24 * 60 * 60 * 1000
  const samples = [
    {
      offset: 1,
      reference: 'SD-SEED-1',
      name: 'North header — 6" line',
      method: 'nasa' as const,
      unit: 'imperial' as const,
      testPressure: '150',
      description: 'Hydro/pneumatic proof of the 6" north header run prior to tie-in.',
      totalVolume: '3.9270',
      resultNasa: '23.6653',
      resultAsme: '98.4252',
      resultLloyds: '10.1488',
      segments: [
        {
          name: 'Header run',
          unit: 'inch' as const,
          length: '240',
          diameter: '6',
          volM3: '0.111199997',
        },
      ],
      notes: 'Exclusion zone set to the NASA-Glenn figure. Bleed-down valve manned throughout.',
    },
    {
      offset: 4,
      reference: 'SD-SEED-2',
      name: 'Compressor skid manifold',
      method: 'asme' as const,
      unit: 'metric' as const,
      testPressure: '50',
      description: 'High-pressure pneumatic test of the compressor skid manifold.',
      totalVolume: '0.8482',
      resultNasa: '32.1848',
      resultAsme: '30.0000',
      resultLloyds: '10.9628',
      segments: [
        {
          name: 'Manifold',
          unit: 'm' as const,
          length: '12',
          diameter: '0.3',
          volM3: '0.848230016',
        },
      ],
      notes:
        'ASME PCC-2 governs. Hard barricade to 30 m, no personnel inside during pressurisation.',
    },
    {
      offset: 9,
      reference: 'SD-SEED-3',
      name: 'Test loop — 8" + 4"',
      method: 'lloyds' as const,
      unit: 'imperial' as const,
      testPressure: '300',
      description: 'Combined loop: 8" main plus a 4" branch.',
      totalVolume: '11.3447',
      resultNasa: '51.6803',
      resultAsme: '98.4252',
      resultLloyds: '18.7792',
      segments: [
        {
          name: '8" main',
          unit: 'inch' as const,
          length: '360',
          diameter: '8',
          volM3: '0.296533324',
        },
        {
          name: '4" branch',
          unit: 'inch' as const,
          length: '120',
          diameter: '4',
          volM3: '0.024711110',
        },
      ],
      notes: "Lloyd's Register figure adopted as the governing stand-off for this loop.",
    },
  ]

  let inserted = 0
  for (const s of samples) {
    const [rec] = await tx
      .insert(safeDistanceRecords)
      .values({
        tenantId,
        reference: s.reference,
        name: s.name,
        method: s.method,
        unit: s.unit,
        testPressure: s.testPressure,
        description: s.description,
        siteOrgUnitId: siteId,
        supervisorTenantUserId: supervisorId,
        operatorPersonId: operatorId,
        totalVolume: s.totalVolume,
        resultNasa: s.resultNasa,
        resultAsme: s.resultAsme,
        resultLloyds: s.resultLloyds,
        occurredAt: new Date(now.getTime() - s.offset * dayMs),
        notes: s.notes,
        attachmentIds: [],
      })
      .returning({ id: safeDistanceRecords.id })
    if (rec?.id) {
      await tx.insert(safeDistanceSegments).values(
        s.segments.map((seg, i) => ({
          tenantId,
          recordId: rec.id,
          name: seg.name,
          unit: seg.unit,
          lengthValue: seg.length,
          internalDiameter: seg.diameter,
          volumeM3: seg.volM3,
          sortOrder: i,
        })),
      )
    }
    inserted++
  }

  console.log(`  · safe distance: ${inserted} sample records seeded`)
}

/**
 * Seed the incident taxonomy + hours-worked sample data:
 *   - 6 classifications (5 top-level + 1 nested example)
 *   - 6 injury types
 *   - 3 monthly hours-worked windows (last 3 months)
 * Also back-fills classification_id on the four seeded incidents so the
 * frequency / DART / OSHA-log reports render right out of the gate.
 */
async function seedIncidentClassifications(tx: any, tenantId: string): Promise<void> {
  // Classifications.  parentId is filled in a second pass once the roots
  // exist; recordable flag drives the TRIR report.
  const classificationSeed: {
    name: string
    code: string
    description: string
    isRecordable: number
    parentName?: string
  }[] = [
    { name: 'Injury', code: 'INJ', description: 'Personal injury — recordable.', isRecordable: 1 },
    { name: 'Illness', code: 'ILL', description: 'Occupational illness.', isRecordable: 1 },
    { name: 'Near miss', code: 'NM', description: 'No injury; loss potential.', isRecordable: 0 },
    {
      name: 'Property damage',
      code: 'PD',
      description: 'Damage to equipment, vehicle, or infrastructure.',
      isRecordable: 0,
    },
    {
      name: 'Environmental',
      code: 'ENV',
      description: 'Spill / release / emission.',
      isRecordable: 0,
    },
    {
      name: 'Slip, trip & fall',
      code: 'STF',
      description: 'Sub-category of injury.',
      isRecordable: 1,
      parentName: 'Injury',
    },
  ]

  const insertedById = new Map<string, string>()
  let order = 10
  for (const c of classificationSeed) {
    if (c.parentName) continue
    const [row] = await tx
      .insert(incidentClassifications)
      .values({
        tenantId,
        parentId: null,
        name: c.name,
        code: c.code,
        description: c.description,
        isRecordable: c.isRecordable,
        sortOrder: order,
      })
      .returning({ id: incidentClassifications.id })
    if (row) insertedById.set(c.name, row.id)
    order += 10
  }
  // Children
  for (const c of classificationSeed) {
    if (!c.parentName) continue
    const parentId = insertedById.get(c.parentName) ?? null
    const [row] = await tx
      .insert(incidentClassifications)
      .values({
        tenantId,
        parentId,
        name: c.name,
        code: c.code,
        description: c.description,
        isRecordable: c.isRecordable,
        sortOrder: order,
      })
      .returning({ id: incidentClassifications.id })
    if (row) insertedById.set(c.name, row.id)
    order += 10
  }

  // Injury types
  const injuryTypeSeed: { name: string; oshaCode: string; description: string }[] = [
    { name: 'Laceration', oshaCode: 'CUT', description: 'Cut or tear of skin.' },
    {
      name: 'Contusion / bruise',
      oshaCode: 'CON',
      description: 'Blunt trauma without skin break.',
    },
    { name: 'Strain / sprain', oshaCode: 'STR', description: 'Soft-tissue stretch or tear.' },
    { name: 'Fracture', oshaCode: 'FRA', description: 'Bone break.' },
    { name: 'Burn — thermal', oshaCode: 'BRN', description: 'Heat-source burn.' },
    { name: 'Chemical exposure', oshaCode: 'CHM', description: 'Skin or inhalation exposure.' },
  ]
  for (let i = 0; i < injuryTypeSeed.length; i++) {
    const t = injuryTypeSeed[i]!
    await tx.insert(incidentInjuryTypes).values({
      tenantId,
      name: t.name,
      oshaCode: t.oshaCode,
      description: t.description,
      sortOrder: (i + 1) * 10,
    })
  }

  // Hours-worked windows — last 3 months (tenant-wide).  Numbers are
  // realistic for a ~40-person field-ops crew.
  const today = new Date()
  for (let m = 1; m <= 3; m++) {
    const monthStart = new Date(today.getFullYear(), today.getMonth() - m, 1)
    const monthEnd = new Date(today.getFullYear(), today.getMonth() - m + 1, 0)
    const label = monthStart.toLocaleString('en-US', { month: 'long', year: 'numeric' })
    // Slight per-month variance to make the rate chart visibly interesting.
    const hours = (6400 + m * 250).toFixed(2)
    const headcount = 40 + (m % 2)
    await tx.insert(incidentHoursPeriods).values({
      tenantId,
      siteOrgUnitId: null,
      periodStart: monthStart.toISOString().slice(0, 10),
      periodEnd: monthEnd.toISOString().slice(0, 10),
      periodLabel: label,
      totalHours: hours,
      employeeCount: headcount,
      notes: 'Tenant-wide rollup (auto-seeded).',
    })
  }

  // Back-fill classification_id on the four seeded incidents so the
  // recordable rollup has structured data immediately.
  const seededIncidents = await tx
    .select({ id: incidents.id, reference: incidents.reference, type: incidents.type })
    .from(incidents)
    .where(eq(incidents.tenantId, tenantId))
  const mapByType: Record<string, string | undefined> = {
    injury: insertedById.get('Injury'),
    illness: insertedById.get('Illness'),
    near_miss: insertedById.get('Near miss'),
    property_damage: insertedById.get('Property damage'),
    environmental: insertedById.get('Environmental'),
  }
  for (const inc of seededIncidents) {
    const cId = mapByType[inc.type as keyof typeof mapByType]
    if (!cId) continue
    await tx.update(incidents).set({ classificationId: cId }).where(eq(incidents.id, inc.id))
  }

  console.log(
    `  · incident taxonomy: ${classificationSeed.length} classifications, ${injuryTypeSeed.length} injury types, 3 hours-worked windows, ${seededIncidents.length} incidents back-filled`,
  )
}

/**
 * Seed the People taxonomy tables — groups, titles + their job-description task
 * lists. Includes some sample memberships and acknowledgement records so the UI
 * has data to render on first boot.
 *
 * Idempotent guard: skips entirely if any `person_titles` rows already exist
 * for the tenant.
 */
export async function seedPeopleGroupsAndTitles(tx: any, tenantId: string): Promise<void> {
  const [existing] = await tx
    .select({ id: personTitles.id })
    .from(personTitles)
    .where(eq(personTitles.tenantId, tenantId))
    .limit(1)
  if (existing) {
    console.log('  · people taxonomy already seeded, skipping')
    return
  }
  // Pull existing people so we can attach memberships
  const peopleRows = await tx
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      jobTitle: people.jobTitle,
    })
    .from(people)
    .where(eq(people.tenantId, tenantId))
  if (peopleRows.length === 0) {
    console.log('  · no people in tenant — skipping people taxonomy seed')
    return
  }
  const findByName = (last: string) => peopleRows.find((p: any) => p.lastName === last)

  // --- Groups (4) ----------------------------------------------------------
  const groupSeed = [
    {
      name: 'JHSC Members',
      description: 'Joint Health & Safety Committee members for monthly inspections + meetings.',
      color: '#0f766e',
    },
    {
      name: 'First Aid Responders',
      description: 'Workers certified to provide on-site first aid (SFA-CPR-C minimum).',
      color: '#dc2626',
    },
    {
      name: 'Fire Wardens',
      description: 'Designated muster-point leaders during evacuation drills.',
      color: '#ea580c',
    },
    {
      name: 'Confined-Space Entrants',
      description: 'Cleared for permit-required confined-space entry duties.',
      color: '#7c3aed',
    },
  ] as const
  const insertedGroups = await tx
    .insert(personGroups)
    .values(groupSeed.map((g) => ({ tenantId, ...g })))
    .returning()

  // Distribute groups among the first ~half of the workforce
  const groupMembershipRows: { tenantId: string; groupId: string; personId: string }[] = []
  for (const [idx, g] of insertedGroups.entries()) {
    const slice = peopleRows.filter(
      (_: any, i: number) =>
        i % insertedGroups.length === idx % insertedGroups.length || i < 3 + idx,
    )
    for (const p of slice.slice(0, 4)) {
      groupMembershipRows.push({ tenantId, groupId: g.id, personId: p.id })
    }
  }
  if (groupMembershipRows.length > 0) {
    await tx.insert(personGroupMemberships).values(groupMembershipRows).onConflictDoNothing()
  }

  // --- Titles (6) ---------------------------------------------------------
  const titleSeed = [
    {
      name: 'Carpenter',
      description: 'Performs rough and finish carpentry on structural and form-work assemblies.',
      responsibilities:
        '• Lay out, fabricate and install wood or metal stud framing\n• Construct concrete forms and falsework\n• Install doors, windows, trim and hardware\n• Maintain hand and power tools in safe condition',
      education:
        'Inter-provincial Red Seal Carpenter ticket preferred. Minimum: completed carpentry apprenticeship year 3.',
      experience: 'Minimum 3 years on commercial / industrial sites.',
    },
    {
      name: 'Welder',
      description: 'Performs structural, pipe and fabrication welding to project specifications.',
      responsibilities:
        '• Read and interpret welding procedure specifications (WPS)\n• Perform SMAW / GMAW / GTAW welds in all positions\n• Verify fit-up and joint preparation\n• Conduct visual weld inspection and rework as required',
      education: 'CWB-certified welder ticket required. WHMIS + Fall Protection current.',
      experience:
        'Minimum 5 years pressure / structural welding. CWB qualification continuity required.',
    },
    {
      name: 'Foreman',
      description: 'Front-line supervisor responsible for crew productivity, safety and quality.',
      responsibilities:
        '• Plan daily work and assign tasks within scope\n• Conduct toolbox talks and pre-job hazard assessments\n• Enforce site safety rules and PPE compliance\n• Report incidents and near-misses immediately',
      education:
        'Trade ticket in crew discipline + Supervisor Health & Safety Awareness (Ontario MoL).',
      experience: 'Minimum 8 years on tools + 2 years supervisory experience.',
    },
    {
      name: 'Apprentice',
      description: 'Learner under journey-person supervision. Performs work as directed.',
      responsibilities:
        '• Assist journey-person in all assigned tasks\n• Maintain apprenticeship logbook\n• Attend scheduled trade school sessions\n• Ask for guidance — never improvise on unfamiliar tasks',
      education: 'Registered apprentice with provincial trades authority.',
      experience: 'No minimum — pairs with experienced mentor at all times.',
    },
    {
      name: 'Project Manager',
      description: 'End-to-end ownership of project schedule, budget and safety performance.',
      responsibilities:
        '• Build and maintain the master project schedule\n• Manage cost-to-complete and forecast variances\n• Lead client communication and change-order process\n• Chair monthly safety steering committee',
      education: 'Engineering or Construction Management degree. PMP certification preferred.',
      experience: 'Minimum 10 years construction industry, 5 years as PM on >$5M projects.',
    },
    {
      name: 'Safety Officer',
      description: 'Owns the site safety program. Reports independently to senior management.',
      responsibilities:
        '• Conduct daily site walks and document findings\n• Investigate incidents and near-misses\n• Maintain training matrix and PPE registers\n• Liaise with regulators and host clients on compliance matters',
      education: 'CRSP / NCSO designation. Standard First Aid + CPR-C current.',
      experience: 'Minimum 5 years dedicated safety role on industrial construction sites.',
    },
  ] as const

  const insertedTitles = await tx
    .insert(personTitles)
    .values(titleSeed.map((t) => ({ tenantId, ...t })))
    .returning()
  const titleByName = new Map<string, any>(insertedTitles.map((t: any) => [t.name as string, t]))

  // Assign primary titles to specific seed people (matching their jobTitle text)
  const titleAssignmentRows: {
    tenantId: string
    titleId: string
    personId: string
    isPrimary: boolean
  }[] = []
  const heuristicMap: Record<string, string> = {
    Anderson: 'Foreman', // Site Supervisor → closest match
    Bell: 'Carpenter',
    Chen: 'Carpenter',
    Desai: 'Welder',
    Eaton: 'Foreman',
    Foster: 'Apprentice',
    Gonzales: 'Apprentice',
    Hamid: 'Welder',
    Iverson: 'Safety Officer',
    Jensen: 'Project Manager',
  }
  for (const [last, titleName] of Object.entries(heuristicMap)) {
    const person = findByName(last)
    const title = titleByName.get(titleName)
    if (person && title) {
      titleAssignmentRows.push({
        tenantId,
        titleId: title.id,
        personId: person.id,
        isPrimary: true,
      })
    }
  }
  if (titleAssignmentRows.length > 0) {
    await tx.insert(personTitleAssignments).values(titleAssignmentRows).onConflictDoNothing()
  }

  // --- Per-title task lists -----------------------------------------------
  const tasksByTitle: Record<string, { task: string; description?: string }[]> = {
    Carpenter: [
      {
        task: 'Inspect personal hand tools before each shift',
        description: 'Check handles, edges, guards, electrical leads.',
      },
      {
        task: 'Wear appropriate PPE for the task at hand',
        description: 'Minimum: hard hat, glasses, gloves, CSA boots.',
      },
      { task: 'Perform daily harness inspection before fall-arrest work' },
      { task: 'Maintain housekeeping in active work area at all times' },
      { task: 'Report all incidents, injuries and near-misses to foreman' },
    ],
    Welder: [
      { task: 'Verify WPS is current and matches the joint specification' },
      { task: 'Inspect welding leads, ground clamps, and regulators each shift' },
      {
        task: 'Conduct fire watch for required time after hot work',
        description: 'Minimum 30 minutes post-weld in non-confined areas.',
      },
      { task: 'Wear full leathers, FR clothing, and shaded helmet during arc work' },
      { task: 'Perform visual inspection of each completed weld before moving on' },
    ],
    Foreman: [
      {
        task: 'Lead daily toolbox talk and document attendance',
        description: "Cover the JSHA for the day's work.",
      },
      { task: 'Verify all workers have required training before assigning task' },
      { task: 'Perform pre-job hazard assessment with crew' },
      { task: 'Stop unsafe work immediately and escalate to safety officer' },
      { task: 'Conduct end-of-day site walk and document any incomplete work' },
    ],
    Apprentice: [
      { task: 'Maintain apprenticeship logbook daily' },
      { task: 'Work only under direct journey-person supervision' },
      { task: 'Ask for clarification on any unfamiliar task before starting' },
      { task: 'Attend all scheduled trade-school sessions' },
    ],
    'Project Manager': [
      { task: 'Maintain master project schedule and review weekly with client' },
      { task: 'Approve all change orders before execution' },
      { task: 'Chair monthly safety steering committee meeting' },
      { task: 'Review monthly cost forecast vs. budget' },
      { task: 'Sign off on all sub-contractor pre-qualifications' },
    ],
    'Safety Officer': [
      { task: 'Conduct daily site safety walk and log findings' },
      { task: 'Investigate every incident and near-miss within 24 hours' },
      { task: 'Maintain training matrix and notify supervisors of expiring certs' },
      { task: 'Audit PPE issue register weekly' },
      { task: 'Liaise with regulator on any reportable event' },
      { task: 'Lead monthly emergency-response drill' },
    ],
  }

  const taskRows: {
    tenantId: string
    titleId: string
    task: string
    description?: string | null
    entityOrder: number
  }[] = []
  for (const [titleName, tasks] of Object.entries(tasksByTitle)) {
    const title = titleByName.get(titleName)
    if (!title) continue
    for (const [i, t] of tasks.entries()) {
      taskRows.push({
        tenantId,
        titleId: title.id,
        task: t.task,
        description: t.description ?? null,
        entityOrder: i + 1,
      })
    }
  }
  const insertedTasks = await tx.insert(jobTitleTasks).values(taskRows).returning()

  // --- Sample acknowledgements -------------------------------------------
  // Have each assigned person acknowledge the first task of their title to
  // give the matrix view some data on first boot.
  const ackRows: {
    tenantId: string
    taskId: string
    personId: string
  }[] = []
  for (const a of titleAssignmentRows) {
    const firstTask = insertedTasks.find((t: any) => t.titleId === a.titleId && t.entityOrder === 1)
    if (firstTask) {
      ackRows.push({ tenantId, taskId: firstTask.id, personId: a.personId })
    }
  }
  if (ackRows.length > 0) {
    await tx.insert(jobTitleTaskAcknowledgments).values(ackRows).onConflictDoNothing()
  }

  // --- Refresh denormalised caches on `people` ---------------------------
  await tx.execute(sql`
    UPDATE people
    SET group_ids = COALESCE((
      SELECT jsonb_agg(group_id ORDER BY group_id)
      FROM person_group_memberships
      WHERE person_id = people.id AND tenant_id = ${tenantId}
    ), '[]'::jsonb),
    title_ids = COALESCE((
      SELECT jsonb_agg(title_id ORDER BY title_id)
      FROM person_title_assignments
      WHERE person_id = people.id AND tenant_id = ${tenantId}
    ), '[]'::jsonb)
    WHERE tenant_id = ${tenantId}
  `)

  console.log(
    `  · people taxonomy: ${insertedGroups.length} groups (${groupMembershipRows.length} memberships), ${insertedTitles.length} titles (${titleAssignmentRows.length} primary assignments, ${insertedTasks.length} job-description tasks, ${ackRows.length} sample acknowledgements)`,
  )
}

// HazID library seed — the build agent declared the call but forgot to ship
// the function body. This adds 5 hazard types, 12 hazards, 3 hazard sets, 8
// tasks, and 2 assessment types (one with all sections, one minimal). All
// idempotent via a slug-based existence check.
export async function seedHazidLibraries(tx: any, tenantId: string): Promise<void> {
  const existing = await tx
    .select({ id: hazidHazardTypes.id })
    .from(hazidHazardTypes)
    .where(sql`${hazidHazardTypes.tenantId} = ${tenantId}`)
  if (existing.length > 0) {
    console.log(`  · hazid libraries: ${existing.length} hazard types already present, skipping`)
    return
  }

  const typeRows = await tx
    .insert(hazidHazardTypes)
    .values([
      { tenantId, name: 'Physical', color: '#ef4444' },
      { tenantId, name: 'Chemical', color: '#a855f7' },
      { tenantId, name: 'Biological', color: '#22c55e' },
      { tenantId, name: 'Ergonomic', color: '#0ea5e9' },
      { tenantId, name: 'Environmental', color: '#f59e0b' },
    ])
    .returning({ id: hazidHazardTypes.id, name: hazidHazardTypes.name })

  const byName: Record<string, string> = {}
  for (const r of typeRows) byName[r.name] = r.id

  const hazardRows = await tx
    .insert(hazidHazards)
    .values([
      {
        tenantId,
        name: 'Slip / trip',
        hazardTypeId: byName['Physical'],
        standardControls: 'Housekeeping; remove debris; mark wet floors.',
      },
      {
        tenantId,
        name: 'Falling object',
        hazardTypeId: byName['Physical'],
        standardControls: 'Toe-boards; hard hats; secure tools at height.',
      },
      {
        tenantId,
        name: 'Pinch point',
        hazardTypeId: byName['Physical'],
        standardControls: 'LOTO; guard installed; awareness training.',
      },
      {
        tenantId,
        name: 'Sharp edges',
        hazardTypeId: byName['Physical'],
        standardControls: 'Cut-resistant gloves; deburr; storage cages.',
      },
      {
        tenantId,
        name: 'Solvent exposure',
        hazardTypeId: byName['Chemical'],
        standardControls: 'Local exhaust; respirator per SDS; eye-wash station.',
      },
      {
        tenantId,
        name: 'Welding fumes',
        hazardTypeId: byName['Chemical'],
        standardControls: 'Fume extractor; PAPR for stainless/galv; SDS posted.',
      },
      {
        tenantId,
        name: 'Biohazard (bodily fluid)',
        hazardTypeId: byName['Biological'],
        standardControls: 'Universal precautions; disposable nitrile; biohazard kit.',
      },
      {
        tenantId,
        name: 'Heavy lifting',
        hazardTypeId: byName['Ergonomic'],
        standardControls: 'Mechanical aid; team lift > 25kg; rotation.',
      },
      {
        tenantId,
        name: 'Repetitive motion',
        hazardTypeId: byName['Ergonomic'],
        standardControls: 'Job rotation; ergonomic tooling; stretching protocol.',
      },
      {
        tenantId,
        name: 'Heat stress',
        hazardTypeId: byName['Environmental'],
        standardControls: 'Hydration station; mandated breaks; shaded rest area.',
      },
      {
        tenantId,
        name: 'Cold exposure',
        hazardTypeId: byName['Environmental'],
        standardControls: 'Insulated PPE; warming hut; buddy system.',
      },
      {
        tenantId,
        name: 'Noise > 85 dBA',
        hazardTypeId: byName['Physical'],
        standardControls: 'Hearing protection mandatory; audiometric testing.',
      },
    ])
    .returning({ id: hazidHazards.id, name: hazidHazards.name })

  // Hazard sets — pre-curated groupings
  const hazardSets = await tx
    .insert(hazidHazardSets)
    .values([
      {
        tenantId,
        name: 'Confined space entry',
        hazardIds: hazardRows
          .filter((h: any) => /slip|pinch|solvent|biohaz/i.test(h.name))
          .map((h: any) => h.id),
      },
      {
        tenantId,
        name: 'Outdoor work — summer',
        hazardIds: hazardRows
          .filter((h: any) => /heat|slip|repetitive|fall/i.test(h.name))
          .map((h: any) => h.id),
      },
      {
        tenantId,
        name: 'Welding / hot work',
        hazardIds: hazardRows
          .filter((h: any) => /weld|sharp|noise|fall/i.test(h.name))
          .map((h: any) => h.id),
      },
    ])
    .returning({ id: hazidHazardSets.id, name: hazidHazardSets.name })
  const hazardSetByName = new Map(hazardSets.map((s: any) => [s.name, s.id] as const))

  // Task library
  await tx.insert(hazidTasks).values([
    {
      tenantId,
      name: 'Set up barricades',
      description: 'Establish barrier perimeter before work begins.',
    },
    {
      tenantId,
      name: 'Lock out / tag out',
      description: 'Isolate energy sources, verify zero state.',
    },
    {
      tenantId,
      name: 'Pre-use inspection',
      description: 'Visual + functional inspection of every tool/PPE.',
    },
    { tenantId, name: 'Atmospheric test', description: 'Verify O₂ / LEL / H₂S / CO before entry.' },
    {
      tenantId,
      name: 'Rigging setup',
      description: 'Inspect slings, check WLL, verify anchor points.',
    },
    {
      tenantId,
      name: 'Hot work permit',
      description: 'Verify fire watch + extinguisher + clear combustibles.',
    },
    {
      tenantId,
      name: 'Don PPE',
      description: 'Confirm all crew has required PPE before entering zone.',
    },
    {
      tenantId,
      name: 'Tailboard meeting',
      description: 'Review JSA with crew; confirm understanding.',
    },
  ])

  const embeddedAppTemplates = await seedHazardAssessmentAppTemplates(tx, tenantId)

  // Assessment types — native JSHA structure plus embedded builder apps for
  // specialty procedures that need their own structure/workflow.
  const [fullType, minimalType, confinedType, arcFlashType] = await tx
    .insert(hazidAssessmentTypes)
    .values([
      {
        tenantId,
        name: 'Standard JSHA',
        description: 'Job Safety Hazard Analysis with the core sections enabled.',
        hasTasks: true,
        hasHazards: true,
        hasPPE: true,
        hasQuestions: true,
        defaultHazardSetId: hazardSetByName.get('Outdoor work — summer') ?? null,
      },
      {
        tenantId,
        name: 'Quick FLRA',
        description: 'Field-Level Risk Assessment — minimal sections, fast to fill.',
        hasTasks: false,
        hasHazards: true,
        hasPPE: true,
        hasQuestions: false,
      },
      {
        tenantId,
        name: 'Confined Space JSHA',
        description:
          'Core JSHA plus an embedded confined-space entry app for readings, entry log, rescue planning, and sign-off.',
        hasTasks: true,
        hasHazards: true,
        hasPPE: true,
        hasQuestions: true,
        defaultHazardSetId: hazardSetByName.get('Confined space entry') ?? null,
      },
      {
        tenantId,
        name: 'Arc Flash JSHA',
        description:
          'Core JSHA plus an embedded arc-flash work-plan app for electrical boundaries, PPE, controls, and qualified sign-off.',
        hasTasks: true,
        hasHazards: true,
        hasPPE: true,
        hasQuestions: true,
        defaultHazardSetId: hazardSetByName.get('Welding / hot work') ?? null,
      },
    ])
    .returning({ id: hazidAssessmentTypes.id, name: hazidAssessmentTypes.name })

  await tx.insert(hazidAssessmentTypeApps).values([
    {
      tenantId,
      typeId: confinedType.id,
      templateId: embeddedAppTemplates.confinedSpaceTemplateId,
      key: 'confined_space_entry_plan',
      label: 'Confined-space entry app',
      description: 'Readings, entry log, rescue planning, and entry sign-off.',
      required: true,
      autoCreate: true,
      entityOrder: 1,
      config: { replacesNativeSection: 'confined_space' },
    },
    {
      tenantId,
      typeId: arcFlashType.id,
      templateId: embeddedAppTemplates.arcFlashTemplateId,
      key: 'arc_flash_work_plan',
      label: 'Arc-flash work-plan app',
      description: 'Electrical study details, controls, PPE, boundaries, and sign-off.',
      required: true,
      autoCreate: true,
      entityOrder: 1,
      config: { replacesNativeSection: 'arc_flash' },
    },
  ])

  const basePpe: Array<[string, boolean]> = [
    ['Hard hat', true],
    ['Safety glasses', true],
    ['Steel-toe boots', true],
    ['Hi-vis vest', true],
    ['Gloves (task-specific)', false],
    ['Hearing protection', false],
  ]
  const ppeRows = [fullType, minimalType, confinedType, arcFlashType].flatMap((type: any) =>
    basePpe.map(([name, required], i) => ({
      tenantId,
      typeId: type.id,
      name,
      required,
      entityOrder: i + 1,
    })),
  )
  ppeRows.push(
    {
      tenantId,
      typeId: fullType.id,
      name: 'Fall harness (if WAH)',
      required: false,
      entityOrder: 7,
    },
    {
      tenantId,
      typeId: confinedType.id,
      name: 'Respiratory protection (if required by atmosphere/SDS)',
      required: false,
      entityOrder: 7,
    },
    {
      tenantId,
      typeId: confinedType.id,
      name: 'Retrieval harness / lifeline',
      required: true,
      entityOrder: 8,
    },
    {
      tenantId,
      typeId: arcFlashType.id,
      name: 'Arc-rated FR clothing',
      required: true,
      entityOrder: 7,
    },
    {
      tenantId,
      typeId: arcFlashType.id,
      name: 'Voltage-rated gloves with leather protectors',
      required: true,
      entityOrder: 8,
    },
  )
  await tx.insert(hazidAssessmentTypePPE).values(ppeRows)

  const baseQuestions = [
    'Have all crew members reviewed this JSHA?',
    'Have all hazards been assessed and controlled?',
    'Is the work area clear and properly barricaded?',
    'Are emergency procedures known to all crew?',
  ]
  const questionRows = [fullType, confinedType, arcFlashType].flatMap((type: any) =>
    baseQuestions.map((question, i) => ({
      tenantId,
      typeId: type.id,
      question,
      questionType: 'yes_no' as const,
      requiresYes: true,
      entityOrder: i + 1,
    })),
  )
  questionRows.push(
    {
      tenantId,
      typeId: confinedType.id,
      question: 'Has the confined-space entry app been completed before entry?',
      questionType: 'yes_no' as const,
      requiresYes: true,
      entityOrder: 5,
    },
    {
      tenantId,
      typeId: arcFlashType.id,
      question: 'Has the arc-flash work-plan app been completed before electrical work?',
      questionType: 'yes_no' as const,
      requiresYes: true,
      entityOrder: 5,
    },
  )
  await tx.insert(hazidAssessmentTypeQuestions).values(questionRows)

  console.log(
    `  · hazid libraries: ${typeRows.length} hazard types, ${hazardRows.length} hazards, 3 sets, 8 tasks, 4 assessment types, 2 embedded apps`,
  )
}

// Inspection records — 5 sample legacy-style inspections against the seeded
// inspection types, each with criterion responses (mix of pass/fail/N-A).
export async function seedInspectionRecords(tx: any, tenantId: string): Promise<void> {
  const existing = await tx
    .select({ id: inspectionRecords.id })
    .from(inspectionRecords)
    .where(
      sql`${inspectionRecords.tenantId} = ${tenantId} AND ${inspectionRecords.reference} LIKE 'INS-SEED-%'`,
    )
  if (existing.length > 0) {
    console.log(`  · inspection records: ${existing.length} already present, skipping`)
    return
  }
  const types = await tx
    .select({ id: inspectionTypes.id, name: inspectionTypes.name })
    .from(inspectionTypes)
    .where(sql`${inspectionTypes.tenantId} = ${tenantId}`)
  if (types.length === 0) {
    console.log('  · inspection records: no types in tenant, skipping')
    return
  }
  const siteRow = await tx
    .select({ id: orgUnits.id })
    .from(orgUnits)
    .where(sql`${orgUnits.tenantId} = ${tenantId} AND ${orgUnits.level} = 'site'`)
    .limit(1)
  const siteId = siteRow[0]?.id ?? null
  const inspectorRow = await tx
    .select({ id: tenantUsers.id })
    .from(tenantUsers)
    .where(sql`${tenantUsers.tenantId} = ${tenantId}`)
    .limit(1)
  const inspectorId = inspectorRow[0]?.id ?? null
  // Pull criteria for each type so we can write responses
  const today = new Date()
  const DAY_MS = 24 * 60 * 60 * 1000
  let created = 0
  for (let i = 0; i < 5; i++) {
    const type = types[i % types.length]
    const occurredAt = new Date(today.getTime() - i * DAY_MS * 3)
    const ref = `INS-SEED-${String(i + 1).padStart(4, '0')}`
    const [rec] = await tx
      .insert(inspectionRecords)
      .values({
        tenantId,
        reference: ref,
        typeId: type.id,
        status: i < 2 ? 'submitted' : i === 2 ? 'in_progress' : 'closed',
        occurredAt,
        siteOrgUnitId: siteId,
        inspectorTenantUserId: inspectorId,
        notes: i === 4 ? 'Routine quarterly inspection — no issues found.' : null,
        submittedAt: i < 2 ? occurredAt : null,
        closedAt: i >= 3 ? occurredAt : null,
      })
      .returning({ id: inspectionRecords.id })
    if (!rec) continue
    created++
    // Pull the type's own criteria (with their group label + response config),
    // in group then criterion order.
    const criteria = await tx
      .select({
        id: inspectionTypeCriteria.id,
        text: inspectionTypeCriteria.text,
        responseType: inspectionTypeCriteria.responseType,
        requiresPhoto: inspectionTypeCriteria.requiresPhoto,
        requiresComment: inspectionTypeCriteria.requiresComment,
        groupLabel: inspectionTypeGroups.label,
      })
      .from(inspectionTypeCriteria)
      .leftJoin(inspectionTypeGroups, eq(inspectionTypeGroups.id, inspectionTypeCriteria.groupId))
      .where(eq(inspectionTypeCriteria.typeId, type.id))
      .orderBy(inspectionTypeGroups.sequence, inspectionTypeCriteria.sequence)
    if (criteria.length === 0) continue
    for (let j = 0; j < criteria.length; j++) {
      const answer = j === 0 && i === 1 ? 'fail' : j % 5 === 4 ? 'n_a' : 'pass'
      await tx.insert(inspectionRecordCriteria).values({
        tenantId,
        recordId: rec.id,
        criterionId: criteria[j].id,
        questionTextSnapshot: criteria[j].text,
        groupLabelSnapshot: criteria[j].groupLabel ?? null,
        responseType: criteria[j].responseType,
        requiresPhoto: criteria[j].requiresPhoto,
        requiresComment: criteria[j].requiresComment,
        sequence: j + 1,
        answer,
        severity: answer === 'fail' ? 'high' : null,
        nonComplianceDescription:
          answer === 'fail' ? 'Latch loose on east door; tagged out for follow-up.' : null,
      })
    }
  }
  console.log(`  · inspection records: ${created} seeded with criterion responses`)
}

// Training assessment attempts — 5 sample completed quizzes against the
// seeded assessment types, mixing pass/fail outcomes.
export async function seedTrainingAssessmentAttempts(tx: any, tenantId: string): Promise<void> {
  const existing = await tx
    .select({ id: trainingAssessments.id })
    .from(trainingAssessments)
    .where(eq(trainingAssessments.tenantId, tenantId))
  if (existing.length > 0) {
    console.log(`  · training assessment attempts: ${existing.length} already present, skipping`)
    return
  }
  const typeRows = await tx
    .select({ id: trainingAssessmentTypes.id, passingScore: trainingAssessmentTypes.passingScore })
    .from(trainingAssessmentTypes)
    .where(eq(trainingAssessmentTypes.tenantId, tenantId))
    .limit(2)
  if (typeRows.length === 0) {
    console.log('  · training assessment attempts: no types in tenant, skipping')
    return
  }
  const peopleRows = await tx
    .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
    .from(people)
    .where(eq(people.tenantId, tenantId))
    .limit(5)
  if (peopleRows.length < 3) {
    console.log('  · training assessment attempts: not enough people, skipping')
    return
  }
  const today = new Date()
  const DAY_MS = 24 * 60 * 60 * 1000
  let created = 0
  for (let i = 0; i < 5; i++) {
    const type = typeRows[i % typeRows.length]
    const person = peopleRows[i % peopleRows.length]
    const score = i === 1 ? 60 : i === 4 ? 70 : 85 + i * 2
    const passingScore = type.passingScore ?? 75
    const passed = score >= passingScore
    await tx.insert(trainingAssessments).values({
      tenantId,
      typeId: type.id,
      personId: person.id,
      passingScore,
      score,
      passed,
      status: 'submitted',
      startedAt: new Date(today.getTime() - i * DAY_MS * 2 - 30 * 60 * 1000),
      completedAt: new Date(today.getTime() - i * DAY_MS * 2),
    })
    created++
  }
  console.log(`  · training assessment attempts: ${created} seeded (mixed pass/fail)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
