import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { attachments, people } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { attachmentUrl } from '@/lib/attachment-url'

type SignatureReuseMode = 'off' | 'manual' | 'automatic'
export function signatureReuseMode(value: unknown): SignatureReuseMode {
  return value === 'manual' || value === 'automatic' ? value : 'off'
}

/** Only the signed-in person's explicitly enabled signature can be offered for reuse. */
export async function loadMySavedSignature(ctx: RequestContext) {
  if (!ctx.personId || ctx.impersonation) return null
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({ id: attachments.id, metadata: people.metadata })
      .from(people)
      .innerJoin(
        attachments,
        and(
          eq(attachments.id, people.signatureAttachmentId),
          eq(attachments.tenantId, people.tenantId),
          eq(attachments.kind, 'signature'),
        ),
      )
      .where(
        and(
          eq(people.id, ctx.personId!),
          eq(people.tenantId, ctx.tenantId),
          eq(people.status, 'active'),
          isNull(people.deletedAt),
        ),
      )
      .limit(1)
    const mode = signatureReuseMode(row?.metadata.signatureReuseMode)
    return row && mode !== 'off'
      ? { mode, signature: { attachmentId: row.id, url: attachmentUrl(row.id) } }
      : null
  })
}
