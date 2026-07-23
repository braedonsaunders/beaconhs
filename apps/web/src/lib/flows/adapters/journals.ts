import 'server-only'

// Journals FlowSubjectAdapter. Field-map keys mirror MODULE_FLOW_PROFILES.journals.

import { asc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  attachments,
  journalEntries,
  journalEntryPhotos,
  orgUnits,
  people,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { presignGet } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import { spawnCorrectiveActionForSubject } from '../spawn'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { fmtDate, personName } from '../format'
import type { FlowSubjectAdapter } from '../types'
import { photoDocumentUrl } from '@/lib/photo-document-url'

export function createJournalFlowAdapter(ctx: RequestContext, entryId: string): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'journals',
    subjectId: entryId,
    notifyCategory: 'journal',
    auditEntityType: 'journal_entry',
    deepLink: () => `/journals/${entryId}`,
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId: ctx.tenantId,
        subjectId: entryId,
        entityType: 'journal_entry',
        heading: 'Daily journal',
        reference: values.reference,
        subtitle: values.title,
        values,
      }),

    async loadValues() {
      const author = alias(people, 'jrnl_author')
      const supervisor = alias(people, 'jrnl_supervisor')
      const [e] = await ctx.db((tx) =>
        tx
          .select({
            row: journalEntries,
            siteName: orgUnits.name,
            authFirst: author.firstName,
            authLast: author.lastName,
            authFormal: author.formalName,
            supFirst: supervisor.firstName,
            supLast: supervisor.lastName,
            supFormal: supervisor.formalName,
          })
          .from(journalEntries)
          .leftJoin(orgUnits, eq(orgUnits.id, journalEntries.siteOrgUnitId))
          .leftJoin(author, eq(author.id, journalEntries.personId))
          .leftJoin(supervisor, eq(supervisor.id, journalEntries.supervisorPersonId))
          .where(eq(journalEntries.id, entryId))
          .limit(1),
      )
      if (!e) return {}
      const r = e.row

      const photos = await ctx.db((tx) =>
        tx
          .select({
            caption: journalEntryPhotos.caption,
            r2Key: attachments.r2Key,
            annotations: attachments.annotations,
            width: attachments.width,
            height: attachments.height,
          })
          .from(journalEntryPhotos)
          .innerJoin(attachments, eq(attachments.id, journalEntryPhotos.attachmentId))
          .where(eq(journalEntryPhotos.entryId, entryId))
          .orderBy(asc(journalEntryPhotos.sortOrder)),
      )

      return {
        status: r.status ?? null,
        reference: r.reference ?? null,
        title: r.title ?? null,
        body_text: r.bodyText ?? null,
        entry_date: fmtDate(r.entryDate),
        author_name: personName({
          firstName: e.authFirst,
          lastName: e.authLast,
          formalName: e.authFormal,
        }),
        supervisor_name: personName({
          firstName: e.supFirst,
          lastName: e.supLast,
          formalName: e.supFormal,
        }),
        site_name: e.siteName ?? '',
        // Captured weather snapshot, printable ("21°C — Overcast").
        weather: [
          r.weather?.tempC != null ? `${r.weather.tempC}°C` : null,
          r.weather?.conditions || null,
        ]
          .filter(Boolean)
          .join(' — '),
        tags: (r.tagsCache ?? []).join(', '),
        person_id: r.personId ?? null,
        supervisor_person_id: r.supervisorPersonId ?? null,
        site_org_unit_id: r.siteOrgUnitId ?? null,
        photos: await Promise.all(
          photos.map(async (p) => {
            const url = await presignGet({ key: p.r2Key, expiresInSeconds: 900 })
            return {
              url: photoDocumentUrl({
                url,
                annotations: p.annotations,
                width: p.width,
                height: p.height,
              }),
              caption: p.caption ?? '',
            }
          }),
        ),
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
        flowExecutionKey: i.flowExecutionKey,
      }),
  }
}
