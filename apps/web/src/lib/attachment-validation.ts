import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { attachments } from '@beaconhs/db/schema'
import { isUuid } from './list-params'

/**
 * Validate browser-supplied attachment ids before linking them to a record.
 * The share lock prevents a validated attachment from changing underneath the
 * caller's transaction, while tenant and kind predicates prevent cross-tenant
 * or non-image objects from being smuggled into photo evidence fields.
 */
export async function validateTenantImageAttachmentIdsInTx(
  tx: Database,
  tenantId: string,
  attachmentIds: readonly string[],
): Promise<string[]> {
  const uniqueIds = [...new Set(attachmentIds)]
  if (uniqueIds.some((id) => !isUuid(id))) {
    throw new Error('One or more photo attachments are invalid')
  }
  if (uniqueIds.length === 0) return []

  const rows = await tx
    .select({ id: attachments.id })
    .from(attachments)
    .where(
      and(
        eq(attachments.tenantId, tenantId),
        eq(attachments.kind, 'image'),
        inArray(attachments.id, uniqueIds),
      ),
    )
    .for('share')
  if (rows.length !== uniqueIds.length) {
    throw new Error('One or more photo attachments do not belong to this workspace')
  }
  return uniqueIds
}
