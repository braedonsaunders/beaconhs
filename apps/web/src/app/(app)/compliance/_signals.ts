// Cross-module "due & expiring" signals — Milestone 1.5.
//
// The unified hub's CREATE form only handles audience-on-cadence assignments
// (the 5 kinds). But compliance across the platform is mostly a DIFFERENT shape:
// per-record expiries (certs, permits, equipment/PPE due dates), recurring
// per-record check-ins (lone worker), document review cadence, and single-owner
// tasks (corrective actions, work orders, incident preventative steps).
//
// This aggregator READS those signals from each module's own tables and projects
// them into one row shape so the hub can show "everything that needs attention
// across the whole platform" in one place. It is the read-path preview of the
// M3 per-record/expiry completion adapters — when those land, this becomes a
// single query over `compliance_status`.

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'
import {
  correctiveActions,
  documents,
  equipmentItems,
  equipmentWorkOrders,
  incidentPreventativeSteps,
  formResponses,
  people,
  ppeItems,
  ppeTypes,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { latestTrainingRecordOnly } from '@/lib/training-latest'

export type SignalStatus = 'overdue' | 'expired' | 'due_soon' | 'open'

export type SignalModule =
  | 'training'
  | 'monitored_session'
  | 'documents'
  | 'equipment'
  | 'ppe'
  | 'corrective_actions'
  | 'incidents'

export const SIGNAL_MODULE_LABELS: Record<SignalModule, string> = {
  training: 'Training',
  monitored_session: 'Monitored sessions',
  documents: 'Documents',
  equipment: 'Equipment',
  ppe: 'PPE',
  corrective_actions: 'Corrective actions',
  incidents: 'Incidents',
}

export type ComplianceSignal = {
  module: SignalModule
  family: string
  subject: string
  personName: string | null
  personId: string | null
  dueOn: string | null
  status: SignalStatus
  href: string | null
}

const HORIZON_DAYS = 30

function isoDate(d: string | Date | null): string | null {
  if (!d) return null
  if (typeof d === 'string') return d.slice(0, 10)
  return d.toISOString().slice(0, 10)
}

function pname(first: string | null, last: string | null): string | null {
  const n = `${last ?? ''}${last && first ? ', ' : ''}${first ?? ''}`.trim()
  return n || null
}

function dueStatus(dueIso: string | null, today: string, expiry: boolean): SignalStatus {
  if (!dueIso) return 'open'
  if (dueIso < today) return expiry ? 'expired' : 'overdue'
  return 'due_soon'
}

const RANK: Record<SignalStatus, number> = { overdue: 0, expired: 1, due_soon: 2, open: 3 }

/**
 * Every due / expiring / overdue / open-task compliance signal across modules,
 * within the horizon (or already past).
 */
export async function listDueSignals(ctx: RequestContext): Promise<ComplianceSignal[]> {
  const tid = ctx.tenantId!
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const horizonDate = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000)
  const horizonIso = horizonDate.toISOString().slice(0, 10)

  return ctx.db(async (tx) => {
    const out: ComplianceSignal[] = []

    // ---- Training: certification expiry ----
    {
      // Certs belong to a person, so only ACTIVE people count — a terminated
      // employee's expired tickets aren't outstanding compliance work (same
      // rule as the audience resolver, dashboards, and report_training_matrix).
      // Only the person's LATEST record per course counts: retraining creates
      // a new record, and the superseded ones must not surface as expired.
      const rows = await tx
        .select({
          id: trainingRecords.id,
          personId: trainingRecords.personId,
          first: people.firstName,
          last: people.lastName,
          course: trainingCourses.name,
          expiresOn: trainingRecords.expiresOn,
        })
        .from(trainingRecords)
        .innerJoin(people, eq(people.id, trainingRecords.personId))
        .leftJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
        .where(
          and(
            eq(trainingRecords.tenantId, tid),
            isNull(trainingRecords.deletedAt),
            isNotNull(trainingRecords.expiresOn),
            lte(trainingRecords.expiresOn, horizonIso),
            eq(people.status, 'active'),
            isNull(people.deletedAt),
            latestTrainingRecordOnly(),
          ),
        )
        // Soonest expiry first so the cap keeps the most overdue rows when a
        // tenant has more than 1000 expiring certs.
        .orderBy(asc(trainingRecords.expiresOn))
        .limit(1000)
      for (const r of rows) {
        const due = isoDate(r.expiresOn)
        out.push({
          module: 'training',
          family: 'Certification expiry',
          subject: r.course ?? 'Certification',
          personName: pname(r.first, r.last),
          personId: r.personId,
          dueOn: due,
          status: dueStatus(due, today, true),
          href: '/training',
        })
      }
    }

    // ---- Monitored sessions: overdue check-ins (any monitored Builder app) ----
    {
      const rows = await tx
        .select({
          id: formResponses.id,
          status: formResponses.monitorStatus,
          nextCheckinDueAt: formResponses.nextCheckinDueAt,
        })
        .from(formResponses)
        .where(
          and(
            eq(formResponses.tenantId, tid),
            inArray(formResponses.monitorStatus, ['active', 'missed', 'escalated']),
            lte(formResponses.nextCheckinDueAt, horizonDate),
          ),
        )
        .limit(500)
      for (const r of rows) {
        const due = isoDate(r.nextCheckinDueAt)
        const overdue =
          r.status === 'missed' || r.status === 'escalated' || (due != null && due < today)
        out.push({
          module: 'monitored_session',
          family: 'Check-in',
          subject: 'Monitored session check-in',
          personName: null,
          personId: null,
          dueOn: due,
          status: overdue ? 'overdue' : 'due_soon',
          href: '/apps/sessions',
        })
      }
    }

    // ---- Documents: review cadence due ----
    {
      const rows = await tx
        .select({ id: documents.id, title: documents.title, nextReviewOn: documents.nextReviewOn })
        .from(documents)
        .where(
          and(
            eq(documents.tenantId, tid),
            isNull(documents.deletedAt),
            inArray(documents.status, ['draft', 'published', 'under_review']),
            isNotNull(documents.nextReviewOn),
            lte(documents.nextReviewOn, horizonIso),
          ),
        )
        .limit(500)
      for (const r of rows) {
        const due = isoDate(r.nextReviewOn)
        out.push({
          module: 'documents',
          family: 'Review due',
          subject: r.title,
          personName: null,
          personId: null,
          dueOn: due,
          status: dueStatus(due, today, false),
          href: `/documents/${r.id}`,
        })
      }
    }

    // ---- Equipment: scheduled inspection / oil change / warranty ----
    {
      // Soonest next_due_on across the item's ACTIVE recurring inspection
      // schedules; items with no active schedule have nothing due.
      const nextInspectionDue = sql<string | null>`(
        select min(s.next_due_on)
        from equipment_inspection_schedules s
        where s.equipment_item_id = ${equipmentItems.id}
          and s.tenant_id = ${equipmentItems.tenantId}
          and s.is_active = true
      )`
      const rows = await tx
        .select({
          id: equipmentItems.id,
          name: equipmentItems.name,
          assetTag: equipmentItems.assetTag,
          holder: equipmentItems.currentHolderPersonId,
          first: people.firstName,
          last: people.lastName,
          inspection: nextInspectionDue,
          oil: equipmentItems.nextOilChangeDue,
          warranty: equipmentItems.warrantyExpiresOn,
        })
        .from(equipmentItems)
        .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
        .where(
          and(
            eq(equipmentItems.tenantId, tid),
            isNull(equipmentItems.deletedAt),
            notInArray(equipmentItems.status, ['retired', 'lost']),
            or(
              sql`${nextInspectionDue} <= ${horizonIso}`,
              lte(equipmentItems.nextOilChangeDue, horizonIso),
              lte(equipmentItems.warrantyExpiresOn, horizonIso),
            ),
          ),
        )
        .limit(1000)
      for (const r of rows) {
        const label = `${r.name} (${r.assetTag})`
        const person = pname(r.first, r.last)
        const push = (family: string, d: string | null, expiry: boolean) => {
          if (!d || d > horizonIso) return
          out.push({
            module: 'equipment',
            family,
            subject: label,
            personName: person,
            personId: r.holder,
            dueOn: d,
            status: dueStatus(d, today, expiry),
            href: `/equipment/${r.id}`,
          })
        }
        push('Inspection', isoDate(r.inspection), false)
        push('Oil change', isoDate(r.oil), false)
        push('Warranty', isoDate(r.warranty), true)
      }
    }

    // ---- PPE: inspection / annual / expiry ----
    {
      const rows = await tx
        .select({
          id: ppeItems.id,
          serial: ppeItems.serialNumber,
          type: ppeTypes.name,
          holder: ppeItems.currentHolderPersonId,
          first: people.firstName,
          last: people.lastName,
          inspection: ppeItems.nextInspectionDue,
          annual: ppeItems.nextAnnualInspectionDue,
          expiresOn: ppeItems.expiresOn,
        })
        .from(ppeItems)
        .leftJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
        .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
        .where(
          and(
            eq(ppeItems.tenantId, tid),
            isNull(ppeItems.deletedAt),
            notInArray(ppeItems.status, ['discarded', 'expired']),
            or(
              lte(ppeItems.nextInspectionDue, horizonIso),
              lte(ppeItems.nextAnnualInspectionDue, horizonIso),
              lte(ppeItems.expiresOn, horizonIso),
            ),
          ),
        )
        .limit(1000)
      for (const r of rows) {
        const label = `${r.type ?? 'PPE'}${r.serial ? ` · ${r.serial}` : ''}`
        const person = pname(r.first, r.last)
        const push = (family: string, d: string | null, expiry: boolean) => {
          if (!d || d > horizonIso) return
          out.push({
            module: 'ppe',
            family,
            subject: label,
            personName: person,
            personId: r.holder,
            dueOn: d,
            status: dueStatus(d, today, expiry),
            href: '/ppe',
          })
        }
        push('Inspection', isoDate(r.inspection), false)
        push('Annual inspection', isoDate(r.annual), false)
        push('Expiry', isoDate(r.expiresOn), true)
      }
    }

    // ---- Corrective actions: due / overdue (owner is a tenant-user; person omitted) ----
    {
      const rows = await tx
        .select({
          id: correctiveActions.id,
          reference: correctiveActions.reference,
          title: correctiveActions.title,
          dueOn: correctiveActions.dueOn,
          status: correctiveActions.status,
        })
        .from(correctiveActions)
        .where(
          and(
            eq(correctiveActions.tenantId, tid),
            isNull(correctiveActions.deletedAt),
            inArray(correctiveActions.status, ['open', 'in_progress', 'pending_verification']),
            isNotNull(correctiveActions.dueOn),
            lte(correctiveActions.dueOn, horizonIso),
          ),
        )
        .limit(500)
      for (const r of rows) {
        const due = isoDate(r.dueOn)
        out.push({
          module: 'corrective_actions',
          family: 'Corrective action',
          subject: `${r.reference} — ${r.title}`,
          personName: null,
          personId: null,
          dueOn: due,
          status: dueStatus(due, today, false),
          href: `/corrective-actions/${r.id}`,
        })
      }
    }

    // ---- Incidents: preventative steps with a target date ----
    {
      const rows = await tx
        .select({
          incidentId: incidentPreventativeSteps.incidentId,
          ownerPersonId: incidentPreventativeSteps.ownerPersonId,
          first: people.firstName,
          last: people.lastName,
          targetDate: incidentPreventativeSteps.targetDate,
          status: incidentPreventativeSteps.status,
        })
        .from(incidentPreventativeSteps)
        .leftJoin(people, eq(people.id, incidentPreventativeSteps.ownerPersonId))
        .where(
          and(
            eq(incidentPreventativeSteps.tenantId, tid),
            inArray(incidentPreventativeSteps.status, ['planned', 'in_progress']),
            isNotNull(incidentPreventativeSteps.targetDate),
            lte(incidentPreventativeSteps.targetDate, horizonIso),
          ),
        )
        .limit(500)
      for (const r of rows) {
        const due = isoDate(r.targetDate)
        out.push({
          module: 'incidents',
          family: 'Preventative action',
          subject: 'Preventative action',
          personName: pname(r.first, r.last),
          personId: r.ownerPersonId,
          dueOn: due,
          status: dueStatus(due, today, false),
          href: `/incidents/${r.incidentId}`,
        })
      }
    }

    // ---- Equipment work orders: open (no due date → task) ----
    {
      const rows = await tx
        .select({
          id: equipmentWorkOrders.id,
          reference: equipmentWorkOrders.reference,
          equipmentId: equipmentWorkOrders.itemId,
          equipName: equipmentItems.name,
          status: equipmentWorkOrders.status,
        })
        .from(equipmentWorkOrders)
        .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentWorkOrders.itemId))
        .where(
          and(
            eq(equipmentWorkOrders.tenantId, tid),
            inArray(equipmentWorkOrders.status, [
              'open',
              'assigned',
              'in_progress',
              'awaiting_parts',
            ]),
          ),
        )
        .orderBy(desc(equipmentWorkOrders.openedAt))
        .limit(300)
      for (const r of rows) {
        out.push({
          module: 'equipment',
          family: 'Work order',
          subject: `${r.reference}${r.equipName ? ` — ${r.equipName}` : ''}`,
          personName: null,
          personId: null,
          dueOn: null,
          status: 'open',
          href: r.equipmentId ? `/equipment/${r.equipmentId}` : '/equipment',
        })
      }
    }

    // Sort: worst first (overdue → expired → due soon → open), then soonest due.
    out.sort(
      (a, b) =>
        RANK[a.status] - RANK[b.status] ||
        (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') ||
        a.subject.localeCompare(b.subject),
    )
    return out
  })
}
