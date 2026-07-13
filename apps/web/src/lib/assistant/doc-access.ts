// Single source of truth for "which controlled documents may this user read",
// shared by the assistant's read tools (tools.ts) AND the in-chat document
// reader (_document-reader-actions.ts). Mirrors the /documents list page:
// managers (documents.manage / super-admin) see everything; everyone else sees
// PUBLISHED documents only. Keeping this in one place means the security rule
// can't drift between the search results and what the reader will open.

import { eq, type SQL } from 'drizzle-orm'
import { documents } from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'

function canManageDocuments(ctx: RequestContext): boolean {
  return ctx.isSuperAdmin || can(ctx, 'documents.manage')
}

/** Extra WHERE restricting non-managers to published documents; undefined for managers. */
export function documentReadFilter(ctx: RequestContext): SQL | undefined {
  return canManageDocuments(ctx) ? undefined : eq(documents.status, 'published')
}
