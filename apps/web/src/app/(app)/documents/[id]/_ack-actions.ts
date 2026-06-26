'use server'

// Acknowledgment write paths for a document:
//  - acknowledgeDocument: self-service "I've read this", with an optional signature.
//  - addSignOffSigner / removeSignOffSigner: the group sign-off sheet — one
//    facilitator-led session that writes one document_acknowledgments row PER
//    person, so the per-person compliance engine (evalDocument) is satisfied
//    exactly as for self-service acks.

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import {
  documentAcknowledgmentSessions,
  documentAcknowledgments,
  people,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

type SignerRow = {
  ackId: string
  personId: string
  name: string
  acknowledgedAt: string
  signatureAttachmentId: string | null
}

type Ok<T> = { ok: true } & T
type Err = { ok: false; error: string }

/** Self-service acknowledgment of the current published version, optional signature. */
export async function acknowledgeDocument(input: {
  documentId: string
  versionId: string
  signatureAttachmentId?: string | null
}): Promise<Ok<unknown> | Err> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.acknowledge')
  const { documentId, versionId } = input
  if (!documentId || !versionId) return { ok: false, error: 'Missing document or version' }

  const person = await ctx.db(async (tx) => {
    const [p] = await tx.select().from(people).where(eq(people.userId, ctx.userId)).limit(1)
    return p ?? null
  })
  if (!person) return { ok: false, error: 'Your account is not linked to a person record' }

  // Already acknowledged this exact version (self-service) — no-op.
  const existing = await ctx.db(async (tx) => {
    const [e] = await tx
      .select({ id: documentAcknowledgments.id })
      .from(documentAcknowledgments)
      .where(
        and(
          eq(documentAcknowledgments.documentId, documentId),
          eq(documentAcknowledgments.versionId, versionId),
          eq(documentAcknowledgments.personId, person.id),
        ),
      )
      .limit(1)
    return e ?? null
  })
  if (existing) {
    revalidatePath(`/documents/${documentId}`)
    return { ok: true }
  }

  await ctx.db((tx) =>
    tx.insert(documentAcknowledgments).values({
      tenantId: ctx.tenantId,
      documentId,
      versionId,
      personId: person.id,
      signatureAttachmentId: input.signatureAttachmentId ?? null,
    }),
  )
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: documentId,
    action: 'sign',
    summary: 'Acknowledged by current user',
    after: { personId: person.id, versionId, signed: !!input.signatureAttachmentId },
  })
  revalidatePath(`/documents/${documentId}`)
  return { ok: true }
}

/** Add one signer to a group sign-off sheet, creating the session on first add. */
export async function addSignOffSigner(input: {
  documentId: string
  versionId: string
  session: {
    id?: string | null
    title?: string | null
    location?: string | null
    notes?: string | null
  }
  personId: string
  signatureAttachmentId?: string | null
}): Promise<Ok<{ sessionId: string; signer: SignerRow }> | Err> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const { documentId, versionId, personId } = input
  if (!documentId || !versionId) return { ok: false, error: 'Missing document or version' }
  if (!personId) return { ok: false, error: 'Pick a person' }

  const out = await ctx.db(async (tx) => {
    const [p] = await tx
      .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
      .from(people)
      .where(eq(people.id, personId))
      .limit(1)
    if (!p) return { ok: false as const, error: 'Person not found' }

    // Resolve the session (verify it still exists) or create it.
    let sessionId = input.session.id?.trim() || null
    if (sessionId) {
      const [s] = await tx
        .select({ id: documentAcknowledgmentSessions.id })
        .from(documentAcknowledgmentSessions)
        .where(eq(documentAcknowledgmentSessions.id, sessionId))
        .limit(1)
      if (!s) sessionId = null
    }
    if (!sessionId) {
      const [s] = await tx
        .insert(documentAcknowledgmentSessions)
        .values({
          tenantId: ctx.tenantId,
          documentId,
          versionId,
          title: input.session.title?.trim() || null,
          location: input.session.location?.trim() || null,
          notes: input.session.notes?.trim() || null,
          conductedByTenantUserId: ctx.membership?.id ?? null,
        })
        .returning({ id: documentAcknowledgmentSessions.id })
      sessionId = s!.id
    }

    // Same person already on this sheet — surface a friendly error.
    const [dupe] = await tx
      .select({ id: documentAcknowledgments.id })
      .from(documentAcknowledgments)
      .where(
        and(
          eq(documentAcknowledgments.sessionId, sessionId),
          eq(documentAcknowledgments.personId, personId),
        ),
      )
      .limit(1)
    if (dupe) {
      const name = `${p.firstName} ${p.lastName}`.trim()
      return { ok: false as const, error: `${name || 'That person'} is already on this sheet` }
    }

    const [ack] = await tx
      .insert(documentAcknowledgments)
      .values({
        tenantId: ctx.tenantId,
        documentId,
        versionId,
        personId,
        sessionId,
        signatureAttachmentId: input.signatureAttachmentId ?? null,
      })
      .returning({
        id: documentAcknowledgments.id,
        acknowledgedAt: documentAcknowledgments.acknowledgedAt,
      })

    return {
      ok: true as const,
      sessionId,
      signer: {
        ackId: ack!.id,
        personId,
        name: `${p.firstName} ${p.lastName}`.trim() || '(unnamed)',
        acknowledgedAt: ack!.acknowledgedAt.toISOString(),
        signatureAttachmentId: input.signatureAttachmentId ?? null,
      } satisfies SignerRow,
    }
  })

  if (!out.ok) return out
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: documentId,
    action: 'sign',
    summary: `Group sign-off: ${out.signer.name}`,
    after: { sessionId: out.sessionId, personId, versionId },
  })
  revalidatePath(`/documents/${documentId}`)
  revalidatePath(`/documents/${documentId}/sign-off`)
  return { ok: true, sessionId: out.sessionId, signer: out.signer }
}

/** Remove a mistakenly-added signer from a sign-off sheet. */
export async function removeSignOffSigner(input: {
  documentId: string
  ackId: string
}): Promise<Ok<unknown> | Err> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (!input.ackId) return { ok: false, error: 'Missing signer' }
  await ctx.db((tx) =>
    tx
      .delete(documentAcknowledgments)
      .where(
        and(
          eq(documentAcknowledgments.id, input.ackId),
          eq(documentAcknowledgments.documentId, input.documentId),
        ),
      ),
  )
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: input.documentId,
    action: 'update',
    summary: 'Removed a group sign-off signer',
    after: { ackId: input.ackId },
  })
  revalidatePath(`/documents/${input.documentId}`)
  revalidatePath(`/documents/${input.documentId}/sign-off`)
  return { ok: true }
}
