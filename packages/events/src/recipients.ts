// People-group resolution — the shared "who" layer. People → Groups is the
// single reusable group system for notifications, Flows, role scopes, and
// on-demand email. This module turns memberships into concrete recipients:
//   • resolveGroupMembers → {personId, userId}[]   (in-app / cockpit audience)
//   • resolveGroupEmails   → string[]               (email channel)
//
// Server-only (queries the db) — never import from a client component.

import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  people,
  personGroupMemberships,
  roleAssignments,
  roles,
  tenantNotificationSettings,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import type { ResolvedMember } from '@beaconhs/compliance'

export const DEFAULT_ROLES_BY_CATEGORY: Readonly<Record<string, string[]>> = {
  incident: ['safety_manager', 'tenant_admin'],
  ca: ['safety_manager', 'tenant_admin'],
  compliance: ['safety_manager', 'tenant_admin'],
  equipment: ['safety_manager', 'tenant_admin'],
}

/**
 * Check the authoritative tenant kill switch for an automatic notification
 * category. Missing rows retain the documented default-on behaviour.
 */
export async function isNotificationCategoryEnabled(
  tx: Database,
  tenantId: string,
  category: string,
): Promise<boolean> {
  const [settings] = await tx
    .select({ enabled: tenantNotificationSettings.enabled })
    .from(tenantNotificationSettings)
    .where(
      and(
        eq(tenantNotificationSettings.tenantId, tenantId),
        eq(tenantNotificationSettings.category, category),
      ),
    )
    .limit(1)
  return settings?.enabled !== false
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

/** Resolve saved People groups → deduplicated {personId, userId}. */
export async function resolveGroupMembers(
  tx: Database,
  tenantId: string,
  groupIds: string[],
): Promise<ResolvedMember[]> {
  if (groupIds.length === 0) return []
  const rows = await tx
    .selectDistinct({ personId: people.id, userId: people.userId })
    .from(personGroupMemberships)
    .innerJoin(people, eq(people.id, personGroupMemberships.personId))
    .where(
      and(
        eq(personGroupMemberships.tenantId, tenantId),
        inArray(personGroupMemberships.groupId, groupIds),
        eq(people.tenantId, tenantId),
        eq(people.status, 'active'),
        isNull(people.deletedAt),
      ),
    )
  return rows
}

/** Resolve saved People groups → linked Better-Auth user ids (non-null only). */
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

/** Resolve saved People groups → email addresses. */
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
