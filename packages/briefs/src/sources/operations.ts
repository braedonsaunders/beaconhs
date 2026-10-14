// Operational sources: incidents, corrective actions, inspections, PPE
// inspections, hazard assessments, and equipment work orders. Each one applies
// the module's own record-visibility tier for the member the brief runs as.

import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  correctiveActions,
  equipmentItems,
  equipmentWorkOrders,
  hazidAssessments,
  hazidAssessmentTypes,
  incidents,
  inspectionRecordCriteria,
  inspectionRecords,
  inspectionTypes,
  orgUnits,
  ppeInspectionCriteria,
  ppeInspections,
  ppeItems,
  ppeTypes,
} from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import { moduleScopeWhere } from '@beaconhs/tenant/visibility'
import {
  boundedText,
  departmentNameSql,
  ENUM_LABEL,
  localDateSql,
  siteNameSql,
  tally,
  tenantUserDepartmentSql,
  tenantUserNameSql,
  type BriefSourceDefinition,
} from './types'

const emptyParams = z.object({}).strict()
type EmptyParams = z.infer<typeof emptyParams>

function readsTier(ctx: RequestContext, prefix: string): boolean {
  return (
    ctx.isSuperAdmin ||
    can(ctx, `${prefix}.read.all`) ||
    can(ctx, `${prefix}.read.site`) ||
    can(ctx, `${prefix}.read.self`)
  )
}

// --- Incidents ----------------------------------------------------------------

export const incidentsSource: BriefSourceDefinition<EmptyParams> = {
  key: 'incidents',
  label: 'Incidents',
  description: 'Incidents that occurred or were reported in the window, with severity and status.',
  citationPrefix: 'I',
  params: emptyParams,
  defaultParams: {},
  paramFields: [],
  canRead: (ctx) => readsTier(ctx, 'incidents'),
  async collect({ ctx, tx, window, scope, limit }) {
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'incidents',
      ownerCols: [incidents.reportedByTenantUserId],
      siteCol: incidents.siteOrgUnitId,
    })
    const rows = await tx
      .select({
        id: incidents.id,
        reference: incidents.reference,
        title: incidents.title,
        type: incidents.type,
        severity: incidents.severity,
        status: incidents.status,
        description: incidents.description,
        immediateAction: incidents.immediateActionTaken,
        lostTime: incidents.lostTime,
        occurredOn: localDateSql(incidents.occurredAt, window.timezone),
        site: orgUnits.name,
        department: departmentNameSql(incidents.departmentId),
        reporter: tenantUserNameSql(incidents.reportedByTenantUserId),
      })
      .from(incidents)
      .leftJoin(orgUnits, eq(orgUnits.id, incidents.siteOrgUnitId))
      .where(
        and(
          isNull(incidents.deletedAt),
          eq(incidents.isDraft, false),
          or(
            and(gte(incidents.occurredAt, window.start), lt(incidents.occurredAt, window.end)),
            and(gte(incidents.reportedAt, window.start), lt(incidents.reportedAt, window.end)),
          ),
          vis,
          scope.departmentId ? eq(incidents.departmentId, scope.departmentId) : undefined,
        ),
      )
      .orderBy(asc(incidents.occurredAt))
      .limit(limit + 1)
    const kept = rows.slice(0, limit)
    return {
      truncated: Math.max(0, rows.length - limit),
      records: kept.map((r) => ({
        id: r.id,
        path: `/incidents/${r.id}`,
        date: r.occurredOn,
        title: `${r.reference} · ${r.title}`,
        author: r.reporter,
        department: r.department,
        site: r.site,
        status: ENUM_LABEL(r.status),
        text: [
          `Type: ${ENUM_LABEL(r.type)} · Severity: ${ENUM_LABEL(r.severity)}${r.lostTime ? ' · Lost time' : ''}`,
          boundedText(r.description, 900),
          r.immediateAction ? `Immediate action: ${boundedText(r.immediateAction, 400)}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      })),
      facts: [
        {
          key: 'incidents.count',
          label: 'Incidents',
          value: String(kept.length),
          items: tally(kept.map((r) => ENUM_LABEL(r.severity))),
        },
        ...(kept.some((r) => r.lostTime)
          ? [
              {
                key: 'incidents.lost_time',
                label: 'Lost-time incidents',
                value: String(kept.filter((r) => r.lostTime).length),
              },
            ]
          : []),
      ],
    }
  },
}

// --- Corrective actions ---------------------------------------------------------

export const correctiveActionsSource: BriefSourceDefinition<EmptyParams> = {
  key: 'corrective_actions',
  label: 'Corrective actions',
  description:
    'Corrective actions opened or closed in the window, plus every open action that is now overdue.',
  citationPrefix: 'C',
  params: emptyParams,
  defaultParams: {},
  paramFields: [],
  canRead: (ctx) => readsTier(ctx, 'ca'),
  async collect({ ctx, tx, window, scope, limit }) {
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'ca',
      ownerCols: [correctiveActions.ownerTenantUserId],
      siteCol: correctiveActions.siteOrgUnitId,
    })
    const today = window.lastDay
    const openStatuses = ['open', 'in_progress', 'pending_verification'] as const
    const opened = and(
      gte(correctiveActions.createdAt, window.start),
      lt(correctiveActions.createdAt, window.end),
    )
    const closed = and(
      gte(correctiveActions.closedAt, window.start),
      lt(correctiveActions.closedAt, window.end),
    )
    const overdue = and(
      inArray(correctiveActions.status, [...openStatuses]),
      sql`${correctiveActions.dueOn} <= ${today}`,
    )
    const rows = await tx
      .select({
        id: correctiveActions.id,
        reference: correctiveActions.reference,
        title: correctiveActions.title,
        severity: correctiveActions.severity,
        status: correctiveActions.status,
        dueOn: correctiveActions.dueOn,
        description: correctiveActions.description,
        actionTaken: correctiveActions.actionTaken,
        createdOn: localDateSql(correctiveActions.createdAt, window.timezone),
        closedAt: correctiveActions.closedAt,
        createdAt: correctiveActions.createdAt,
        site: orgUnits.name,
        owner: tenantUserNameSql(correctiveActions.ownerTenantUserId),
        department: departmentNameSql(tenantUserDepartmentSql(correctiveActions.ownerTenantUserId)),
      })
      .from(correctiveActions)
      .leftJoin(orgUnits, eq(orgUnits.id, correctiveActions.siteOrgUnitId))
      .where(
        and(
          isNull(correctiveActions.deletedAt),
          eq(correctiveActions.isDraft, false),
          ne(correctiveActions.status, 'cancelled'),
          or(opened, closed, overdue),
          vis,
          scope.departmentId
            ? sql`${tenantUserDepartmentSql(correctiveActions.ownerTenantUserId)} = ${scope.departmentId}`
            : undefined,
        ),
      )
      .orderBy(desc(correctiveActions.severity), asc(correctiveActions.dueOn))
      .limit(limit + 1)
    const kept = rows.slice(0, limit)
    const inWindow = (d: Date | null) => d !== null && d >= window.start && d < window.end
    const classify = (r: (typeof kept)[number]) =>
      inWindow(r.closedAt)
        ? 'Closed in window'
        : inWindow(r.createdAt)
          ? 'Opened in window'
          : 'Overdue'
    return {
      truncated: Math.max(0, rows.length - limit),
      records: kept.map((r) => ({
        id: r.id,
        path: `/corrective-actions/${r.id}`,
        date: r.createdOn,
        title: `${r.reference} · ${r.title}`,
        author: r.owner,
        department: r.department,
        site: r.site,
        status: `${ENUM_LABEL(r.status)} · ${classify(r)}`,
        text: [
          `Severity: ${ENUM_LABEL(r.severity)}${r.dueOn ? ` · Due ${r.dueOn}` : ''} · ${classify(r)}`,
          boundedText(r.description, 700),
          r.actionTaken ? `Action taken: ${boundedText(r.actionTaken, 400)}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      })),
      facts: [
        {
          key: 'ca.opened',
          label: 'Corrective actions opened',
          value: String(kept.filter((r) => classify(r) === 'Opened in window').length),
        },
        {
          key: 'ca.closed',
          label: 'Corrective actions closed',
          value: String(kept.filter((r) => classify(r) === 'Closed in window').length),
        },
        {
          key: 'ca.overdue',
          label: 'Overdue corrective actions',
          value: String(kept.filter((r) => classify(r) === 'Overdue').length),
        },
      ],
    }
  },
}

// --- Inspections ------------------------------------------------------------------

export const inspectionsSource: BriefSourceDefinition<EmptyParams> = {
  key: 'inspections',
  label: 'Inspections',
  description:
    'Submitted site inspections in the window with every failed item and its non-compliance note.',
  citationPrefix: 'N',
  params: emptyParams,
  defaultParams: {},
  paramFields: [],
  canRead: (ctx) => readsTier(ctx, 'inspections'),
  async collect({ ctx, tx, window, scope, limit }) {
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'inspections',
      ownerCols: [
        inspectionRecords.inspectorTenantUserId,
        inspectionRecords.submittedByTenantUserId,
      ],
      siteCol: inspectionRecords.siteOrgUnitId,
    })
    const rows = await tx
      .select({
        id: inspectionRecords.id,
        reference: inspectionRecords.reference,
        typeName: inspectionTypes.name,
        status: inspectionRecords.status,
        notes: inspectionRecords.notes,
        occurredOn: localDateSql(inspectionRecords.occurredAt, window.timezone),
        site: orgUnits.name,
        inspector: tenantUserNameSql(inspectionRecords.inspectorTenantUserId),
        department: departmentNameSql(
          tenantUserDepartmentSql(inspectionRecords.inspectorTenantUserId),
        ),
        failures: sql<number>`(
          select count(*)::int from inspection_record_criteria bc
          where bc.record_id = ${inspectionRecords.id} and bc.tenant_id = ${inspectionRecords.tenantId}
            and bc.answer = 'fail'
        )`,
      })
      .from(inspectionRecords)
      .leftJoin(inspectionTypes, eq(inspectionTypes.id, inspectionRecords.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, inspectionRecords.siteOrgUnitId))
      .where(
        and(
          isNull(inspectionRecords.deletedAt),
          inArray(inspectionRecords.status, ['submitted', 'closed']),
          gte(inspectionRecords.occurredAt, window.start),
          lt(inspectionRecords.occurredAt, window.end),
          vis,
          scope.departmentId
            ? sql`${tenantUserDepartmentSql(inspectionRecords.inspectorTenantUserId)} = ${scope.departmentId}`
            : undefined,
        ),
      )
      .orderBy(asc(inspectionRecords.occurredAt))
      .limit(limit + 1)
    // Failed inspections first; the writer weighs early records more.
    const kept = rows.slice(0, limit).sort((a, b) => b.failures - a.failures)
    const ids = kept.filter((r) => r.failures > 0).map((r) => r.id)
    const failures = ids.length
      ? await tx
          .select({
            recordId: inspectionRecordCriteria.recordId,
            question: inspectionRecordCriteria.questionTextSnapshot,
            note: inspectionRecordCriteria.nonComplianceDescription,
            severity: inspectionRecordCriteria.severity,
          })
          .from(inspectionRecordCriteria)
          .innerJoin(inspectionRecords, eq(inspectionRecords.id, inspectionRecordCriteria.recordId))
          .where(
            and(
              inArray(inspectionRecordCriteria.recordId, ids),
              eq(inspectionRecordCriteria.answer, 'fail'),
            ),
          )
          .orderBy(asc(inspectionRecordCriteria.sequence))
      : []
    return {
      truncated: Math.max(0, rows.length - limit),
      records: kept.map((r) => {
        const fails = failures.filter((f) => f.recordId === r.id).slice(0, 12)
        return {
          id: r.id,
          path: `/inspections/records/${r.id}`,
          date: r.occurredOn,
          title: `${r.reference} · ${r.typeName ?? 'Inspection'}`,
          author: r.inspector,
          department: r.department,
          site: r.site,
          status: r.failures > 0 ? `${r.failures} failed item(s)` : 'No failures',
          text: [
            r.failures > 0
              ? fails
                  .map(
                    (f) =>
                      `Failed: ${f.question}${f.severity ? ` [${f.severity}]` : ''}${f.note ? ` — ${boundedText(f.note, 200)}` : ''}`,
                  )
                  .join('\n')
              : 'All items passed or not applicable.',
            r.notes ? `Notes: ${boundedText(r.notes, 300)}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
        }
      }),
      facts: [
        { key: 'inspections.count', label: 'Inspections', value: String(kept.length) },
        {
          key: 'inspections.failed',
          label: 'Inspections with failures',
          value: String(kept.filter((r) => r.failures > 0).length),
        },
        {
          key: 'inspections.failed_items',
          label: 'Failed items',
          value: String(kept.reduce((sum, r) => sum + r.failures, 0)),
        },
      ],
    }
  },
}

// --- PPE inspections ------------------------------------------------------------------

export const ppeInspectionsSource: BriefSourceDefinition<EmptyParams> = {
  key: 'ppe_inspections',
  label: 'PPE inspections',
  description:
    'PPE inspections in the window — registered items and other PPE — with failed checks.',
  citationPrefix: 'P',
  params: emptyParams,
  defaultParams: {},
  paramFields: [],
  canRead: (ctx) => ctx.isSuperAdmin || can(ctx, 'ppe.read.all') || can(ctx, 'ppe.manage'),
  async collect({ tx, window, scope, limit }) {
    const rows = await tx
      .select({
        id: ppeInspections.id,
        kind: ppeInspections.kind,
        result: ppeInspections.result,
        isOther: ppeInspections.isOther,
        serial: sql<
          string | null
        >`coalesce(${ppeItems.serialNumber}, ${ppeInspections.serialNumber})`,
        suppliedBy: ppeInspections.suppliedBy,
        inspectedOn: ppeInspections.inspectedOn,
        notes: ppeInspections.notes,
        typeName: ppeTypes.name,
        inspector: ppeInspections.inspectorNameSnapshot,
        site: siteNameSql(ppeInspections.siteOrgUnitId),
        department: departmentNameSql(
          tenantUserDepartmentSql(ppeInspections.inspectedByTenantUserId),
        ),
      })
      .from(ppeInspections)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeInspections.typeId))
      .leftJoin(ppeItems, eq(ppeItems.id, ppeInspections.itemId))
      .where(
        and(
          eq(ppeInspections.status, 'submitted'),
          gte(ppeInspections.inspectedOn, window.firstDay),
          sql`${ppeInspections.inspectedOn} <= ${window.lastDay}`,
          scope.departmentId
            ? sql`${tenantUserDepartmentSql(ppeInspections.inspectedByTenantUserId)} = ${scope.departmentId}`
            : undefined,
        ),
      )
      .orderBy(desc(sql`${ppeInspections.result} = 'fail'`), asc(ppeInspections.inspectedOn))
      .limit(limit + 1)
    const kept = rows.slice(0, limit)
    const failedIds = kept.filter((r) => r.result === 'fail').map((r) => r.id)
    const failures = failedIds.length
      ? await tx
          .select({
            inspectionId: ppeInspectionCriteria.inspectionId,
            question: ppeInspectionCriteria.questionTextSnapshot,
            reason: ppeInspectionCriteria.nonComplianceReason,
          })
          .from(ppeInspectionCriteria)
          .innerJoin(ppeInspections, eq(ppeInspections.id, ppeInspectionCriteria.inspectionId))
          .where(
            and(
              inArray(ppeInspectionCriteria.inspectionId, failedIds),
              eq(ppeInspectionCriteria.answer, 'fail'),
            ),
          )
      : []
    return {
      truncated: Math.max(0, rows.length - limit),
      records: kept.map((r) => ({
        id: r.id,
        path: `/ppe?drawer=inspection&inspectionId=${r.id}`,
        date: r.inspectedOn ?? window.lastDay,
        title: `${r.typeName}${r.serial ? ` · ${r.serial}` : ''}${r.isOther ? ' (other PPE)' : ''}`,
        author: r.inspector,
        department: r.department,
        site: r.site,
        status: ENUM_LABEL(r.result),
        text: [
          `${r.kind === 'annual' ? 'Annual' : 'Pre-use'} inspection · Result: ${ENUM_LABEL(r.result)}${r.suppliedBy ? ` · Supplied by ${r.suppliedBy}` : ''}`,
          ...failures
            .filter((f) => f.inspectionId === r.id)
            .slice(0, 8)
            .map(
              (f) => `Failed: ${f.question}${f.reason ? ` — ${boundedText(f.reason, 200)}` : ''}`,
            ),
          r.notes ? `Notes: ${boundedText(r.notes, 300)}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      })),
      facts: [
        { key: 'ppe.inspections', label: 'PPE inspections', value: String(kept.length) },
        {
          key: 'ppe.failed',
          label: 'Failed PPE inspections',
          value: String(kept.filter((r) => r.result === 'fail').length),
        },
        ...(kept.some((r) => r.isOther)
          ? [
              {
                key: 'ppe.other',
                label: 'Other PPE inspected',
                value: String(kept.filter((r) => r.isOther).length),
              },
            ]
          : []),
      ],
    }
  },
}

// --- Hazard assessments ----------------------------------------------------------------

export const hazardAssessmentsSource: BriefSourceDefinition<EmptyParams> = {
  key: 'hazard_assessments',
  label: 'Hazard assessments',
  description: 'Hazard assessments carried out in the window, with job scope and review status.',
  citationPrefix: 'H',
  params: emptyParams,
  defaultParams: {},
  paramFields: [],
  canRead: (ctx) => readsTier(ctx, 'hazid'),
  async collect({ ctx, tx, window, scope, limit }) {
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'hazid',
      ownerCols: [hazidAssessments.reportedByTenantUserId, hazidAssessments.supervisorTenantUserId],
      siteCol: hazidAssessments.siteOrgUnitId,
    })
    const rows = await tx
      .select({
        id: hazidAssessments.id,
        reference: hazidAssessments.reference,
        jobScope: hazidAssessments.jobScope,
        reviewStatus: hazidAssessments.reviewStatus,
        inProgress: hazidAssessments.inProgress,
        occurredOn: localDateSql(hazidAssessments.occurredAt, window.timezone),
        typeName: hazidAssessmentTypes.name,
        site: orgUnits.name,
        reporter: tenantUserNameSql(hazidAssessments.reportedByTenantUserId),
        department: departmentNameSql(
          tenantUserDepartmentSql(hazidAssessments.reportedByTenantUserId),
        ),
      })
      .from(hazidAssessments)
      .leftJoin(
        hazidAssessmentTypes,
        eq(hazidAssessmentTypes.id, hazidAssessments.assessmentTypeId),
      )
      .leftJoin(orgUnits, eq(orgUnits.id, hazidAssessments.siteOrgUnitId))
      .where(
        and(
          isNull(hazidAssessments.deletedAt),
          gte(hazidAssessments.occurredAt, window.start),
          lt(hazidAssessments.occurredAt, window.end),
          vis,
          scope.departmentId
            ? sql`${tenantUserDepartmentSql(hazidAssessments.reportedByTenantUserId)} = ${scope.departmentId}`
            : undefined,
        ),
      )
      .orderBy(asc(hazidAssessments.occurredAt))
      .limit(limit + 1)
    const kept = rows.slice(0, limit)
    return {
      truncated: Math.max(0, rows.length - limit),
      records: kept.map((r) => ({
        id: r.id,
        path: `/hazard-assessments/${r.id}`,
        date: r.occurredOn,
        title: `${r.reference} · ${r.typeName ?? 'Hazard assessment'}`,
        author: r.reporter,
        department: r.department,
        site: r.site,
        status: r.inProgress ? 'In progress' : ENUM_LABEL(r.reviewStatus),
        text: r.jobScope ? `Job scope: ${boundedText(r.jobScope, 600)}` : 'No job scope recorded.',
      })),
      facts: [
        { key: 'hazid.count', label: 'Hazard assessments', value: String(kept.length) },
        {
          key: 'hazid.pending_review',
          label: 'Awaiting review',
          value: String(kept.filter((r) => r.reviewStatus === 'pending' && !r.inProgress).length),
        },
      ],
    }
  },
}

// --- Equipment work orders ------------------------------------------------------------

export const workOrdersSource: BriefSourceDefinition<EmptyParams> = {
  key: 'equipment_work_orders',
  label: 'Equipment work orders',
  description: 'Work orders opened or closed in the window, plus open high-priority orders.',
  citationPrefix: 'W',
  params: emptyParams,
  defaultParams: {},
  paramFields: [],
  canRead: (ctx) => readsTier(ctx, 'equipment'),
  async collect({ ctx, tx, window, scope, limit }) {
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'equipment',
      ownerCols: [
        equipmentWorkOrders.openedByTenantUserId,
        equipmentWorkOrders.assignedToTenantUserId,
      ],
      siteCol: equipmentItems.currentSiteOrgUnitId,
    })
    const rows = await tx
      .select({
        id: equipmentWorkOrders.id,
        reference: equipmentWorkOrders.reference,
        summary: equipmentWorkOrders.summary,
        description: equipmentWorkOrders.description,
        actionTaken: equipmentWorkOrders.actionTaken,
        status: equipmentWorkOrders.status,
        priority: equipmentWorkOrders.priority,
        openedAt: equipmentWorkOrders.openedAt,
        closedAt: equipmentWorkOrders.closedAt,
        openedOn: localDateSql(equipmentWorkOrders.openedAt, window.timezone),
        itemName: equipmentItems.name,
        itemTag: equipmentItems.assetTag,
        site: siteNameSql(equipmentItems.currentSiteOrgUnitId),
        assignee: tenantUserNameSql(equipmentWorkOrders.assignedToTenantUserId),
        department: departmentNameSql(
          tenantUserDepartmentSql(equipmentWorkOrders.assignedToTenantUserId),
        ),
      })
      .from(equipmentWorkOrders)
      .innerJoin(equipmentItems, eq(equipmentItems.id, equipmentWorkOrders.itemId))
      .where(
        and(
          isNull(equipmentWorkOrders.deletedAt),
          or(
            and(
              gte(equipmentWorkOrders.openedAt, window.start),
              lt(equipmentWorkOrders.openedAt, window.end),
            ),
            and(
              gte(equipmentWorkOrders.closedAt, window.start),
              lt(equipmentWorkOrders.closedAt, window.end),
            ),
            and(
              eq(equipmentWorkOrders.priority, 'high'),
              notInArray(equipmentWorkOrders.status, [
                'repaired',
                'verified',
                'closed',
                'cancelled',
              ]),
            ),
          ),
          vis,
          scope.departmentId
            ? sql`${tenantUserDepartmentSql(equipmentWorkOrders.assignedToTenantUserId)} = ${scope.departmentId}`
            : undefined,
        ),
      )
      .orderBy(desc(equipmentWorkOrders.priority), asc(equipmentWorkOrders.openedAt))
      .limit(limit + 1)
    const kept = rows.slice(0, limit)
    const inWindow = (d: Date | null) => d !== null && d >= window.start && d < window.end
    return {
      truncated: Math.max(0, rows.length - limit),
      records: kept.map((r) => ({
        id: r.id,
        path: `/equipment/work-orders/${r.id}`,
        date: r.openedOn,
        title: `${r.reference} · ${r.itemTag} ${r.itemName} — ${r.summary}`,
        author: r.assignee,
        department: r.department,
        site: r.site,
        status: `${ENUM_LABEL(r.status)} · ${ENUM_LABEL(r.priority)} priority`,
        text: [
          inWindow(r.closedAt)
            ? 'Closed in window'
            : inWindow(r.openedAt)
              ? 'Opened in window'
              : 'Open, high priority',
          boundedText(r.description, 500),
          r.actionTaken ? `Action taken: ${boundedText(r.actionTaken, 300)}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      })),
      facts: [
        {
          key: 'work_orders.opened',
          label: 'Work orders opened',
          value: String(kept.filter((r) => inWindow(r.openedAt)).length),
        },
        {
          key: 'work_orders.closed',
          label: 'Work orders closed',
          value: String(kept.filter((r) => inWindow(r.closedAt)).length),
        },
      ],
    }
  },
}
