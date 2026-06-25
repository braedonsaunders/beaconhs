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
import {
  caAssignedEmail,
  caCompletedEmail,
  incidentReportedEmail,
  loneWorkerOverdueEmail,
} from '@beaconhs/emails'
import { enqueueEmail, enqueueNotification } from '@beaconhs/jobs'
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
  const base = process.env.APP_URL ?? ''
  return `${base}${linkPath}`
}

// --- Audience resolver ----------------------------------------------------

// Built-in audience when a tenant hasn't customised a category in
// /admin/notifications. Exported so the admin UI can pre-fill the role pickers
// with the same defaults the dispatcher falls back to.
export const DEFAULT_ROLES_BY_CATEGORY: Record<string, string[]> = {
  incident: ['safety_manager', 'tenant_admin'],
  ca: ['safety_manager', 'tenant_admin'],
  training: ['safety_manager', 'tenant_admin'],
  document: ['safety_manager', 'tenant_admin'],
  lone_worker: ['safety_manager', 'tenant_admin'],
  compliance: ['safety_manager', 'tenant_admin'],
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
  tenantUserId: string,
): Promise<{ userId: string; displayName: string | null } | null> {
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        userId: tenantUsers.userId,
        displayName: tenantUsers.displayName,
      })
      .from(tenantUsers)
      .where(eq(tenantUsers.id, tenantUserId))
      .limit(1)
    return row ?? null
  })
}

async function emailsForUserIds(ctx: EventCtx, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return []
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ email: users.email })
      .from(users)
      .where(inArray(users.id, userIds))
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
      ? await tenantUserToUserId(ctx, incident.reportedByTenantUserId)
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

    const recipients = await emailsForUserIds(ctx, audience)
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
      ? await tenantUserToUserId(ctx, incident.reportedByTenantUserId)
      : null
    const investigator = incident.assignedInvestigatorTenantUserId
      ? await tenantUserToUserId(ctx, incident.assignedInvestigatorTenantUserId)
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
      const a = await tenantUserToUserId(ctx, ca.ownerTenantUserId)
      assigneeUserId = a?.userId ?? null
    }
    if (ca.assignedByTenantUserId) {
      assigner = await tenantUserToUserId(ctx, ca.assignedByTenantUserId)
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

    const recipients = await emailsForUserIds(ctx, audience)
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
          .from(users)
          .where(eq(users.id, completerUserId))
          .limit(1),
      )
      completer = u ? { userId: u.id, displayName: u.name } : null
    }

    const assigner = ca.assignedByTenantUserId
      ? await tenantUserToUserId(ctx, ca.assignedByTenantUserId)
      : null
    const owner = ca.ownerTenantUserId ? await tenantUserToUserId(ctx, ca.ownerTenantUserId) : null
    const verifier = ca.verifiedByTenantUserId
      ? await tenantUserToUserId(ctx, ca.verifiedByTenantUserId)
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

    const recipients = await emailsForUserIds(ctx, audience)
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

// --- Monitored sessions (Lone Worker + any monitored Builder app) --------

/**
 * Overdue escalation for a monitored-session response — the generic engine that
 * powers Lone Worker and any future monitored app (permit timers, periodic
 * checks…). Fired by the worker's `form_session_overdue_scan` once a session
 * passes `nextCheckinDueAt + grace`, keyed off a `form_response`. Reuses the
 * `lone_worker` audience category + recipient overrides. Never throws.
 */
export async function emitMonitoredSessionOverdue(
  tenantId: string,
  responseId: string,
): Promise<void> {
  const ctx = workerEventCtx(tenantId)
  try {
    const res = await ctx.db(async (tx) => {
      const [r] = await tx
        .select({
          id: formResponses.id,
          templateId: formResponses.templateId,
          nextCheckinDueAt: formResponses.nextCheckinDueAt,
          startedAt: formResponses.createdAt,
        })
        .from(formResponses)
        .where(eq(formResponses.id, responseId))
        .limit(1)
      return r ?? null
    })
    if (!res) return

    const tenant = await getTenant(ctx, tenantId)
    if (!tenant) return

    const tmpl = await ctx.db(async (tx) => {
      const [t] = await tx
        .select({ name: formTemplates.name })
        .from(formTemplates)
        .where(eq(formTemplates.id, res.templateId))
        .limit(1)
      return t ?? null
    })
    const appName = tmpl?.name ?? 'Monitored session'

    // Role-based safety net (safety_manager / tenant_admin or the tenant's
    // configured 'lone_worker' recipients). Per-session supervisor targeting is
    // layered on by the app in a later phase.
    const audience = await resolveAudience(ctx, tenantId, 'lone_worker')
    if (audience.length === 0) return

    const linkPath = `/apps/responses/${res.id}`
    const url = appUrl(linkPath)
    const dueAt = res.nextCheckinDueAt ?? new Date()
    const title = `CRITICAL: ${appName} — check-in overdue`

    await enqueueNotification({
      tenantId,
      userIds: audience,
      category: 'lone_worker',
      type: 'monitored_session.overdue',
      title,
      body: `Check-in was due at ${dueAt.toISOString()}`,
      linkPath,
      data: { responseId: res.id, templateId: res.templateId },
      isCritical: true,
      channels: ['in_app', 'email', 'push', 'sms'],
    })

    const recipients = await emailsForUserIds(ctx, audience)
    if (recipients.length > 0) {
      const tpl = loneWorkerOverdueEmail({
        tenant,
        session: { task: appName, startedAt: res.startedAt, nextCheckinDueAt: dueAt },
        worker: { name: appName },
        url,
      })
      await enqueueEmail({
        to: recipients,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        meta: { tenantId, category: 'lone_worker' },
      })
    }
  } catch (err) {
    logFailure('emitMonitoredSessionOverdue', err)
  }
}

// --- Compliance -----------------------------------------------------------

/** One state change of a single subject against an obligation. */
export type ComplianceTransitionEvent = {
  subjectKey: string
  personId: string | null
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

    // 1. Self-targeted alert to each affected person.
    for (const t of actionable) {
      const userId = t.personId ? personUser.get(t.personId) : null
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
      const recipients = await emailsForUserIds(ctx, audience)
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
