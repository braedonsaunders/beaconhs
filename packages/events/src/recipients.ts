// Notification-group resolution — the shared "who" layer.
//
// A notification group is a stored, composable audience: a union of include
// member rows (person / role / department / org_unit / trade / crew /
// person_group / everyone) minus exclude rows. This module turns groups into
// the concrete recipients every send path needs:
//   • resolveGroupMembers → {personId, userId}[]   (in-app / cockpit audience)
//   • resolveGroupEmails   → string[]               (email channel)
//   • previewAudience      → {count, names}         (the Groups UI live preview)
//
// All resolution funnels through the ONE canonical `resolveObligationAudience`
// (packages/compliance) so groups behave identically to compliance audiences.
// Server-only (queries the db) — never import from a client component.

import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  notificationGroupMembers,
  people,
  roleAssignments,
  roles,
  tenantNotificationSettings,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import {
  resolveObligationAudience,
  type AudienceItem,
  type ResolvedMember,
} from '@beaconhs/compliance'

export type AudienceMemberInput = {
  kind: AudienceItem['kind']
  entityKey: string
  mode: 'include' | 'exclude'
}

export const DEFAULT_ROLES_BY_CATEGORY: Readonly<Record<string, string[]>> = {
  incident: ['safety_manager', 'tenant_admin'],
  ca: ['safety_manager', 'tenant_admin'],
  compliance: ['safety_manager', 'tenant_admin'],
  equipment: ['safety_manager', 'tenant_admin'],
}

/**
 * Canonical automatic-notification audience resolver. A saved category row is
 * authoritative; a missing row uses the built-in roles. Every returned user is
 * an active member of this tenant.
 */
export async function resolveNotificationAudienceUserIds(
  tx: Database,
  tenantId: string,
  category: string,
  extraUserIds: string[] = [],
): Promise<string[]> {
  const [settings] = await tx
    .select()
    .from(tenantNotificationSettings)
    .where(
      and(
        eq(tenantNotificationSettings.tenantId, tenantId),
        eq(tenantNotificationSettings.category, category),
      ),
    )
    .limit(1)
  if (settings?.enabled === false) return []

  const candidates = new Set([...extraUserIds, ...(settings?.userIds ?? [])].filter(Boolean))
  if (settings?.groupIds.length) {
    for (const userId of await resolveGroupUserIds(tx, tenantId, settings.groupIds)) {
      candidates.add(userId)
    }
  }
  const roleKeys = settings
    ? settings.roleKeys
    : (DEFAULT_ROLES_BY_CATEGORY[category] ?? ['tenant_admin'])
  if (roleKeys.length > 0) {
    const members = await tx
      .select({ userId: tenantUsers.userId })
      .from(tenantUsers)
      .innerJoin(roleAssignments, eq(roleAssignments.tenantUserId, tenantUsers.id))
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(
        and(
          eq(tenantUsers.tenantId, tenantId),
          eq(tenantUsers.status, 'active'),
          inArray(roles.key, roleKeys),
        ),
      )
    for (const member of members) candidates.add(member.userId)
  }
  if (candidates.size === 0) return []

  const active = await tx
    .select({ userId: tenantUsers.userId })
    .from(tenantUsers)
    .where(
      and(
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.status, 'active'),
        inArray(tenantUsers.userId, [...candidates]),
      ),
    )
  return [...new Set(active.map((member) => member.userId))]
}

export async function resolveNotificationAudienceEmails(
  tx: Database,
  tenantId: string,
  category: string,
  extraUserIds: string[] = [],
): Promise<string[]> {
  const userIds = await resolveNotificationAudienceUserIds(tx, tenantId, category, extraUserIds)
  if (userIds.length === 0) return []
  const rows = await tx
    .select({ email: users.email })
    .from(tenantUsers)
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .where(
      and(
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.status, 'active'),
        inArray(tenantUsers.userId, userIds),
      ),
    )
  return [...new Set(rows.map((row) => row.email.trim().toLowerCase()).filter(Boolean))]
}

/**
 * Resolve a raw member list (not necessarily saved yet) to the deduplicated set
 * of people, applying excludes. Used by both saved-group resolution and the
 * live UI preview.
 */
export async function resolveAudienceFromMembers(
  tx: Database,
  tenantId: string,
  members: AudienceMemberInput[],
): Promise<ResolvedMember[]> {
  const includes: AudienceItem[] = members
    .filter((m) => m.mode === 'include')
    .map((m) => ({ kind: m.kind, entityKey: m.entityKey }))
  const excludes: AudienceItem[] = members
    .filter((m) => m.mode === 'exclude')
    .map((m) => ({ kind: m.kind, entityKey: m.entityKey }))
  if (includes.length === 0) return []

  const [included, excluded] = await Promise.all([
    resolveObligationAudience(tx, tenantId, includes),
    excludes.length > 0 ? resolveObligationAudience(tx, tenantId, excludes) : Promise.resolve([]),
  ])
  if (excluded.length === 0) return included
  const drop = new Set(excluded.map((m) => m.personId))
  return included.filter((m) => !drop.has(m.personId))
}

/** Load the saved member rows for one or more groups, flattened. */
async function loadGroupMembers(
  tx: Database,
  tenantId: string,
  groupIds: string[],
): Promise<AudienceMemberInput[]> {
  if (groupIds.length === 0) return []
  const rows = await tx
    .select({
      kind: notificationGroupMembers.kind,
      entityKey: notificationGroupMembers.entityKey,
      mode: notificationGroupMembers.mode,
    })
    .from(notificationGroupMembers)
    .where(
      and(
        eq(notificationGroupMembers.tenantId, tenantId),
        inArray(notificationGroupMembers.groupId, groupIds),
      ),
    )
  return rows.map((r) => ({ kind: r.kind, entityKey: r.entityKey, mode: r.mode }))
}

/** Resolve saved groups → deduplicated {personId, userId}. */
export async function resolveGroupMembers(
  tx: Database,
  tenantId: string,
  groupIds: string[],
): Promise<ResolvedMember[]> {
  const members = await loadGroupMembers(tx, tenantId, groupIds)
  return resolveAudienceFromMembers(tx, tenantId, members)
}

/** Resolve saved groups → linked Better-Auth user ids (non-null only). */
export async function resolveGroupUserIds(
  tx: Database,
  tenantId: string,
  groupIds: string[],
): Promise<string[]> {
  const members = await resolveGroupMembers(tx, tenantId, groupIds)
  return Array.from(new Set(members.map((m) => m.userId).filter((u): u is string => !!u)))
}

/** Turn resolved people into email addresses (person email, else linked user). */
export async function emailsForPersonIds(
  tx: Database,
  tenantId: string,
  personIds: string[],
): Promise<string[]> {
  if (personIds.length === 0) return []
  const rows = await tx
    .select({ personEmail: people.email, userEmail: users.email })
    .from(people)
    .leftJoin(users, eq(users.id, people.userId))
    .where(and(eq(people.tenantId, tenantId), inArray(people.id, personIds)))
  const out = new Set<string>()
  for (const r of rows) {
    const email = r.personEmail || r.userEmail
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.add(email)
  }
  return Array.from(out)
}

/** Resolve saved groups → email addresses. */
export async function resolveGroupEmails(
  tx: Database,
  tenantId: string,
  groupIds: string[],
): Promise<string[]> {
  const members = await resolveGroupMembers(tx, tenantId, groupIds)
  return emailsForPersonIds(
    tx,
    tenantId,
    members.map((m) => m.personId),
  )
}

/**
 * Live preview for the Groups builder: resolve an unsaved member list to a head
 * count + a few sample names, so the admin sees who a group actually reaches.
 */
export async function previewAudience(
  tx: Database,
  tenantId: string,
  members: AudienceMemberInput[],
  sampleLimit = 8,
): Promise<{ count: number; withEmail: number; sample: string[] }> {
  const resolved = await resolveAudienceFromMembers(tx, tenantId, members)
  if (resolved.length === 0) return { count: 0, withEmail: 0, sample: [] }
  const personIds = resolved.map((m) => m.personId)
  const rows = await tx
    .select({
      firstName: people.firstName,
      lastName: people.lastName,
      personEmail: people.email,
      userEmail: users.email,
    })
    .from(people)
    .leftJoin(users, eq(users.id, people.userId))
    .where(
      and(eq(people.tenantId, tenantId), inArray(people.id, personIds), isNull(people.deletedAt)),
    )
  const withEmail = rows.filter((r) => r.personEmail || r.userEmail).length
  const sample = rows
    .slice(0, sampleLimit)
    .map((r) => `${r.firstName} ${r.lastName}`.trim())
    .filter(Boolean)
  return { count: resolved.length, withEmail, sample }
}
