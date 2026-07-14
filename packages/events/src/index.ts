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
// Request mutations write notification/integration effects to the canonical
// domain-event outbox in the same transaction. This module publishes those
// effects only from retryable worker paths with deterministic queue job IDs.

import { and, eq, inArray, isNull } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { db as defaultDb, withSuperAdmin, type Database } from '@beaconhs/db'
import { caAssignedEmail, caCompletedEmail, incidentReportedEmail } from '@beaconhs/emails'
import { enqueueEmail, enqueueNotification } from '@beaconhs/jobs'
import { resolveNotificationAudienceUserIds } from './recipients'
import { complianceRollupEmailHtml, maintenanceRollupEmailHtml } from './email-html'
import {
  complianceDispatches,
  complianceObligations,
  correctiveActions,
  incidents,
  people,
  tenantUsers,
  tenants,
  users,
  type DomainNotificationEvent,
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
export { DEFAULT_ROLES_BY_CATEGORY } from './recipients'

/**
 * Resolve the audience (user ids) for an event in a tenant, honouring the
 * tenant's /admin/notifications configuration (tenant_notification_settings).
 *
 * `extra` user ids (reporter, assignee, …) are merged in unless muted.
 */
async function resolveAudience(
  ctx: EventCtx,
  tenantId: string,
  category: string,
  extra: (string | null | undefined)[] = [],
): Promise<string[]> {
  return ctx.db((tx) =>
    resolveNotificationAudienceUserIds(
      tx,
      tenantId,
      category,
      extra.filter((userId): userId is string => Boolean(userId)),
    ),
  )
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

function stableJobId(prefix: string, key: string): string {
  return `${prefix}|${createHash('sha256').update(key).digest('hex')}`
}

/** Deliver the notification side of one durable domain-event outbox row. */
export async function deliverDomainNotification(
  tenantId: string,
  sourceEventId: string,
  event: DomainNotificationEvent,
): Promise<void> {
  const ctx = workerEventCtx(tenantId)
  switch (event.kind) {
    case 'incident_reported': {
      const incident = await ctx.db(async (tx) => {
        const [row] = await tx
          .select()
          .from(incidents)
          .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, event.incidentId)))
          .limit(1)
        return row ?? null
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
      await enqueueNotification(
        {
          tenantId,
          userIds: audience,
          category: 'incident',
          type: 'incident.reported',
          title: `Incident reported: ${incident.reference}`,
          body: `${incident.title} (severity: ${incident.severity})`,
          linkPath,
          data: { incidentId: incident.id, severity: incident.severity },
          isCritical: incident.severity === 'fatality',
          channels: ['in_app', 'push'],
        },
        { jobId: stableJobId('domain-notification', `${sourceEventId}\0incident`) },
      )
      const recipients = await emailsForUserIds(ctx, tenantId, audience)
      if (recipients.length > 0) {
        const template = incidentReportedEmail({
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
        await enqueueEmail(
          {
            to: recipients,
            subject: template.subject,
            html: template.html,
            text: template.text,
            meta: { tenantId, category: 'incident' },
          },
          { jobId: stableJobId('domain-email', `${sourceEventId}\0incident`) },
        )
      }
      return
    }
    case 'incident_status_changed': {
      const incident = await ctx.db(async (tx) => {
        const [row] = await tx
          .select()
          .from(incidents)
          .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, event.incidentId)))
          .limit(1)
        return row ?? null
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
      await enqueueNotification(
        {
          tenantId,
          userIds: audience,
          category: 'incident',
          type: 'incident.status_changed',
          title: `Incident ${incident.reference} → ${event.toStatus.replace(/_/g, ' ')}`,
          body: incident.title,
          linkPath: `/incidents/${incident.id}`,
          data: {
            incidentId: incident.id,
            fromStatus: event.fromStatus,
            toStatus: event.toStatus,
          },
        },
        { jobId: stableJobId('domain-notification', `${sourceEventId}\0incident-status`) },
      )
      return
    }
    case 'corrective_action_assigned': {
      const ca = await ctx.db(async (tx) => {
        const [row] = await tx
          .select()
          .from(correctiveActions)
          .where(
            and(eq(correctiveActions.tenantId, tenantId), eq(correctiveActions.id, event.caId)),
          )
          .limit(1)
        return row ?? null
      })
      if (!ca) return
      const tenant = await getTenant(ctx, tenantId)
      if (!tenant) return
      let assigneeUserId = event.assigneeUserId ?? null
      let assignerUserId = event.assignerUserId ?? null
      let assigner: { userId: string; displayName: string | null } | null = null
      if (!assigneeUserId && ca.ownerTenantUserId) {
        assigneeUserId =
          (await tenantUserToUserId(ctx, tenantId, ca.ownerTenantUserId))?.userId ?? null
      }
      if (ca.assignedByTenantUserId) {
        assigner = await tenantUserToUserId(ctx, tenantId, ca.assignedByTenantUserId)
        assignerUserId ??= assigner?.userId ?? null
      }
      const audience = [...new Set([assigneeUserId, assignerUserId].filter(Boolean))] as string[]
      if (audience.length === 0) return
      const linkPath = `/corrective-actions/${ca.id}`
      const url = appUrl(linkPath)
      await enqueueNotification(
        {
          tenantId,
          userIds: audience,
          category: 'ca',
          type: 'ca.assigned',
          title: `Corrective action assigned: ${ca.reference}`,
          body: `${ca.title}${ca.dueOn ? ` (due ${ca.dueOn})` : ''}`,
          linkPath,
          data: { caId: ca.id, dueOn: ca.dueOn, severity: ca.severity },
          isCritical: ca.severity === 'critical',
          channels: ['in_app', 'push'],
        },
        { jobId: stableJobId('domain-notification', `${sourceEventId}\0ca-assigned`) },
      )
      const recipients = await emailsForUserIds(ctx, tenantId, audience)
      if (recipients.length > 0) {
        const template = caAssignedEmail({
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
        await enqueueEmail(
          {
            to: recipients,
            subject: template.subject,
            html: template.html,
            text: template.text,
            meta: { tenantId, category: 'ca' },
          },
          { jobId: stableJobId('domain-email', `${sourceEventId}\0ca-assigned`) },
        )
      }
      return
    }
    case 'corrective_action_completed': {
      const ca = await ctx.db(async (tx) => {
        const [row] = await tx
          .select()
          .from(correctiveActions)
          .where(
            and(eq(correctiveActions.tenantId, tenantId), eq(correctiveActions.id, event.caId)),
          )
          .limit(1)
        return row ?? null
      })
      if (!ca) return
      const tenant = await getTenant(ctx, tenantId)
      if (!tenant) return
      let completer: { userId: string; displayName: string | null } | null = null
      if (event.completerUserId) {
        const [user] = await ctx.db((tx) =>
          tx
            .select({ id: users.id, name: users.name })
            .from(tenantUsers)
            .innerJoin(users, eq(users.id, tenantUsers.userId))
            .where(
              and(
                eq(tenantUsers.tenantId, tenantId),
                eq(tenantUsers.status, 'active'),
                eq(tenantUsers.userId, event.completerUserId!),
              ),
            )
            .limit(1),
        )
        completer = user ? { userId: user.id, displayName: user.name } : null
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
      await enqueueNotification(
        {
          tenantId,
          userIds: audience,
          category: 'ca',
          type: 'ca.completed',
          title: `CA ${ca.reference}: ${ca.status.replace(/_/g, ' ')}`,
          body: ca.title,
          linkPath,
          data: { caId: ca.id, status: ca.status },
        },
        { jobId: stableJobId('domain-notification', `${sourceEventId}\0ca-completed`) },
      )
      const recipients = await emailsForUserIds(ctx, tenantId, audience)
      if (recipients.length > 0) {
        const template = caCompletedEmail({
          tenant,
          ca: { reference: ca.reference, title: ca.title, status: ca.status },
          completer: completer ? { displayName: completer.displayName } : null,
          url,
        })
        await enqueueEmail(
          {
            to: recipients,
            subject: template.subject,
            html: template.html,
            text: template.text,
            meta: { tenantId, category: 'ca' },
          },
          { jobId: stableJobId('domain-email', `${sourceEventId}\0ca-completed`) },
        )
      }
      return
    }
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
  dispatchId: string,
  publishLeaseId: string,
  publicationTx?: Database,
): Promise<boolean> {
  // The compliance publisher supplies its existing transaction so all reads
  // share the obligation/dispatch locks held through queue publication. The
  // fallback keeps direct callers and focused tests backwards compatible.
  const ctx: EventCtx = publicationTx
    ? {
        tenantId,
        userId: 'system',
        membership: null,
        db: (run) => run(publicationTx),
      }
    : workerEventCtx(tenantId)
  const ob = await ctx.db(async (tx) => {
    const [o] = await tx
      .select({
        id: complianceObligations.id,
        title: complianceObligations.title,
        sourceModule: complianceObligations.sourceModule,
        targetRef: complianceObligations.targetRef,
      })
      .from(complianceObligations)
      .innerJoin(
        complianceDispatches,
        and(
          eq(complianceDispatches.tenantId, complianceObligations.tenantId),
          eq(complianceDispatches.obligationId, complianceObligations.id),
        ),
      )
      .where(
        and(
          eq(complianceObligations.tenantId, tenantId),
          eq(complianceObligations.id, obligationId),
          eq(complianceObligations.status, 'active'),
          isNull(complianceObligations.deletedAt),
          eq(complianceDispatches.tenantId, tenantId),
          eq(complianceDispatches.id, dispatchId),
          eq(complianceDispatches.obligationId, obligationId),
          eq(complianceDispatches.status, 'queued'),
          eq(complianceDispatches.publishLeaseId, publishLeaseId),
        ),
      )
      .limit(1)
    return o ?? null
  })
  if (!ob) return false

  const actionable = transitions.filter(
    (transition) =>
      transition.to === 'overdue' ||
      transition.to === 'expiring' ||
      (ob.sourceModule === 'form' && transition.to === 'pending'),
  )
  if (actionable.length === 0) return false
  const managerActionable = actionable.filter(
    (transition) => transition.to === 'overdue' || transition.to === 'expiring',
  )

  const linkPath = `/compliance/obligations/${ob.id}`
  const url = appUrl(linkPath)
  const selfLinkPath =
    ob.sourceModule === 'form' && ob.targetRef?.formTemplateId
      ? `/apps/templates/${ob.targetRef.formTemplateId}/fill?obligationId=${ob.id}`
      : linkPath

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
    const verb = t.to === 'overdue' ? 'is overdue' : t.to === 'pending' ? 'is ready' : 'is due soon'
    await enqueueNotification(
      {
        tenantId,
        userIds: [userId],
        category: 'compliance',
        type: `compliance.${t.to}`,
        title: `${ob.title} ${verb}`,
        body: t.dueOn ? `Due ${t.dueOn}.` : 'Action required.',
        linkPath: selfLinkPath,
        data: { obligationId: ob.id, subjectKey: t.subjectKey, status: t.to, self: true },
      },
      { jobId: stableJobId('compliance-self', `${dispatchId}\0${t.subjectKey}\0${t.to}`) },
    )
  }

  // 2. Single rollup to the obligation's audience (managers/admins).
  const audience = await resolveAudience(ctx, tenantId, 'compliance', [])
  if (audience.length > 0 && managerActionable.length > 0) {
    const overdue = managerActionable.filter((t) => t.to === 'overdue').length
    const expiring = managerActionable.filter((t) => t.to === 'expiring').length
    const parts: string[] = []
    if (overdue) parts.push(`${overdue} newly overdue`)
    if (expiring) parts.push(`${expiring} newly due soon`)
    const body = `${parts.join(' · ')}.`
    const title = `${ob.title}: ${parts.join(' · ')}`
    await enqueueNotification(
      {
        tenantId,
        userIds: audience,
        category: 'compliance',
        type: 'compliance.rollup',
        title,
        body,
        linkPath,
        data: { obligationId: ob.id, overdue, expiring },
      },
      { jobId: stableJobId('compliance-rollup', dispatchId) },
    )
    const recipients = await emailsForUserIds(ctx, tenantId, audience)
    if (recipients.length > 0) {
      await enqueueEmail(
        {
          to: recipients,
          subject: title,
          html: complianceRollupEmailHtml({ body, entries: managerActionable, url }),
          text: `${body}\n${url}`,
          meta: { tenantId, category: 'compliance' },
        },
        { jobId: stableJobId('compliance-email', dispatchId) },
      )
    }
  }
  return true
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
  deliveryKey: string,
): Promise<void> {
  if (entries.length === 0) return
  const ctx = workerEventCtx(tenantId)
  // Map reminder assignees → their login user, for self-targeting.
  const personIds = [...new Set(entries.map((e) => e.assigneePersonId).filter(Boolean))] as string[]
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
    await enqueueNotification(
      {
        tenantId,
        userIds: [userId],
        category: 'equipment',
        type: 'equipment.reminder_due',
        title: `${e.title} is due`,
        body: `${e.itemName} (${e.assetTag}) — due ${e.dueOn}.`,
        linkPath: `/equipment/${e.equipmentItemId}?tab=inspections`,
        data: { equipmentItemId: e.equipmentItemId, dueOn: e.dueOn, self: true },
      },
      {
        jobId: stableJobId(
          'equipment-reminder',
          `${deliveryKey}\0${e.equipmentItemId}\0${e.dueOn}\0${e.title}`,
        ),
      },
    )
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
    await enqueueNotification(
      {
        tenantId,
        userIds: audience,
        category: 'equipment',
        type: 'equipment.maintenance_due',
        title,
        body: 'Open the maintenance cockpit for the full work list.',
        linkPath,
        data: { inspections, reminders },
      },
      { jobId: stableJobId('equipment-rollup', deliveryKey) },
    )
    const recipients = await emailsForUserIds(ctx, tenantId, audience)
    if (recipients.length > 0) {
      await enqueueEmail(
        {
          to: recipients,
          subject: title,
          html: maintenanceRollupEmailHtml({ title, entries, url }),
          text: `${title}.\n${url}`,
          meta: { tenantId, category: 'equipment' },
        },
        { jobId: stableJobId('equipment-email', deliveryKey) },
      )
    }
  }
}

// Notification-group resolution (groups → people / userIds / emails). Server-only.
export * from './recipients'
export * from './outbox'
export * from './internal-auth'
