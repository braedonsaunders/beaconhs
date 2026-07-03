'use server'

// Server actions for the per-person Files tab + signature image upload.
//
// File rows live in `person_files`. The signature image lives directly on
// `people.signature_attachment_id` because there's exactly one per person and
// any number of forms / inspections / lift plans want to render it inline.

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { people, personFiles } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { assertCanActOnPerson } from '../_lib/person-access'

const ALLOWED_KINDS = new Set(['resume', 'certification', 'id_copy', 'other'])

export async function addPersonFile(args: {
  personId: string
  attachmentId: string
  label: string
  kind: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  if (!args.personId) return { ok: false, error: 'Missing personId' }
  if (!args.attachmentId) return { ok: false, error: 'Missing attachmentId' }
  await assertCanActOnPerson(ctx, args.personId)
  const label = args.label.trim()
  if (!label) return { ok: false, error: 'Label is required' }
  const kind = ALLOWED_KINDS.has(args.kind) ? args.kind : 'other'

  const [row] = await ctx.db((tx) =>
    tx
      .insert(personFiles)
      .values({
        tenantId: ctx.tenantId,
        personId: args.personId,
        attachmentId: args.attachmentId,
        label,
        kind,
        uploadedBy: ctx.userId,
      })
      .returning(),
  )
  if (!row) return { ok: false, error: 'Insert failed' }

  await recordAudit(ctx, {
    entityType: 'person',
    entityId: args.personId,
    action: 'create',
    summary: `Uploaded ${kind.replace('_', ' ')}: ${label}`,
    metadata: { personFileId: row.id, attachmentId: args.attachmentId, kind },
  })

  revalidatePath(`/people/${args.personId}`)
  return { ok: true }
}

export async function deletePersonFile(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const personId = String(formData.get('personId') ?? '')
  if (!id || !personId) return
  await assertCanActOnPerson(ctx, personId)

  const before = await ctx.db(async (tx) => {
    const [r] = await tx
      .select()
      .from(personFiles)
      .where(and(eq(personFiles.id, id), eq(personFiles.personId, personId)))
      .limit(1)
    return r
  })
  if (!before) return

  await ctx.db((tx) => tx.delete(personFiles).where(eq(personFiles.id, id)))

  await recordAudit(ctx, {
    entityType: 'person',
    entityId: personId,
    action: 'delete',
    summary: `Deleted file: ${before.label}`,
    before: before as unknown as Record<string, unknown>,
    metadata: { personFileId: id, kind: before.kind },
  })

  revalidatePath(`/people/${personId}`)
}

export async function setPersonSignature(args: {
  personId: string
  attachmentId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  if (!args.personId) return { ok: false, error: 'Missing personId' }
  if (!args.attachmentId) return { ok: false, error: 'Missing attachmentId' }
  await assertCanActOnPerson(ctx, args.personId)

  const before = await ctx.db(async (tx) => {
    const [r] = await tx
      .select({ signatureAttachmentId: people.signatureAttachmentId })
      .from(people)
      .where(eq(people.id, args.personId))
      .limit(1)
    return r
  })

  await ctx.db((tx) =>
    tx
      .update(people)
      .set({ signatureAttachmentId: args.attachmentId })
      .where(eq(people.id, args.personId)),
  )

  await recordAudit(ctx, {
    entityType: 'person',
    entityId: args.personId,
    action: 'update',
    summary: 'Updated signature image',
    before: before as unknown as Record<string, unknown>,
    after: { signatureAttachmentId: args.attachmentId },
  })

  revalidatePath(`/people/${args.personId}`)
  return { ok: true }
}

export async function clearPersonSignature(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const personId = String(formData.get('personId') ?? '')
  if (!personId) return
  await assertCanActOnPerson(ctx, personId)

  await ctx.db((tx) =>
    tx.update(people).set({ signatureAttachmentId: null }).where(eq(people.id, personId)),
  )

  await recordAudit(ctx, {
    entityType: 'person',
    entityId: personId,
    action: 'update',
    summary: 'Cleared signature image',
    after: { signatureAttachmentId: null },
  })

  revalidatePath(`/people/${personId}`)
}
