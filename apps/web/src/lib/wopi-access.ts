import 'server-only'

import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { db, withSuperAdmin, type Database } from '@beaconhs/db'
import {
  documentVersions,
  documents,
  trainingContentItems,
  trainingLessons,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { evaluateWopiPrincipal, type WopiGrant } from './wopi'
import { resolveMembershipPerms } from './impersonation'

/** Re-evaluate the token's human principal so suspension/removal/RBAC changes revoke it. */
export async function wopiPrincipalIsAuthorized(grant: WopiGrant): Promise<boolean> {
  return withSuperAdmin(db, async (tx) => {
    const [user] = await tx
      .select({ isSuperAdmin: users.isSuperAdmin })
      .from(users)
      .where(eq(users.id, grant.userId))
      .limit(1)
    if (!user) return false
    if (user.isSuperAdmin) {
      return evaluateWopiPrincipal(grant, {
        isSuperAdmin: true,
        membershipStatus: null,
        permissions: new Set(),
        appliedRoleId: null,
      })
    }

    const [membership] = await tx
      .select({ id: tenantUsers.id, status: tenantUsers.status })
      .from(tenantUsers)
      .where(and(eq(tenantUsers.userId, grant.userId), eq(tenantUsers.tenantId, grant.tenantId)))
      .limit(1)
    if (!membership) return false
    const { permissions, appliedRoleId } = await resolveMembershipPerms(
      tx,
      membership.id,
      grant.activeRoleId,
    )
    return evaluateWopiPrincipal(grant, {
      isSuperAdmin: false,
      membershipStatus: membership.status,
      permissions,
      appliedRoleId,
    })
  })
}

/**
 * Re-authorize a signed editor grant against current tenant data. HMAC proves
 * who minted the token; this check ensures a 12-hour token stops working when
 * its document/deck is deleted or its master attachment is replaced.
 */
export async function wopiGrantCanAccessFile(tx: Database, grant: WopiGrant): Promise<boolean> {
  if (grant.target === 'document') {
    const [document] = await tx
      .select({ sourceAttachmentId: documents.sourceAttachmentId })
      .from(documents)
      .where(and(eq(documents.id, grant.targetId), isNull(documents.deletedAt)))
      .limit(1)
    if (!document) return false
    if (document.sourceAttachmentId === grant.attachmentId) return true
    if (grant.canWrite) return false

    // Read-only WOPI sessions may target an immutable published DOCX snapshot
    // rather than the live document master.
    const [version] = await tx
      .select({ id: documentVersions.id })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, grant.targetId),
          eq(documentVersions.docxAttachmentId, grant.attachmentId),
          isNotNull(documentVersions.publishedAt),
        ),
      )
      .limit(1)
    return Boolean(version)
  }

  const table = grant.target === 'lesson' ? trainingLessons : trainingContentItems
  const [target] = await tx
    .select({ sourceAttachmentId: table.sourceAttachmentId })
    .from(table)
    .where(and(eq(table.id, grant.targetId), isNull(table.deletedAt)))
    .limit(1)
  return target?.sourceAttachmentId === grant.attachmentId
}
