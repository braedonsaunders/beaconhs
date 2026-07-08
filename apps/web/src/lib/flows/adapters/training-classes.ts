import 'server-only'

// Training CLASS FlowSubjectAdapter — subject = one training_classes row (a
// scheduled instructor-led session). Distinct from the 'training' subject,
// which is an assessment attempt. Covers the legacy class-lifecycle emails:
// class scheduled, class cancelled, attendance missed, training completed.
//
// training_classes has no status column — the lifecycle is derived from
// cancelled_at / completed_at (scheduled → cancelled | completed), and the
// module actions fire status_change with that derived value.
//
// `attendee_emails` is a comma-separated string field so a flow can email the
// whole roster via a recipient `field` target. Field-map keys mirror
// MODULE_FLOW_PROFILES['training-classes'].

import { asc, eq } from 'drizzle-orm'
import {
  orgUnits,
  people,
  tenantUsers,
  trainingClassAttendees,
  trainingClasses,
  trainingCourses,
  users,
} from '@beaconhs/db/schema'
import { alias } from 'drizzle-orm/pg-core'
import type { RequestContext } from '@beaconhs/tenant'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { fmtDateTime, personName, titleize } from '../format'
import type { FlowSubjectAdapter } from '../types'

function deriveClassStatus(cls: {
  cancelledAt: Date | null
  completedAt: Date | null
}): 'scheduled' | 'cancelled' | 'completed' {
  if (cls.cancelledAt) return 'cancelled'
  if (cls.completedAt) return 'completed'
  return 'scheduled'
}

export function createTrainingClassFlowAdapter(
  ctx: RequestContext,
  classId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'training-classes',
    subjectId: classId,
    notifyCategory: 'training',
    auditEntityType: 'training_class',
    deepLink: () => `/training/classes/${classId}`,
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId: ctx.tenantId,
        subjectId: classId,
        entityType: 'training_class',
        heading: 'Training class',
        reference: values.title,
        subtitle: values.course_name,
        values,
      }),

    async loadValues() {
      const instTU = alias(tenantUsers, 'tc_instructor_tu')
      const instU = alias(users, 'tc_instructor_u')
      const [head] = await ctx.db((tx) =>
        tx
          .select({
            c: trainingClasses,
            courseName: trainingCourses.name,
            courseCode: trainingCourses.code,
            courseDescription: trainingCourses.description,
            siteName: orgUnits.name,
            instructorName: instU.name,
          })
          .from(trainingClasses)
          .leftJoin(trainingCourses, eq(trainingCourses.id, trainingClasses.courseId))
          .leftJoin(orgUnits, eq(orgUnits.id, trainingClasses.siteOrgUnitId))
          .leftJoin(instTU, eq(instTU.id, trainingClasses.instructorTenantUserId))
          .leftJoin(instU, eq(instU.id, instTU.userId))
          .where(eq(trainingClasses.id, classId))
          .limit(1),
      )
      if (!head) return {}
      const c = head.c

      // Roster with each attendee's best email (people.email, else the linked
      // login's email) so `attendee_emails` reaches everyone reachable.
      const attendeeU = alias(users, 'tc_attendee_u')
      const roster = await ctx.db((tx) =>
        tx
          .select({
            status: trainingClassAttendees.status,
            personId: trainingClassAttendees.personId,
            firstName: people.firstName,
            lastName: people.lastName,
            formalName: people.formalName,
            personEmail: people.email,
            userEmail: attendeeU.email,
          })
          .from(trainingClassAttendees)
          .innerJoin(people, eq(people.id, trainingClassAttendees.personId))
          .leftJoin(attendeeU, eq(attendeeU.id, people.userId))
          .where(eq(trainingClassAttendees.classId, classId))
          .orderBy(asc(people.lastName), asc(people.firstName)),
      )

      const status = deriveClassStatus(c)
      // Cancelled registrations are off the roster for counts + emails.
      const active = roster.filter((a) => a.status !== 'cancelled')
      const emails = active
        .map((a) => (a.personEmail?.includes('@') ? a.personEmail : a.userEmail))
        .filter((e): e is string => !!e && e.includes('@'))

      return {
        title: c.title ?? '',
        course_name: head.courseName ?? '',
        course_code: head.courseCode ?? '',
        course_description: head.courseDescription ?? '',
        status,
        status_label: titleize(status),
        starts_at: fmtDateTime(c.startsAt),
        ends_at: fmtDateTime(c.endsAt),
        site_name: head.siteName ?? '',
        instructor_name: head.instructorName ?? '',
        capacity: c.capacity ?? null,
        notes: c.notes ?? '',
        attendee_count: active.length,
        attended_count: active.filter((a) => a.status === 'attended').length,
        absent_count: active.filter((a) => a.status === 'no_show').length,
        attendee_emails: emails.join(', '),
        // FK ids for conditions / recipient `field` targets.
        course_id: c.courseId ?? null,
        site_org_unit_id: c.siteOrgUnitId ?? null,
        instructor_tenant_user_id: c.instructorTenantUserId ?? null,
        // Collections.
        attendees: roster.map((a) => ({
          name: personName({
            firstName: a.firstName,
            lastName: a.lastName,
            formalName: a.formalName,
          }),
          email: (a.personEmail?.includes('@') ? a.personEmail : a.userEmail) ?? '',
          status: titleize(a.status),
        })),
      }
    },

    async resolveSubmitter() {
      // training_classes has no created-by column; the instructor is the
      // closest owning user for the `submitter` target.
      const [r] = await ctx.db((tx) =>
        tx
          .select({ tuid: trainingClasses.instructorTenantUserId })
          .from(trainingClasses)
          .where(eq(trainingClasses.id, classId))
          .limit(1),
      )
      const tuid = r?.tuid ?? null
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
  }
}
