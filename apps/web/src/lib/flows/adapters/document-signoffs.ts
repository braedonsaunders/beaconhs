import 'server-only'

import { asc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  attachments,
  documentAcknowledgmentSessions,
  documentAcknowledgments,
  documentVersions,
  documents,
  orgUnits,
  people,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { presignGet } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { fmtDateTime, personName } from '../format'
import type { FlowSubjectAdapter } from '../types'

export function createDocumentSignoffFlowAdapter(
  ctx: RequestContext,
  sessionId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'document-signoffs',
    subjectId: sessionId,
    notifyCategory: 'document',
    auditEntityType: 'document_acknowledgment_session',
    deepLink: () => `/documents/sign-off-sessions/${sessionId}`,
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId: ctx.tenantId,
        subjectId: sessionId,
        entityType: 'document_acknowledgment_session',
        heading: 'Document sign-off',
        reference: String(values.document_key ?? sessionId.slice(0, 8)),
        subtitle: values.title,
        values,
      }),

    async loadValues() {
      const conductorPerson = alias(people, 'document_signoff_conductor_person')
      const [head] = await ctx.db((tx) =>
        tx
          .select({
            session: documentAcknowledgmentSessions,
            documentTitle: documents.title,
            documentKey: documents.key,
            version: documentVersions.version,
            siteName: orgUnits.name,
            conductorName: users.name,
            conductorPersonId: conductorPerson.id,
          })
          .from(documentAcknowledgmentSessions)
          .innerJoin(documents, eq(documents.id, documentAcknowledgmentSessions.documentId))
          .innerJoin(
            documentVersions,
            eq(documentVersions.id, documentAcknowledgmentSessions.versionId),
          )
          .leftJoin(orgUnits, eq(orgUnits.id, documentAcknowledgmentSessions.siteOrgUnitId))
          .leftJoin(
            tenantUsers,
            eq(tenantUsers.id, documentAcknowledgmentSessions.conductedByTenantUserId),
          )
          .leftJoin(users, eq(users.id, tenantUsers.userId))
          .leftJoin(conductorPerson, eq(conductorPerson.userId, tenantUsers.userId))
          .where(eq(documentAcknowledgmentSessions.id, sessionId))
          .limit(1),
      )
      if (!head) return {}

      const signatures = await ctx.db((tx) =>
        tx
          .select({
            firstName: people.firstName,
            lastName: people.lastName,
            formalName: people.formalName,
            acknowledgedAt: documentAcknowledgments.acknowledgedAt,
            attachmentId: documentAcknowledgments.signatureAttachmentId,
            signatureKey: attachments.r2Key,
          })
          .from(documentAcknowledgments)
          .innerJoin(people, eq(people.id, documentAcknowledgments.personId))
          .leftJoin(attachments, eq(attachments.id, documentAcknowledgments.signatureAttachmentId))
          .where(eq(documentAcknowledgments.sessionId, sessionId))
          .orderBy(asc(documentAcknowledgments.acknowledgedAt)),
      )
      const session = head.session
      return {
        title: session.title ?? head.documentTitle,
        document_title: head.documentTitle,
        document_key: head.documentKey,
        document_version: head.version,
        location: session.location ?? head.siteName ?? '',
        site_name: head.siteName ?? '',
        site_org_unit_id: session.siteOrgUnitId,
        notes: session.notes ?? '',
        conducted_by_name: head.conductorName ?? '',
        conducted_by_tenant_user_id: session.conductedByTenantUserId,
        conducted_by_person_id: head.conductorPersonId,
        conducted_at: fmtDateTime(session.conductedAt),
        completed_at: fmtDateTime(session.completedAt),
        signer_count: signatures.length,
        signatures: await Promise.all(
          signatures.map(async (signature) => ({
            name: personName(signature),
            signed_at: fmtDateTime(signature.acknowledgedAt),
            attachment_id: signature.attachmentId,
            image: signature.signatureKey
              ? await presignGet({ key: signature.signatureKey, expiresInSeconds: 900 })
              : '',
          })),
        ),
      }
    },

    async resolveSubmitter() {
      const [row] = await ctx.db((tx) =>
        tx
          .select({
            tenantUserId: documentAcknowledgmentSessions.conductedByTenantUserId,
            email: users.email,
            userId: users.id,
          })
          .from(documentAcknowledgmentSessions)
          .leftJoin(
            tenantUsers,
            eq(tenantUsers.id, documentAcknowledgmentSessions.conductedByTenantUserId),
          )
          .leftJoin(users, eq(users.id, tenantUsers.userId))
          .where(eq(documentAcknowledgmentSessions.id, sessionId))
          .limit(1),
      )
      return {
        tenantUserId: row?.tenantUserId ?? null,
        email: row?.email ?? null,
        userId: row?.userId ?? null,
      }
    },
  }
}
