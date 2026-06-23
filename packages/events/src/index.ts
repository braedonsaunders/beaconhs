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
  caOverdueEmail,
  documentReviewDueEmail,
  incidentReportedEmail,
  loneWorkerOverdueEmail,
  trainingExpiredEmail,
  trainingExpiringEmail,
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

const DEFAULT_ROLES_BY_CATEGORY: Record<string, string[]> = {
  incident: ['safety_manager', 'tenant_admin'],
  ca: ['safety_manager', 'tenant_admin'],
  training: ['safety_manager', 'tenant_admin'],
  document: ['safety_manager', 'tenant_admin'],
  lone_worker: ['safety_manager', 'tenant_admin'],
  compliance: ['safety_manager', 'tenant_admin'],
}

/**
 * Resolve the audience (user ids) for an event in a tenant.
 *
 * Order:
 *   1. Custom rows in tenant_notification_recipients for (tenantId, category) if present
 *   2. Otherwise: all active tenant_users in the tenant whose role keys match the
 *      default role list for the category
 *
 * `extra` user ids are always merged in (e.g. the reporter, assignee).
 */
async function resolveAudience(
  ctx: EventCtx,
  tenantId: string,
  category: string,
  extra: (string | null | undefined)[] = [],
): Promise<string[]> {
  const audience = new Set<string>()
  for (const u of extra) if (u) audience.add(u)

  await ctx.db(async (tx) => {
    let custom: { userId: string }[] = []
    try {
      custom = await tx
        .select({ userId: tenantNotificationRecipients.userId })
        .from(tenantNotificationRecipients)
        .where(
          and(
            eq(tenantNotificationRecipients.tenantId, tenantId),
            eq(tenantNotificationRecipients.category, category),
          ),
        )
    } catch {
      // Table may not exist yet (pre-migration); fall through.
      custom = []
    }

    if (custom.length > 0) {
      for (const r of custom) audience.add(r.userId)
      return
    }

    const roleKeys = DEFAULT_ROLES_BY_CATEGORY[category] ?? ['tenant_admin']
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

export async function emitCorrectiveActionOverdue(tenantId: string, caId: string): Promise<void> {
  const ctx = workerEventCtx(tenantId)
  try {
    const ca = await ctx.db(async (tx) => {
      const [c] = await tx
        .select()
        .from(correctiveActions)
        .where(eq(correctiveActions.id, caId))
        .limit(1)
      return c ?? null
    })
    if (!ca) return

    const tenant = await getTenant(ctx, tenantId)
    if (!tenant) return

    const owner = ca.ownerTenantUserId ? await tenantUserToUserId(ctx, ca.ownerTenantUserId) : null
    const assigner = ca.assignedByTenantUserId
      ? await tenantUserToUserId(ctx, ca.assignedByTenantUserId)
      : null

    const audience = await resolveAudience(ctx, tenantId, 'ca', [owner?.userId, assigner?.userId])
    if (audience.length === 0) return

    const linkPath = `/corrective-actions/${ca.id}`
    const url = appUrl(linkPath)

    await enqueueNotification({
      tenantId,
      userIds: audience,
      category: 'ca',
      type: 'ca.overdue',
      title: `Overdue: ${ca.reference}`,
      body: ca.title,
      linkPath,
      data: { caId: ca.id, dueOn: ca.dueOn },
      isCritical: ca.severity === 'critical',
    })

    const recipients = await emailsForUserIds(ctx, audience)
    if (recipients.length > 0) {
      const tpl = caOverdueEmail({
        tenant,
        ca: { reference: ca.reference, title: ca.title, dueOn: ca.dueOn },
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
    logFailure('emitCorrectiveActionOverdue', err)
  }
}

// --- Training -------------------------------------------------------------

async function loadTrainingForEvent(
  ctx: EventCtx,
  trainingRecordId: string,
): Promise<{
  record: typeof trainingRecords.$inferSelect
  courseName: string
  personName: string
} | null> {
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        record: trainingRecords,
        courseName: trainingCourses.name,
        firstName: people.firstName,
        lastName: people.lastName,
      })
      .from(trainingRecords)
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .where(eq(trainingRecords.id, trainingRecordId))
      .limit(1)
    if (!row) return null
    return {
      record: row.record,
      courseName: row.courseName,
      personName: `${row.firstName} ${row.lastName}`.trim(),
    }
  })
}

export async function emitTrainingExpiring(
  tenantId: string,
  trainingRecordId: string,
  daysToExpiry: number,
): Promise<void> {
  const ctx = workerEventCtx(tenantId)
  try {
    const data = await loadTrainingForEvent(ctx, trainingRecordId)
    if (!data || !data.record.expiresOn) return
    const tenant = await getTenant(ctx, tenantId)
    if (!tenant) return

    const audience = await resolveAudience(ctx, tenantId, 'training', [])
    if (audience.length === 0) return

    const linkPath = `/training/records/${data.record.id}`
    const url = appUrl(linkPath)
    const title = `Cert expires in ${daysToExpiry}d: ${data.personName} — ${data.courseName}`

    await enqueueNotification({
      tenantId,
      userIds: audience,
      category: 'training',
      type: 'training.expiring',
      title,
      body: `Expires on ${data.record.expiresOn}`,
      linkPath,
      data: { trainingRecordId: data.record.id, daysToExpiry },
    })

    const recipients = await emailsForUserIds(ctx, audience)
    if (recipients.length > 0) {
      const tpl = trainingExpiringEmail({
        tenant,
        person: { name: data.personName },
        training: { courseName: data.courseName, expiresOn: data.record.expiresOn },
        daysToExpiry,
        url,
      })
      await enqueueEmail({
        to: recipients,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        meta: { tenantId, category: 'training' },
      })
    }
  } catch (err) {
    logFailure('emitTrainingExpiring', err)
  }
}

export async function emitTrainingExpired(
  tenantId: string,
  trainingRecordId: string,
): Promise<void> {
  const ctx = workerEventCtx(tenantId)
  try {
    const data = await loadTrainingForEvent(ctx, trainingRecordId)
    if (!data || !data.record.expiresOn) return
    const tenant = await getTenant(ctx, tenantId)
    if (!tenant) return

    const audience = await resolveAudience(ctx, tenantId, 'training', [])
    if (audience.length === 0) return

    const linkPath = `/training/records/${data.record.id}`
    const url = appUrl(linkPath)
    const title = `EXPIRED: ${data.personName} — ${data.courseName}`

    await enqueueNotification({
      tenantId,
      userIds: audience,
      category: 'training',
      type: 'training.expired',
      title,
      body: `Expired on ${data.record.expiresOn}`,
      linkPath,
      data: { trainingRecordId: data.record.id },
      isCritical: true,
    })

    const recipients = await emailsForUserIds(ctx, audience)
    if (recipients.length > 0) {
      const tpl = trainingExpiredEmail({
        tenant,
        person: { name: data.personName },
        training: { courseName: data.courseName, expiresOn: data.record.expiresOn },
        url,
      })
      await enqueueEmail({
        to: recipients,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        meta: { tenantId, category: 'training' },
      })
    }
  } catch (err) {
    logFailure('emitTrainingExpired', err)
  }
}

// --- Documents ------------------------------------------------------------

export async function emitDocumentReviewDue(tenantId: string, documentId: string): Promise<void> {
  const ctx = workerEventCtx(tenantId)
  try {
    const document = await ctx.db(async (tx) => {
      const [d] = await tx.select().from(documents).where(eq(documents.id, documentId)).limit(1)
      return d ?? null
    })
    if (!document) return

    const tenant = await getTenant(ctx, tenantId)
    if (!tenant) return

    const owner = document.ownerTenantUserId
      ? await tenantUserToUserId(ctx, document.ownerTenantUserId)
      : null

    const audience = await resolveAudience(ctx, tenantId, 'document', [owner?.userId])
    if (audience.length === 0) return

    const linkPath = `/documents/${document.id}`
    const url = appUrl(linkPath)
    const title = `Document review due: ${document.title}`

    await enqueueNotification({
      tenantId,
      userIds: audience,
      category: 'document',
      type: 'document.review_due',
      title,
      body: `Next review${document.nextReviewOn ? `: ${document.nextReviewOn}` : ''}`,
      linkPath,
      data: { documentId: document.id, nextReviewOn: document.nextReviewOn },
    })

    const recipients = await emailsForUserIds(ctx, audience)
    if (recipients.length > 0) {
      const tpl = documentReviewDueEmail({
        tenant,
        document: {
          title: document.title,
          key: document.key,
          nextReviewOn: document.nextReviewOn,
        },
        url,
      })
      await enqueueEmail({
        to: recipients,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        meta: { tenantId, category: 'document' },
      })
    }
  } catch (err) {
    logFailure('emitDocumentReviewDue', err)
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

/** Generic obligation-overdue reminder, emitted by the compliance_scan worker. */
export async function emitComplianceObligationOverdue(
  tenantId: string,
  obligationId: string,
  overdueCount: number,
): Promise<void> {
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

    const tenant = await getTenant(ctx, tenantId)
    if (!tenant) return

    const audience = await resolveAudience(ctx, tenantId, 'compliance', [])
    if (audience.length === 0) return

    const linkPath = `/compliance/obligations/${ob.id}`
    const url = appUrl(linkPath)
    const title = `Compliance overdue: ${ob.title}`
    const body = `${overdueCount} subject${overdueCount === 1 ? '' : 's'} overdue or expiring.`

    await enqueueNotification({
      tenantId,
      userIds: audience,
      category: 'compliance',
      type: 'compliance.obligation_overdue',
      title,
      body,
      linkPath,
      data: { obligationId: ob.id, overdueCount },
    })

    const recipients = await emailsForUserIds(ctx, audience)
    if (recipients.length > 0) {
      await enqueueEmail({
        to: recipients,
        subject: title,
        html: `<p>${body}</p><p><a href="${url}">View obligation</a></p>`,
        text: `${body}\n${url}`,
        meta: { tenantId, category: 'compliance' },
      })
    }
  } catch (err) {
    logFailure('emitComplianceObligationOverdue', err)
  }
}
