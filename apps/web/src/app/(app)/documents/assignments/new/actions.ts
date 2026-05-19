'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import {
  documentAssignmentAudience,
  documentAssignments,
  documents,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export type AudienceItem = {
  type: 'role' | 'trade' | 'department' | 'person' | 'everyone'
  entityKey: string
}

export type CreateAssignmentInput = {
  documentId: string
  title?: string | null
  notes?: string | null
  dueOn?: string | null
  audience: AudienceItem[]
}

export async function createAssignment(
  input: CreateAssignmentInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  if (!input.documentId) return { ok: false, error: 'Pick a document' }
  if (!input.audience || input.audience.length === 0) {
    return { ok: false, error: 'Pick at least one audience target' }
  }
  // Sanity-check the document belongs to this tenant.
  const [doc] = await ctx.db((tx) =>
    tx
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(eq(documents.id, input.documentId))
      .limit(1),
  )
  if (!doc) return { ok: false, error: 'Document not found' }

  const assignmentId = await ctx.db(async (tx) => {
    const [a] = await tx
      .insert(documentAssignments)
      .values({
        tenantId: ctx.tenantId,
        documentId: input.documentId,
        title: input.title ?? null,
        notes: input.notes ?? null,
        dueOn: input.dueOn ?? null,
        assignedByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: documentAssignments.id })
    if (!a) throw new Error('Failed to create assignment')
    // De-duplicate audience rows (type + entityKey).
    const seen = new Set<string>()
    const unique = input.audience.filter((row) => {
      const key = `${row.type}:${row.entityKey}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (unique.length > 0) {
      await tx.insert(documentAssignmentAudience).values(
        unique.map((row) => ({
          tenantId: ctx.tenantId,
          assignmentId: a.id,
          type: row.type,
          entityKey: row.entityKey,
        })),
      )
    }
    return a.id
  })

  await recordAudit(ctx, {
    entityType: 'document_assignment',
    entityId: assignmentId,
    action: 'create',
    summary: `Created assignment for "${doc.title}"`,
    after: {
      documentId: input.documentId,
      audience: input.audience,
      dueOn: input.dueOn,
    },
  })
  revalidatePath('/documents/assignments')
  redirect(`/documents/assignments/${assignmentId}`)
}
