import 'server-only'

// Incidents FlowSubjectAdapter. Field-map keys mirror MODULE_FLOW_PROFILES.incidents.

import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  attachments,
  departments,
  incidentAttachments,
  incidentClassifications,
  incidentContributingFactors,
  incidentEvents,
  incidentInjuries,
  incidentInjuryTypeAssignments,
  incidentInjuryTypes,
  incidentLostTimeEvents,
  incidentPeople,
  incidentPreventativeSteps,
  incidents,
  orgUnits,
  people,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { presignGet } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { spawnCorrectiveActionForSubject } from '../spawn'
import { fmtDate, fmtDateTime, personName, titleize } from '../format'
import type { FlowSubjectAdapter } from '../types'

export function createIncidentFlowAdapter(
  ctx: RequestContext,
  incidentId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'incidents',
    subjectId: incidentId,
    notifyCategory: 'incident',
    auditEntityType: 'incident',
    deepLink: () => `/incidents/${incidentId}`,
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId: ctx.tenantId,
        subjectId: incidentId,
        entityType: 'incident',
        heading: 'Incident report',
        reference: values.reference,
        subtitle: values.title,
        values,
      }),

    async loadValues() {
      const [head] = await ctx.db((tx) =>
        tx
          .select({
            i: incidents,
            siteName: orgUnits.name,
            deptName: departments.name,
            supFirst: people.firstName,
            supLast: people.lastName,
            supFormal: people.formalName,
            reportedByName: users.name,
            classificationName: incidentClassifications.name,
            classificationCode: incidentClassifications.code,
          })
          .from(incidents)
          .leftJoin(orgUnits, eq(orgUnits.id, incidents.siteOrgUnitId))
          .leftJoin(departments, eq(departments.id, incidents.departmentId))
          .leftJoin(people, eq(people.id, incidents.supervisorPersonId))
          .leftJoin(tenantUsers, eq(tenantUsers.id, incidents.reportedByTenantUserId))
          .leftJoin(users, eq(users.id, tenantUsers.userId))
          .leftJoin(
            incidentClassifications,
            eq(incidentClassifications.id, incidents.classificationId),
          )
          .where(eq(incidents.id, incidentId))
          .limit(1),
      )
      if (!head) return {}
      const i = head.i

      const [peopleInvolved, injuries, lostTimeEvents, events, factors, steps, photos] =
        await Promise.all([
          ctx.db((tx) =>
            tx
              .select({
                role: incidentPeople.role,
                personId: incidentPeople.personId,
                nameText: incidentPeople.personNameText,
                pFirst: people.firstName,
                pLast: people.lastName,
                pFormal: people.formalName,
              })
              .from(incidentPeople)
              .leftJoin(people, eq(people.id, incidentPeople.personId))
              .where(eq(incidentPeople.incidentId, incidentId)),
          ),
          ctx.db(async (tx) => {
            const rows = await tx
              .select({
                row: incidentInjuries,
                pFirst: people.firstName,
                pLast: people.lastName,
                pFormal: people.formalName,
              })
              .from(incidentInjuries)
              .leftJoin(people, eq(people.id, incidentInjuries.personId))
              .where(eq(incidentInjuries.incidentId, incidentId))
            const injuryIds = rows.map((row) => row.row.id)
            const assignmentRows =
              injuryIds.length === 0
                ? []
                : await tx
                    .select({
                      injuryId: incidentInjuryTypeAssignments.injuryId,
                      name: incidentInjuryTypes.name,
                    })
                    .from(incidentInjuryTypeAssignments)
                    .innerJoin(
                      incidentInjuryTypes,
                      and(
                        eq(incidentInjuryTypes.tenantId, incidentInjuryTypeAssignments.tenantId),
                        eq(incidentInjuryTypes.id, incidentInjuryTypeAssignments.injuryTypeId),
                      ),
                    )
                    .where(inArray(incidentInjuryTypeAssignments.injuryId, injuryIds))
                    .orderBy(asc(incidentInjuryTypes.sortOrder), asc(incidentInjuryTypes.name))
            const typeNamesByInjury = new Map<string, string[]>()
            for (const assignment of assignmentRows) {
              const names = typeNamesByInjury.get(assignment.injuryId) ?? []
              names.push(assignment.name)
              typeNamesByInjury.set(assignment.injuryId, names)
            }
            return rows.map((row) => ({
              ...row,
              injuryTypeNames: typeNamesByInjury.get(row.row.id) ?? [],
            }))
          }),
          ctx.db((tx) =>
            tx
              .select({
                status: incidentLostTimeEvents.status,
                validFrom: incidentLostTimeEvents.validFrom,
                validTo: incidentLostTimeEvents.validTo,
                notes: incidentLostTimeEvents.notes,
              })
              .from(incidentLostTimeEvents)
              .where(eq(incidentLostTimeEvents.incidentId, incidentId))
              .orderBy(asc(incidentLostTimeEvents.validFrom)),
          ),
          ctx.db((tx) =>
            tx
              .select({
                occurredAt: incidentEvents.occurredAt,
                description: incidentEvents.description,
                byName: users.name,
              })
              .from(incidentEvents)
              .leftJoin(tenantUsers, eq(tenantUsers.id, incidentEvents.recordedByTenantUserId))
              .leftJoin(users, eq(users.id, tenantUsers.userId))
              .where(eq(incidentEvents.incidentId, incidentId))
              .orderBy(asc(incidentEvents.occurredAt)),
          ),
          ctx.db((tx) =>
            tx
              .select({
                category: incidentContributingFactors.category,
                description: incidentContributingFactors.description,
              })
              .from(incidentContributingFactors)
              .where(eq(incidentContributingFactors.incidentId, incidentId)),
          ),
          ctx.db((tx) =>
            tx
              .select({
                description: incidentPreventativeSteps.description,
                targetDate: incidentPreventativeSteps.targetDate,
                status: incidentPreventativeSteps.status,
                pFirst: people.firstName,
                pLast: people.lastName,
                pFormal: people.formalName,
              })
              .from(incidentPreventativeSteps)
              .leftJoin(people, eq(people.id, incidentPreventativeSteps.ownerPersonId))
              .where(eq(incidentPreventativeSteps.incidentId, incidentId)),
          ),
          ctx.db((tx) =>
            tx
              .select({ caption: incidentAttachments.caption, r2Key: attachments.r2Key })
              .from(incidentAttachments)
              .innerJoin(attachments, eq(attachments.id, incidentAttachments.attachmentId))
              .where(eq(incidentAttachments.incidentId, incidentId)),
          ),
        ])

      return {
        status: i.status ?? null,
        status_label: titleize(i.status),
        reference: i.reference ?? null,
        title: i.title ?? null,
        type: i.type ?? null,
        type_label: titleize(i.type),
        severity: i.severity ?? null,
        severity_label: titleize(i.severity),
        occurred_at: fmtDateTime(i.occurredAt),
        reported_at: fmtDateTime(i.reportedAt),
        closed_at: fmtDateTime(i.closedAt),
        location: i.location ?? '',
        weather: i.weather ?? '',
        description: i.description ?? '',
        events_leading_up: i.eventsLeadingUp ?? '',
        immediate_action_taken: i.immediateActionTaken ?? '',
        ppe_worn: i.ppeWorn ?? '',
        root_cause: i.rootCause ?? '',
        foreman_text: i.foremanText ?? '',
        external_people_involved: i.externalPeopleInvolved ?? '',
        witnesses: i.witnesses ?? '',
        classification_labels: head.classificationName
          ? [head.classificationCode, head.classificationName].filter(Boolean).join(' — ')
          : '',
        // Medical / regulatory flags — raw booleans so templates can gate
        // sections with {{#if …}} (falsy = false, per the block engine).
        critical_injury: i.criticalInjury ?? false,
        ministry_of_labour_notified: i.ministryOfLabourNotified ?? false,
        ems_notified: i.emsCalled ?? false,
        first_aid_received: i.firstAidGiven ?? false,
        first_aid_provider: i.firstAidProvider ?? '',
        medical_attention_received: i.medicalAttentionReceived ?? false,
        treated_at_hospital: i.hospitalName ?? '',
        treated_in_city: i.treatedInCity ?? '',
        transportation: i.transportation ?? '',
        lost_time: i.lostTime ?? false,
        lost_time_first_day: fmtDate(i.lostTimeFirstDay),
        lost_time_last_day: fmtDate(i.lostTimeLastDay),
        lost_time_days: i.lostTimeDays ?? null,
        modified_duty: i.modifiedDuty ?? false,
        modified_duty_first_day: fmtDate(i.modifiedDutyFirstDay),
        modified_duty_last_day: fmtDate(i.modifiedDutyLastDay),
        modified_duty_days: i.modifiedDutyDays ?? null,
        externally_reportable: i.externallyReportable ?? false,
        // Key metrics (1–5 scales).
        actual_severity: i.actualSeverity ?? null,
        potential_severity: i.potentialSeverity ?? null,
        site_name: head.siteName ?? '',
        department_name: head.deptName ?? '',
        supervisor_name: personName({
          firstName: head.supFirst,
          lastName: head.supLast,
          formalName: head.supFormal,
        }),
        reported_by_name: head.reportedByName ?? '',
        // FK ids for conditions / recipient `field` targets.
        site_org_unit_id: i.siteOrgUnitId ?? null,
        department_id: i.departmentId ?? null,
        supervisor_person_id: i.supervisorPersonId ?? null,
        people_involved_person_ids: peopleInvolved
          .map((person) => person.personId)
          .filter((personId): personId is string => Boolean(personId))
          .join(','),
        // Collections.
        people_involved: peopleInvolved.map((p) => ({
          person_id: p.personId ?? '',
          name:
            personName({ firstName: p.pFirst, lastName: p.pLast, formalName: p.pFormal }) ||
            p.nameText ||
            'Unknown',
          role: titleize(p.role),
        })),
        injuries: injuries.map((r) => ({
          person_name:
            personName({ firstName: r.pFirst, lastName: r.pLast, formalName: r.pFormal }) ||
            r.row.personName ||
            'Unknown',
          body_parts: (r.row.bodyParts ?? []).join(', '),
          injury_types: r.injuryTypeNames.join(', '),
          injury_result: r.row.injuryResult ?? '',
          treatment: r.row.treatment ?? '',
          treated_at_facility: r.row.treatedAtFacility ?? '',
          worked_hours_prior_to: r.row.workedHoursPriorTo ?? '',
        })),
        lost_time_events: lostTimeEvents.map((e) => ({
          status: titleize(e.status),
          valid_from: fmtDate(e.validFrom),
          valid_to: fmtDate(e.validTo),
          notes: e.notes ?? '',
        })),
        events: events.map((e) => ({
          occurred_at: fmtDateTime(e.occurredAt),
          description: e.description ?? '',
          recorded_by_name: e.byName ?? '',
        })),
        contributing_factors: factors.map((f) => ({
          category: titleize(f.category),
          description: f.description ?? '',
        })),
        preventative_steps: steps.map((s) => ({
          description: s.description ?? '',
          owner_name: personName({
            firstName: s.pFirst,
            lastName: s.pLast,
            formalName: s.pFormal,
          }),
          target_date: fmtDate(s.targetDate),
          status: titleize(s.status),
        })),
        photos: await Promise.all(
          photos.map(async (p) => ({
            url: await presignGet({ key: p.r2Key, expiresInSeconds: 900 }),
            caption: p.caption ?? '',
          })),
        ),
      }
    },

    async resolveSubmitter() {
      const [i] = await ctx.db((tx) =>
        tx
          .select({ tuid: incidents.reportedByTenantUserId })
          .from(incidents)
          .where(eq(incidents.id, incidentId))
          .limit(1),
      )
      const tuid = i?.tuid ?? null
      let email: string | null = null
      let userId: string | null = null
      if (tuid) {
        const [u] = await ctx.db((tx) =>
          tx
            .select({ email: users.email, userId: users.id })
            .from(tenantUsers)
            .innerJoin(users, eq(users.id, tenantUsers.userId))
            .where(eq(tenantUsers.id, tuid))
            .limit(1),
        )
        email = u?.email ?? null
        userId = u?.userId ?? null
      }
      return { tenantUserId: tuid, email, userId }
    },

    spawnCorrectiveAction: (i) =>
      spawnCorrectiveActionForSubject(ctx, {
        sourceEntityType: 'incident',
        sourceEntityId: incidentId,
        source: 'incident',
        title: i.title,
        description: i.description ?? null,
        severity: i.severity,
        dueOn: i.dueOn ?? null,
        flowExecutionKey: i.flowExecutionKey,
      }),
  }
}
