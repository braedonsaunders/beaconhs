'use server'

// Acknowledgments are legal evidence tied to one immutable published version.
// Every path below resolves and validates the document/version/person/session
// relationship server-side, stores signatures in the same saga as the write,
// and commits the audit record in the business transaction.

import { revalidatePath } from 'next/cache'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import {
  attachments,
  documentAcknowledgmentSessions,
  documentAcknowledgments,
  documents,
  documentVersions,
  people,
} from '@beaconhs/db/schema'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import type { RequestContext } from '@beaconhs/tenant'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { withStoredSignatureAttachment } from '@/lib/signature-storage'

const MAX_SESSION_TITLE_CHARS = 240
const MAX_SESSION_LOCATION_CHARS = 240
const MAX_SESSION_NOTES_CHARS = 4_000
const MAX_SIGNATURE_DATA_URL_CHARS = 14 * 1024 * 1024

type TenantTx = Parameters<Parameters<RequestContext['db']>[0]>[0]

type SignerRow = {
  ackId: string
  personId: string
  name: string
  acknowledgedAt: string
  signatureAttachmentId: string | null
}

type Ok<T extends object = Record<never, never>> = { ok: true } & T
type Err = { ok: false; error: string }

class AcknowledgmentError extends Error {}

function inputRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AcknowledgmentError(`${label} is invalid`)
  }
  return value as Record<string, unknown>
}

function uuidInput(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new AcknowledgmentError(`${label} is invalid`)
  }
  return value
}

function optionalUuidInput(value: unknown, label: string): string | null {
  if (value == null || value === '') return null
  return uuidInput(value, label)
}

function optionalTextInput(value: unknown, label: string, max: number): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new AcknowledgmentError(`${label} is invalid`)
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > max) {
    throw new AcknowledgmentError(`${label} must be ${max.toLocaleString()} characters or fewer`)
  }
  return normalized
}

function signatureInput(value: unknown, required: boolean): string | null {
  if (value == null || value === '') {
    if (required) throw new AcknowledgmentError('Capture a signature first')
    return null
  }
  if (typeof value !== 'string' || value.length > MAX_SIGNATURE_DATA_URL_CHARS) {
    throw new AcknowledgmentError('Signature is invalid')
  }
  return value
}

function actionError(error: unknown, fallback: string): Err {
  return {
    ok: false,
    error: error instanceof Error && error.message ? error.message : fallback,
  }
}

async function lockPublishedDocument(tx: TenantTx, tenantId: string, documentId: string) {
  const [document] = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        eq(documents.id, documentId),
        eq(documents.status, 'published'),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1)
    .for('update')
  if (!document) {
    throw new AcknowledgmentError('This document is not published or is no longer available')
  }
}

async function currentPublishedVersionId(
  tx: TenantTx,
  tenantId: string,
  documentId: string,
): Promise<string> {
  const [version] = await tx
    .select({ id: documentVersions.id })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.tenantId, tenantId),
        eq(documentVersions.documentId, documentId),
        isNotNull(documentVersions.publishedAt),
      ),
    )
    .orderBy(desc(documentVersions.version))
    .limit(1)
  if (!version) throw new AcknowledgmentError('This document has no published version yet')
  return version.id
}

async function requirePublishedVersion(
  tx: TenantTx,
  tenantId: string,
  documentId: string,
  versionId: string,
): Promise<void> {
  const [version] = await tx
    .select({ id: documentVersions.id })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.tenantId, tenantId),
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.id, versionId),
        isNotNull(documentVersions.publishedAt),
      ),
    )
    .limit(1)
  if (!version) throw new AcknowledgmentError('Published document version not found')
}

/** Self-service acknowledgment of the current published version. */
export async function acknowledgeDocument(input: unknown): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.acknowledge')

  try {
    const values = inputRecord(input, 'Acknowledgment')
    const documentId = uuidInput(values.documentId, 'Document')
    const signatureDataUrl = signatureInput(values.signatureDataUrl, false)

    const write = async (tx: TenantTx, signatureAttachmentId: string | null) => {
      await lockPublishedDocument(tx, ctx.tenantId, documentId)
      const versionId = await currentPublishedVersionId(tx, ctx.tenantId, documentId)
      if (!ctx.personId) {
        throw new AcknowledgmentError('Your account is not linked to a person record')
      }
      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        .where(
          and(
            eq(people.tenantId, ctx.tenantId),
            eq(people.id, ctx.personId),
            isNull(people.deletedAt),
          ),
        )
        .limit(1)
      if (!person) throw new AcknowledgmentError('Your person record is no longer active')

      const [existing] = await tx
        .select({ id: documentAcknowledgments.id })
        .from(documentAcknowledgments)
        .where(
          and(
            eq(documentAcknowledgments.tenantId, ctx.tenantId),
            eq(documentAcknowledgments.documentId, documentId),
            eq(documentAcknowledgments.versionId, versionId),
            eq(documentAcknowledgments.personId, person.id),
          ),
        )
        .limit(1)
      if (existing) {
        // Throw so withStoredSignatureAttachment rolls back and removes a newly
        // uploaded signature instead of leaving an unattached object.
        throw new AcknowledgmentError('You have already acknowledged this version')
      }

      const [acknowledgment] = await tx
        .insert(documentAcknowledgments)
        .values({
          tenantId: ctx.tenantId,
          documentId,
          versionId,
          personId: person.id,
          signatureAttachmentId,
        })
        .returning({ id: documentAcknowledgments.id })
      if (!acknowledgment) throw new Error('Acknowledgment could not be recorded')

      await recordAuditInTransaction(tx, ctx, {
        entityType: 'document',
        entityId: documentId,
        action: 'sign',
        summary: 'Acknowledged by current user',
        after: {
          acknowledgmentId: acknowledgment.id,
          personId: person.id,
          versionId,
          signed: Boolean(signatureAttachmentId),
        },
      })
      await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
        sourceModule: 'document',
        targetRef: { documentId },
      })
    }

    if (signatureDataUrl) {
      await withStoredSignatureAttachment(ctx, signatureDataUrl, write)
    } else {
      await ctx.db((tx) => write(tx, null))
    }

    revalidatePath(`/documents/${documentId}`)
    return { ok: true }
  } catch (error) {
    if (error instanceof AcknowledgmentError && error.message.includes('already acknowledged')) {
      return { ok: true }
    }
    return actionError(error, 'The acknowledgment could not be recorded')
  }
}

/** Add one signer to a facilitator-led group sign-off sheet. */
export async function addSignOffSigner(
  input: unknown,
): Promise<Ok<{ sessionId: string; signer: SignerRow }> | Err> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')

  try {
    const values = inputRecord(input, 'Group sign-off')
    const documentId = uuidInput(values.documentId, 'Document')
    const versionId = uuidInput(values.versionId, 'Version')
    const personId = uuidInput(values.personId, 'Person')
    const signatureDataUrl = signatureInput(values.signatureDataUrl, true)!
    const sessionInput = inputRecord(values.session ?? {}, 'Session')
    const requestedSessionId = optionalUuidInput(sessionInput.id, 'Session')
    const title = optionalTextInput(sessionInput.title, 'Session title', MAX_SESSION_TITLE_CHARS)
    const location = optionalTextInput(
      sessionInput.location,
      'Session location',
      MAX_SESSION_LOCATION_CHARS,
    )
    const notes = optionalTextInput(sessionInput.notes, 'Session notes', MAX_SESSION_NOTES_CHARS)

    const out = await withStoredSignatureAttachment(
      ctx,
      signatureDataUrl,
      async (tx, signatureAttachmentId) => {
        if (!signatureAttachmentId) throw new AcknowledgmentError('Capture a signature first')
        await lockPublishedDocument(tx, ctx.tenantId, documentId)
        await requirePublishedVersion(tx, ctx.tenantId, documentId, versionId)

        const [person] = await tx
          .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
          .from(people)
          .where(
            and(
              eq(people.tenantId, ctx.tenantId),
              eq(people.id, personId),
              isNull(people.deletedAt),
            ),
          )
          .limit(1)
        if (!person) throw new AcknowledgmentError('Person not found')

        let sessionId = requestedSessionId
        if (sessionId) {
          const [session] = await tx
            .select({ id: documentAcknowledgmentSessions.id })
            .from(documentAcknowledgmentSessions)
            .where(
              and(
                eq(documentAcknowledgmentSessions.tenantId, ctx.tenantId),
                eq(documentAcknowledgmentSessions.id, sessionId),
                eq(documentAcknowledgmentSessions.documentId, documentId),
                eq(documentAcknowledgmentSessions.versionId, versionId),
                isNull(documentAcknowledgmentSessions.deletedAt),
              ),
            )
            .limit(1)
          if (!session) {
            throw new AcknowledgmentError(
              'This sign-off session is no longer available for this document version',
            )
          }
        } else {
          const [session] = await tx
            .insert(documentAcknowledgmentSessions)
            .values({
              tenantId: ctx.tenantId,
              documentId,
              versionId,
              title,
              location,
              notes,
              conductedByTenantUserId: ctx.membership?.id ?? null,
            })
            .returning({ id: documentAcknowledgmentSessions.id })
          if (!session) throw new Error('Sign-off session could not be created')
          sessionId = session.id
        }

        const [existing] = await tx
          .select({ id: documentAcknowledgments.id })
          .from(documentAcknowledgments)
          .where(
            and(
              eq(documentAcknowledgments.tenantId, ctx.tenantId),
              eq(documentAcknowledgments.documentId, documentId),
              eq(documentAcknowledgments.versionId, versionId),
              eq(documentAcknowledgments.personId, personId),
            ),
          )
          .limit(1)
        const name = `${person.firstName} ${person.lastName}`.trim() || '(unnamed)'
        if (existing) {
          throw new AcknowledgmentError(`${name} already acknowledged this version`)
        }

        const [acknowledgment] = await tx
          .insert(documentAcknowledgments)
          .values({
            tenantId: ctx.tenantId,
            documentId,
            versionId,
            personId,
            sessionId,
            signatureAttachmentId,
          })
          .returning({
            id: documentAcknowledgments.id,
            acknowledgedAt: documentAcknowledgments.acknowledgedAt,
          })
        if (!acknowledgment) throw new Error('Signer could not be recorded')

        await recordAuditInTransaction(tx, ctx, {
          entityType: 'document',
          entityId: documentId,
          action: 'sign',
          summary: `Group sign-off: ${name}`,
          after: { acknowledgmentId: acknowledgment.id, sessionId, personId, versionId },
        })
        await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
          sourceModule: 'document',
          targetRef: { documentId },
        })

        return {
          sessionId,
          signer: {
            ackId: acknowledgment.id,
            personId,
            name,
            acknowledgedAt: acknowledgment.acknowledgedAt.toISOString(),
            signatureAttachmentId,
          } satisfies SignerRow,
        }
      },
    )

    revalidatePath(`/documents/${documentId}`)
    revalidatePath(`/documents/${documentId}/sign-off`)
    return { ok: true, ...out }
  } catch (error) {
    return actionError(error, 'The signer could not be added')
  }
}

/** Remove only a group-session signer, along with its private signature file. */
export async function removeSignOffSigner(input: unknown): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')

  try {
    const values = inputRecord(input, 'Signer removal')
    const documentId = uuidInput(values.documentId, 'Document')
    const ackId = uuidInput(values.ackId, 'Signer')

    await ctx.db(async (tx) => {
      const [acknowledgment] = await tx
        .select({
          id: documentAcknowledgments.id,
          sessionId: documentAcknowledgments.sessionId,
          signatureAttachmentId: documentAcknowledgments.signatureAttachmentId,
        })
        .from(documentAcknowledgments)
        .where(
          and(
            eq(documentAcknowledgments.tenantId, ctx.tenantId),
            eq(documentAcknowledgments.id, ackId),
            eq(documentAcknowledgments.documentId, documentId),
            isNotNull(documentAcknowledgments.sessionId),
          ),
        )
        .limit(1)
        .for('update')
      if (!acknowledgment?.sessionId) {
        throw new AcknowledgmentError('Group sign-off signer not found')
      }

      await tx
        .delete(documentAcknowledgments)
        .where(
          and(
            eq(documentAcknowledgments.tenantId, ctx.tenantId),
            eq(documentAcknowledgments.id, acknowledgment.id),
          ),
        )
      if (acknowledgment.signatureAttachmentId) {
        // The attachment-deletion trigger records a durable storage deletion
        // intent; the worker removes the object with retries after commit.
        await tx
          .delete(attachments)
          .where(
            and(
              eq(attachments.tenantId, ctx.tenantId),
              eq(attachments.id, acknowledgment.signatureAttachmentId),
            ),
          )
      }
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'document',
        entityId: documentId,
        action: 'update',
        summary: 'Removed a group sign-off signer',
        before: { acknowledgmentId: acknowledgment.id, sessionId: acknowledgment.sessionId },
      })
      await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
        sourceModule: 'document',
        targetRef: { documentId },
      })
    })

    revalidatePath(`/documents/${documentId}`)
    revalidatePath(`/documents/${documentId}/sign-off`)
    return { ok: true }
  } catch (error) {
    return actionError(error, 'The signer could not be removed')
  }
}
