// Domain event dispatcher.
//
// The single API that domain code (server actions, scheduled workers) calls
// when something happens. It resolves the audience for an event, builds the
// in-app notification payload AND the email-template HTML/text, then enqueues
// both jobs.
//
// Importable from both `apps/web` (server actions) and `apps/worker`
// (scheduled scans).
//
// All emit functions are designed to NEVER throw — failures are caught and
// logged so that domain operations are not blocked by notification problems.

import { and, eq, inArray } from 'drizzle-orm'
import { db as defaultDb, withSuperAdmin, withTenant, type Database } from '@beaconhs/db'
import { caAssignedEmail, caCompletedEmail, incidentReportedEmail } from '@beaconhs/emails'
import { enqueueEmail, enqueueNotification } from '@beaconhs/jobs'
import { resolveGroupUserIds } from './recipients'
import {
  complianceObligations,
  correctiveActions,
  documents,
  formResponses,
  formTemplates,
  incidents,
  people,
  roleAssignments,
  roles,
  tenantNotificationRecipients,
  tenantNotificationSettings,
  tenantUsers,
  tenants,
  trainingCourses,
  trainingRecords,
  users,
} from '@beaconhs/db/schema'

// --- Public context type --------------------------------------------------

/**
 * Minimal subset of RequestContext the dispatcher needs.
 * Web app passes its `RequestContext`; worker passes a synthesised one.
 *
 * `tenantId` is typed nullable to be assignment-compatible with the web
 * RequestContext (which is null on /admin / pre-tenant-selection pages). Each
 * emit function short-circuits if it sees null at runtime.
 */
export type EventCtx = {
  tenantId: string | null
  userId: string
  membership?: { id: string; displayName?: string | null } | null
  db: <T>(fn: (tx: Database) => Promise<T>) => Promise<T>
}

/** Build a worker-side EventCtx that runs in super-admin (bypass-RLS) mode. */
export function workerEventCtx(tenantId: string, userId = 'system'): EventCtx {
  return {
    tenantId,
    userId,
    membership: null,
    db: (fn) => withSuperAdmin(defaultDb, fn),
  }
}

// --- App URL helper -------------------------------------------------------

function appUrl(linkPath: string): string {
  // Same resolution order as the apps/web + apps/worker app-base-url helpers.
  const base = (
    process.env.PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    ''
  ).replace(/\/$/, '')
  return `${base}${linkPath}`
}

// --- Audience resolver ----------------------------------------------------

// Built-in audience when a tenant hasn't customised a category in
// /admin/notifications. Exported so the admin UI can pre-fill the role pickers
// with the same defaults the dispatcher falls back to.
// Only NATIVE, guaranteed-to-exist sources get a built-in category: the
// incidents module, corrective actions, and the compliance engine. Builder apps
// (lone worker, any monitored/custom app) route their alerts through Flows —
// they're per-tenant + dynamic, so they must NOT have hardcoded categories here.
export const DEFAULT_ROLES_BY_CATEGORY: Record<string, string[]> = {
  incident: ['safety_manager', 'tenant_admin'],
  ca: ['safety_manager', 'tenant_admin'],
  compliance: ['safety_manager', 'tenant_admin'],
  equipment: ['safety_manager', 'tenant_admin'],
}

/**
 * Resolve the audience (user ids) for an event in a tenant, honouring the
 * tenant's /admin/notifications configuration (tenant_notification_settings).
 *
 * Order:
 *   1. If a settings row exists and is disabled → nobody (the category is muted,
 *      including the `extra` reporter/assignee).
 *   2. Active members of the configured role keys (or the category default when
 *      none are configured), plus any hand-picked extra recipients.
 *   3. Legacy: if no settings row exists but tenant_notification_recipients does,
 *      those users replace the role-based audience (pre-settings behaviour).
 *
 * `extra` user ids (reporter, assignee, …) are merged in unless muted.
 */
async function resolveAudience(
  ctx: EventCtx,
  tenantId: string,
  category: string,
  extra: (string | null | undefined)[] = [],
): Promise<string[]> {
  const audience = new Set<string>()

  await ctx.db(async (tx) => {
    let settings: typeof tenantNotificationSettings.$inferSelect | null = null
    try {
      const [row] = await tx
        .select()
        .from(tenantNotificationSettings)
        .where(
          and(
            eq(tenantNotificationSettings.tenantId, tenantId),
            eq(tenantNotificationSettings.category, category),
          ),
        )
        .limit(1)
      settings = row ?? null
    } catch {
      // Table may not exist yet (pre-migration); fall through to defaults.
      settings = null
    }

    // Muted category → no audience at all.
    if (settings && settings.enabled === false) return

    for (const u of extra) if (u) audience.add(u)

    if (!settings) {
      // Legacy override layer: recipients replace the role-based audience.
      try {
        const custom = await tx
          .select({ userId: tenantNotificationRecipients.userId })
          .from(tenantNotificationRecipients)
          .where(
            and(
              eq(tenantNotificationRecipients.tenantId, tenantId),
              eq(tenantNotificationRecipients.category, category),
            ),
          )
        if (custom.length > 0) {
          for (const r of custom) audience.add(r.userId)
          return
        }
      } catch {
        // ignore — table may not exist yet
      }
    } else {
      for (const u of settings.userIds ?? []) audience.add(u)
    }

    // Reusable notification groups — resolved through the shared engine. An
    // independent audience source, so it runs even if no roles are configured.
    if (settings && Array.isArray(settings.groupIds) && settings.groupIds.length > 0) {
      for (const u of await resolveGroupUserIds(tx, tenantId, settings.groupIds)) audience.add(u)
    }

    // A saved row's roles are authoritative — an empty list means the admin
    // deliberately chose no role-based recipients (relying on the specific
    // people above). Defaults only apply when the tenant has never configured
    // this category.
    const roleKeys = settings
      ? settings.roleKeys
      : (DEFAULT_ROLES_BY_CATEGORY[category] ?? ['tenant_admin'])

    if (roleKeys.length === 0) return

    const rows = await tx
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
    for (const r of rows) audience.add(r.userId)
  })

  return Array.from(audience)
}

async function getTenant(ctx: EventCtx, tenantId: string): Promise<{ name: string } | null> {
  return ctx.db(async (tx) => {
    const [t] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    return t ?? null
  })
}

async function tenantUserToUserId(
  ctx: EventCtx,
  tenantId: string,
  tenantUserId: string,
): Promise<{ userId: string; displayName: string | null } | null> {
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        userId: tenantUsers.userId,
        displayName: tenantUsers.displayName,
      })
      .from(tenantUsers)
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.id, tenantUserId)))
      .limit(1)
    return row ?? null
  })
}

async function emailsForUserIds(
  ctx: EventCtx,
  tenantId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return []
  return ctx.db(async (tx) => {
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
    return rows.map((r) => r.email)
  })
}

function logFailure(scope: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  console.warn(`[events] ${scope} failed: ${msg}`)
}

// --- Incidents ------------------------------------------------------------

export async function emitIncidentReported(
  ctx: EventCtx,
  args: { incidentId: string },
): Promise<void> {
  const tenantId = ctx.tenantId
  if (!tenantId) return
  try {
    const incident = await ctx.db(async (tx) => {
      const [i] = await tx
        .select()
        .from(incidents)
        .where(eq(incidents.id, args.incidentId))
        .limit(1)
      return i ?? null
    })
    if (!incident) return

    const reporter = incident.reportedByTenantUserId
      ? await tenantUserToUserId(ctx, tenantId, incident.reportedByTenantUserId)
      : null

    const tenant = await getTenant(ctx, tenantId)
    if (!tenant) return

    const audience = await resolveAudience(ctx, tenantId, 'incident', [reporter?.userId])
    if (audience.length === 0) return

    const linkPath = `/incidents/${incident.id}`
    const url = appUrl(linkPath)
    const title = `Incident reported: ${incident.reference}`
    const body = `${incident.title} (severity: ${incident.severity})`

    await enqueueNotification({
      tenantId,
      userIds: audience,
      category: 'incident',
      type: 'incident.reported',
      title,
      body,
      linkPath,
      data: { incidentId: incident.id, severity: incident.severity },
      isCritical: incident.severity === 'fatality',
      channels: ['in_app', 'push'],
    })

    const recipients = await emailsForUserIds(ctx, tenantId, audience)
    if (recipients.length > 0) {
      const tpl = incidentReportedEmail({
        tenant,
        incident: {
          reference: incident.reference,
          title: incident.title,
          severity: incident.severity,
          summary: incident.description,
          location: incident.location,
        },
        reporter: reporter ? { displayName: reporter.displayName } : null,
        url,
      })
      await enqueueEmail({
        to: recipients,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        meta: { tenantId, category: 'incident' },
      })
    }
  } catch (err) {
    logFailure('emitIncidentReported', err)
  }
}

export async function emitIncidentStatusChanged(
  ctx: EventCtx,
  args: { incidentId: string; fromStatus: string; toStatus: string },
): Promise<void> {
  const tenantId = ctx.tenantId
  if (!tenantId) return
  try {
    const incident = await ctx.db(async (tx) => {
      const [i] = await tx
        .select()
        .from(incidents)
        .where(eq(incidents.id, args.incidentId))
        .limit(1)
      return i ?? null
    })
    if (!incident) return

    const reporter = incident.reportedByTenantUserId
      ? await tenantUserToUserId(ctx, tenantId, incident.reportedByTenantUserId)
      : null
    const investigator = incident.assignedInvestigatorTenantUserId
      ? await tenantUserToUserId(ctx, tenantId, incident.assignedInvestigatorTenantUserId)
      : null

    const audience = await resolveAudience(ctx, tenantId, 'incident', [
      reporter?.userId,
      investigator?.userId,
    ])
    if (audience.length === 0) return

    const linkPath = `/incidents/${incident.id}`
    const title = `Incident ${incident.reference} → ${args.toStatus.replace(/_/g, ' ')}`
    const body = `${incident.title}`

    await enqueueNotification({
      tenantId,
      userIds: audience,
      category: 'incident',
      type: 'incident.status_changed',
      title,
      body,
      linkPath,
      data: {
        incidentId: incident.id,
        fromStatus: args.fromStatus,
        toStatus: args.toStatus,
      },
    })
  } catch (err) {
    logFailure('emitIncidentStatusChanged', err)
  }
}

// --- Corrective actions ---------------------------------------------------

export async function emitCorrectiveActionAssigned(
  ctx: EventCtx,
  args: { caId: string; assigneeUserId?: string | null; assignerUserId?: string | null },
): Promise<void> {
  const tenantId = ctx.tenantId
  if (!tenantId) return
  try {
    const ca = await ctx.db(async (tx) => {
      const [c] = await tx
        .select()
        .from(correctiveActions)
        .where(eq(correctiveActions.id, args.caId))
        .limit(1)
      return c ?? null
    })
    if (!ca) return

    const tenant = await getTenant(ctx, tenantId)
    if (!tenant) return

    let assigneeUserId = args.assigneeUserId ?? null
    let assignerUserId = args.assignerUserId ?? null
    let assigner: { userId: string; displayName: string | null } | null = null

    if (!assigneeUserId && ca.ownerTenantUserId) {
      const a = await tenantUserToUserId(ctx, tenantId, ca.ownerTenantUserId)
      assigneeUserId = a?.userId ?? null
    }
    if (ca.assignedByTenantUserId) {
      assigner = await tenantUserToUserId(ctx, tenantId, ca.assignedByTenantUserId)
      if (!assignerUserId) assignerUserId = assigner?.userId ?? null
    }

    const audience = Array.from(
      new Set([assigneeUserId, assignerUserId].filter((u): u is string => !!u)),
    )
    if (audience.length === 0) return

    const linkPath = `/corrective-actions/${ca.id}`
    const url = appUrl(linkPath)
    const title = `Corrective action assigned: ${ca.reference}`
    const body = `${ca.title}${ca.dueOn ? ` (due ${ca.dueOn})` : ''}`

    await enqueueNotification({
      tenantId,
      userIds: audience,
      category: 'ca',
      type: 'ca.assigned',
      title,
      body,
      linkPath,
      data: { caId: ca.id, dueOn: ca.dueOn, severity: ca.severity },
      isCritical: ca.severity === 'critical',
      channels: ['in_app', 'push'],
    })

    const recipients = await emailsForUserIds(ctx, tenantId, audience)
    if (recipients.length > 0) {
      const tpl = caAssignedEmail({
        tenant,
        ca: {
          reference: ca.reference,
          title: ca.title,
          severity: ca.severity,
          dueOn: ca.dueOn,
          description: ca.description,
        },
        assigner: assigner ? { displayName: assigner.displayName } : null,
        url,
      })
      await enqueueEmail({
        to: recipients,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        meta: { tenantId, category: 'ca' },
      })
    }
  } catch (err) {
    logFailure('emitCorrectiveActionAssigned', err)
  }
}

export async function emitCorrectiveActionCompleted(
  ctx: EventCtx,
  args: { caId: string; completerUserId?: string | null },
): Promise<void> {
  const tenantId = ctx.tenantId
  if (!tenantId) return
  try {
    const ca = await ctx.db(async (tx) => {
      const [c] = await tx
        .select()
        .from(correctiveActions)
        .where(eq(correctiveActions.id, args.caId))
        .limit(1)
      return c ?? null
    })
    if (!ca) return

    const tenant = await getTenant(ctx, tenantId)
    if (!tenant) return

    let completer: { userId: string; displayName: string | null } | null = null
    if (args.completerUserId) {
      const completerUserId = args.completerUserId
      const [u] = await ctx.db((tx) =>
        tx
          .select({ id: users.id, name: users.name })
          .from(tenantUsers)
          .innerJoin(users, eq(users.id, tenantUsers.userId))
          .where(
            and(
              eq(tenantUsers.tenantId, tenantId),
              eq(tenantUsers.status, 'active'),
              eq(tenantUsers.userId, completerUserId),
            ),
          )
          .limit(1),
      )
      completer = u ? { userId: u.id, displayName: u.name } : null
    }

    const assigner = ca.assignedByTenantUserId
      ? await tenantUserToUserId(ctx, tenantId, ca.assignedByTenantUserId)
      : null
    const owner = ca.ownerTenantUserId
      ? await tenantUserToUserId(ctx, tenantId, ca.ownerTenantUserId)
      : null
    const verifier = ca.verifiedByTenantUserId
      ? await tenantUserToUserId(ctx, tenantId, ca.verifiedByTenantUserId)
      : null

    const audience = await resolveAudience(ctx, tenantId, 'ca', [
      assigner?.userId,
      owner?.userId,
      verifier?.userId,
    ])
    if (audience.length === 0) return

    const linkPath = `/corrective-actions/${ca.id}`
    const url = appUrl(linkPath)
    const title = `CA ${ca.reference}: ${ca.status.replace(/_/g, ' ')}`
    const body = ca.title

    await enqueueNotification({
      tenantId,
      userIds: audience,
      category: 'ca',
      type: 'ca.completed',
      title,
      body,
      linkPath,
      data: { caId: ca.id, status: ca.status },
    })

    const recipients = await emailsForUserIds(ctx, tenantId, audience)
    if (recipients.length > 0) {
      const tpl = caCompletedEmail({
        tenant,
        ca: { reference: ca.reference, title: ca.title, status: ca.status },
        completer: completer ? { displayName: completer.displayName } : null,
        url,
      })
      await enqueueEmail({
        to: recipients,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        meta: { tenantId, category: 'ca' },
      })
    }
  } catch (err) {
    logFailure('emitCorrectiveActionCompleted', err)
  }
}

// --- Compliance -----------------------------------------------------------

/** One state change of a single subject against an obligation. */
export type ComplianceTransitionEvent = {
  subjectKey: string
  personId: string | null
  // Direct login user to self-target when the subject is owned by a tenantUser
  // (e.g. a corrective action), bypassing the personId→people.userId bridge.
  userId?: string | null
  label: string
  to: 'completed' | 'overdue' | 'pending' | 'in_progress' | 'expiring'
  dueOn: string | null
}

/**
 * The unified detection emit: turns per-subject status transitions into
 * PERSON-TARGETED alerts. Each affected person hears about their own item; the
 * obligation's audience (safety managers/admins) gets a single rollup, not one
 * blast per subject. Fires only on the scan where the status actually changed,
 * so a still-overdue item doesn't re-spam every run.
 */
export async function emitComplianceTransitions(
  tenantId: string,
  obligationId: string,
  transitions: ComplianceTransitionEvent[],
): Promise<void> {
  const actionable = transitions.filter((t) => t.to === 'overdue' || t.to === 'expiring')
  if (actionable.length === 0) return
  const ctx = workerEventCtx(tenantId)
  try {
    const ob = await ctx.db(async (tx) => {
      const [o] = await tx
        .select()
        .from(complianceObligations)
        .where(eq(complianceObligations.id, obligationId))
        .limit(1)
      return o ?? null
    })
    if (!ob) return

    const linkPath = `/compliance/obligations/${ob.id}`
    const url = appUrl(linkPath)

    // Map the affected persons → their login user id, for self-targeting.
    const personIds = [...new Set(actionable.map((t) => t.personId).filter(Boolean))] as string[]
    const personUser = new Map<string, string>()
    if (personIds.length > 0) {
      const rows = await ctx.db((tx) =>
        tx
          .select({ id: people.id, userId: people.userId })
          .from(people)
          .where(and(eq(people.tenantId, tenantId), inArray(people.id, personIds))),
      )
      for (const r of rows) if (r.userId) personUser.set(r.id, r.userId)
    }

    // 1. Self-targeted alert to each affected person. Prefer an explicit login
    // user (record-owned subjects like CAs key on the owner's userId directly);
    // fall back to the person→user bridge for per_person obligations.
    for (const t of actionable) {
      const userId = t.userId ?? (t.personId ? personUser.get(t.personId) : null)
      if (!userId) continue
      const verb = t.to === 'overdue' ? 'is overdue' : 'is due soon'
      await enqueueNotification({
        tenantId,
        userIds: [userId],
        category: 'compliance',
        type: `compliance.${t.to}`,
        title: `${ob.title} ${verb}`,
        body: t.dueOn ? `Due ${t.dueOn}.` : 'Action required.',
        linkPath,
        data: { obligationId: ob.id, subjectKey: t.subjectKey, status: t.to, self: true },
      })
    }

    // 2. Single rollup to the obligation's audience (managers/admins).
    const audience = await resolveAudience(ctx, tenantId, 'compliance', [])
    if (audience.length > 0) {
      const overdue = actionable.filter((t) => t.to === 'overdue').length
      const expiring = actionable.filter((t) => t.to === 'expiring').length
      const parts: string[] = []
      if (overdue) parts.push(`${overdue} newly overdue`)
      if (expiring) parts.push(`${expiring} newly due soon`)
      const body = `${parts.join(' · ')}.`
      const title = `${ob.title}: ${parts.join(' · ')}`
      await enqueueNotification({
        tenantId,
        userIds: audience,
        category: 'compliance',
        type: 'compliance.rollup',
        title,
        body,
        linkPath,
        data: { obligationId: ob.id, overdue, expiring },
      })
      const recipients = await emailsForUserIds(ctx, tenantId, audience)
      if (recipients.length > 0) {
        const list = actionable
          .slice(0, 25)
          .map((t) => `<li>${t.label} — ${t.to}${t.dueOn ? ` (due ${t.dueOn})` : ''}</li>`)
          .join('')
        await enqueueEmail({
          to: recipients,
          subject: title,
          html: `<p>${body}</p><ul>${list}</ul><p><a href="${url}">View obligation</a></p>`,
          text: `${body}\n${url}`,
          meta: { tenantId, category: 'compliance' },
        })
      }
    }
  } catch (err) {
    logFailure('emitComplianceTransitions', err)
  }
}

// --- Equipment maintenance -------------------------------------------------

export type EquipmentMaintenanceDueEntry = {
  kind: 'inspection' | 'reminder'
  equipmentItemId: string
  itemName: string
  assetTag: string
  /** Schedule name (inspection type / label) or the reminder title. */
  title: string
  dueOn: string
  /** Reminder assignee — self-targeted like compliance per-person alerts. */
  assigneePersonId?: string | null
}

/**
 * Equipment maintenance becoming due/overdue: per-unit inspection schedules
 * and ad-hoc reminders surfaced by the maintenance scan. Mirrors
 * emitComplianceTransitions — reminder assignees get a self-targeted alert,
 * the tenant's `equipment` audience gets a single rollup + email pointing at
 * the maintenance cockpit. The scan only passes entries it hasn't alerted for
 * this due cycle, so a still-overdue item never re-spams.
 */
export async function emitEquipmentMaintenanceDue(
  tenantId: string,
  entries: EquipmentMaintenanceDueEntry[],
): Promise<void> {
  if (entries.length === 0) return
  const ctx = workerEventCtx(tenantId)
  try {
    // Map reminder assignees → their login user, for self-targeting.
    const personIds = [
      ...new Set(entries.map((e) => e.assigneePersonId).filter(Boolean)),
    ] as string[]
    const personUser = new Map<string, string>()
    if (personIds.length > 0) {
      const rows = await ctx.db((tx) =>
        tx
          .select({ id: people.id, userId: people.userId })
          .from(people)
          .where(and(eq(people.tenantId, tenantId), inArray(people.id, personIds))),
      )
      for (const r of rows) if (r.userId) personUser.set(r.id, r.userId)
    }

    // 1. Self-targeted alert per assigned reminder.
    for (const e of entries) {
      const userId = e.assigneePersonId ? personUser.get(e.assigneePersonId) : null
      if (!userId || e.kind !== 'reminder') continue
      await enqueueNotification({
        tenantId,
        userIds: [userId],
        category: 'equipment',
        type: 'equipment.reminder_due',
        title: `${e.title} is due`,
        body: `${e.itemName} (${e.assetTag}) — due ${e.dueOn}.`,
        linkPath: `/equipment/${e.equipmentItemId}?tab=inspections`,
        data: { equipmentItemId: e.equipmentItemId, dueOn: e.dueOn, self: true },
      })
    }

    // 2. Single rollup to the tenant's equipment audience.
    const audience = await resolveAudience(ctx, tenantId, 'equipment', [])
    if (audience.length > 0) {
      const inspections = entries.filter((e) => e.kind === 'inspection').length
      const reminders = entries.filter((e) => e.kind === 'reminder').length
      const parts: string[] = []
      if (inspections) parts.push(`${inspections} inspection${inspections === 1 ? '' : 's'}`)
      if (reminders) parts.push(`${reminders} reminder${reminders === 1 ? '' : 's'}`)
      const title = `Equipment maintenance due: ${parts.join(' · ')}`
      const linkPath = '/equipment/maintenance'
      const url = appUrl(linkPath)
      await enqueueNotification({
        tenantId,
        userIds: audience,
        category: 'equipment',
        type: 'equipment.maintenance_due',
        title,
        body: 'Open the maintenance cockpit for the full work list.',
        linkPath,
        data: { inspections, reminders },
      })
      const recipients = await emailsForUserIds(ctx, tenantId, audience)
      if (recipients.length > 0) {
        const list = entries
          .slice(0, 25)
          .map((e) => `<li>${e.itemName} (${e.assetTag}) — ${e.title}, due ${e.dueOn}</li>`)
          .join('')
        const more = entries.length > 25 ? `<p>…and ${entries.length - 25} more.</p>` : ''
        await enqueueEmail({
          to: recipients,
          subject: title,
          html: `<p>${title}.</p><ul>${list}</ul>${more}<p><a href="${url}">Open the maintenance cockpit</a></p>`,
          text: `${title}.\n${url}`,
          meta: { tenantId, category: 'equipment' },
        })
      }
    }
  } catch (err) {
    logFailure('emitEquipmentMaintenanceDue', err)
  }
}

// Notification-group resolution (groups → people / userIds / emails). Server-only.
export * from './recipients'
