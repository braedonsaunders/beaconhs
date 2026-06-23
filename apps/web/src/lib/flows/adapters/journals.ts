import 'server-only'

// Journals FlowSubjectAdapter. Field-map keys mirror MODULE_FLOW_PROFILES.journals.

import { eq } from 'drizzle-orm'
import { journalEntries, tenantUsers, users } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { spawnCorrectiveActionForSubject } from '../spawn'
import type { FlowSubjectAdapter } from '../types'

export function createJournalFlowAdapter(
  ctx: RequestContext,
  entryId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'journals',
    subjectId: entryId,
    notifyCategory: 'journal',
    auditEntityType: 'journal_entry',
    deepLink: () => `/journals/${entryId}`,

    async loadValues() {
      const [e] = await ctx.db((tx) =>
        tx
          .select({
            status: journalEntries.status,
            reference: journalEntries.reference,
            title: journalEntries.title,
            bodyText: journalEntries.bodyText,
            entryDate: journalEntries.entryDate,
            personId: journalEntries.personId,
            supervisorPersonId: journalEntries.supervisorPersonId,
            siteOrgUnitId: journalEntries.siteOrgUnitId,
            tagsCache: journalEntries.tagsCache,
          })
          .from(journalEntries)
          .where(eq(journalEntries.id, entryId))
          .limit(1),
      )
      return {
        status: e?.status ?? null,
        reference: e?.reference ?? null,
        title: e?.title ?? null,
        body_text: e?.bodyText ?? null,
        entry_date: e?.entryDate ?? null,
        person_id: e?.personId ?? null,
        supervisor_person_id: e?.supervisorPersonId ?? null,
        site_org_unit_id: e?.siteOrgUnitId ?? null,
        tags: (e?.tagsCache ?? []).join(', '),
      }
    },

    async resolveSubmitter() {
      const [e] = await ctx.db((tx) =>
        tx
          .select({ createdBy: journalEntries.createdByTenantUserId })
          .from(journalEntries)
          .where(eq(journalEntries.id, entryId))
          .limit(1),
      )
      const tuid = e?.createdBy ?? null
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
        sourceEntityType: 'journal_entry',
        sourceEntityId: entryId,
        source: 'observation',
        title: i.title,
        description: i.description ?? null,
        severity: i.severity,
        dueOn: i.dueOn ?? null,
      }),
  }
}
