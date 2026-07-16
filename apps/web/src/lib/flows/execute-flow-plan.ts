import 'server-only'

// The ONE Flows executor — subject-agnostic. Runs a planned graph (actions +
// gates) against any FlowSubjectAdapter (forms today, native modules too). The
// generic actions (send_email / notify_role / set_field / flag / webhook) and
// recipient/assignee resolution live here; everything record-specific is an
// adapter call. Durable executions checkpoint each completed node; failures are
// returned to the caller so its domain-event outbox can retry from that node.

import { and, eq, inArray, isNull } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import {
  evaluateLogicRule,
  resolveDefaultValue,
  type AssigneeTarget,
  type AutomationPlan,
  type EmailTarget,
  type EvalContext,
} from '@beaconhs/forms-core'
import { db, withSuperAdmin } from '@beaconhs/db'
import {
  domainEventEffects,
  complianceAudience,
  complianceObligations,
  customerContacts,
  people,
  personGroupMemberships,
  roleAssignments,
  roles,
  tenants,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { resolveGroupEmails, resolveGroupUserIds } from '@beaconhs/events'
import { resolveObligationAudience } from '@beaconhs/compliance'
import { secureFetch } from '@beaconhs/sync/egress'
import {
  interpolate,
  renderEmail,
  renderTemplate,
  type RenderableEmail,
} from '@beaconhs/email-render'
import {
  loadTenantPdfTemplate,
  resolveSubjectDefaultPdfTemplate,
  type PdfTemplateRenderConfig,
} from '@/lib/pdf-templates'
import { loadTenantEmailTemplate } from '@/lib/email-templates'
import { appBaseUrl } from '@/lib/app-base-url'
import { recordAudit } from '@/lib/audit'
import { buildRecordSummaryPdfJob } from './pdf-summary'
import { recordFlowGate } from './gate-store'
import type { FlowActorRef, FlowSubjectAdapter } from './types'
import { describeFlowWebhookError } from './webhook-policy'
import { renderSpreadsheetAttachments } from './spreadsheet-attachments'

export async function executeFlowPlan(
  ctx: RequestContext,
  adapter: FlowSubjectAdapter,
  params: {
    flowId: string
    plan: AutomationPlan
    values: Record<string, unknown>
    executionId?: string
  },
): Promise<{ ran: string[]; failed: string[] }> {
  const { flowId, plan } = params
  // Strip inherited properties and materialize special keys (including
  // "__proto__") as ordinary own data properties before any flow lookup.
  const values = Object.fromEntries(Object.entries(params.values))
  const evalCtx: EvalContext = { values, rows: {}, entities: {} }
  const ran: string[] = []
  const failed: string[] = []
  const completedEffects = new Set<string>()
  if (params.executionId) {
    const rows = await ctx.db((tx) =>
      tx
        .select({ effectKey: domainEventEffects.effectKey })
        .from(domainEventEffects)
        .where(eq(domainEventEffects.eventId, params.executionId!)),
    )
    for (const row of rows) completedEffects.add(row.effectKey)
  }
  const markEffectComplete = async (
    effectKey: string,
    detail: Record<string, unknown>,
  ): Promise<void> => {
    if (!params.executionId) return
    await ctx.db((tx) =>
      tx
        .insert(domainEventEffects)
        .values({
          tenantId: ctx.tenantId,
          eventId: params.executionId!,
          effectKey,
          detail,
        })
        .onConflictDoNothing(),
    )
    completedEffects.add(effectKey)
  }
  const jobId = (nodeId: string, effect: string): string | undefined =>
    params.executionId
      ? `flow|${createHash('sha256')
          .update(`${params.executionId}\0${flowId}\0${nodeId}\0${effect}`)
          .digest('hex')}`
      : undefined

  // --- Lazy, cached resolvers (generic) ----------------------------------

  let submitter: FlowActorRef | undefined
  const getSubmitter = async () => {
    if (!submitter) submitter = await adapter.resolveSubmitter()
    return submitter
  }

  const roleCache = new Map<
    string,
    { userId: string; email: string | null; tenantUserId: string }[]
  >()
  const getRoleUsers = async (roleKey: string) => {
    if (!roleKey) return []
    const cached = roleCache.get(roleKey)
    if (cached) return cached
    const rows = await ctx.db((tx) =>
      tx
        .select({ userId: tenantUsers.userId, email: users.email, tenantUserId: tenantUsers.id })
        .from(tenantUsers)
        .innerJoin(roleAssignments, eq(roleAssignments.tenantUserId, tenantUsers.id))
        .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
        .innerJoin(users, eq(users.id, tenantUsers.userId))
        .where(
          and(
            eq(tenantUsers.tenantId, ctx.tenantId),
            eq(tenantUsers.status, 'active'),
            eq(roles.key, roleKey),
          ),
        ),
    )
    roleCache.set(roleKey, rows)
    return rows
  }

  const verifyTenantUser = async (id: string): Promise<string | null> => {
    const [r] = await ctx.db((tx) =>
      tx
        .select({ id: tenantUsers.id })
        .from(tenantUsers)
        .where(and(eq(tenantUsers.id, id), eq(tenantUsers.tenantId, ctx.tenantId)))
        .limit(1),
    )
    return r?.id ?? null
  }

  // person id → best email (people.email, else the linked user's email). Some
  // subject fields of kind 'person' hold a tenant_users id instead (e.g. a
  // record's owner/inspector), so miss falls through to that lookup.
  const personEmail = async (personId: string): Promise<string | null> => {
    const [p] = await ctx.db((tx) =>
      tx
        .select({ email: people.email, userId: people.userId })
        .from(people)
        .where(eq(people.id, personId))
        .limit(1),
    )
    if (p) {
      if (p.email && p.email.includes('@')) return p.email.trim()
      if (p.userId) {
        const [u] = await ctx.db((tx) =>
          tx.select({ email: users.email }).from(users).where(eq(users.id, p.userId!)).limit(1),
        )
        return u?.email ?? null
      }
      return null
    }
    const [tu] = await ctx.db((tx) =>
      tx
        .select({ email: users.email })
        .from(tenantUsers)
        .innerJoin(users, eq(users.id, tenantUsers.userId))
        .where(and(eq(tenantUsers.id, personId), eq(tenantUsers.tenantId, ctx.tenantId)))
        .limit(1),
    )
    return tu?.email ?? null
  }

  const fieldIds = (field: string): string[] => {
    const raw = values[field]
    const candidates = Array.isArray(raw) ? raw : [raw]
    const ids = new Set<string>()
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue
      for (const value of candidate.split(/[,;\s]+/)) {
        const normalized = value.trim()
        if (normalized) ids.add(normalized)
      }
    }
    return [...ids]
  }

  const personIdentity = async (
    personOrTenantUserId: string,
  ): Promise<{ personId: string; departmentId: string | null; userId: string | null } | null> => {
    const [direct] = await ctx.db((tx) =>
      tx
        .select({ id: people.id, departmentId: people.departmentId, userId: people.userId })
        .from(people)
        .where(
          and(
            eq(people.tenantId, ctx.tenantId),
            eq(people.id, personOrTenantUserId),
            isNull(people.deletedAt),
          ),
        )
        .limit(1),
    )
    if (direct) {
      return { personId: direct.id, departmentId: direct.departmentId, userId: direct.userId }
    }
    const [throughMember] = await ctx.db((tx) =>
      tx
        .select({ id: people.id, departmentId: people.departmentId, userId: people.userId })
        .from(tenantUsers)
        .innerJoin(people, eq(people.userId, tenantUsers.userId))
        .where(
          and(
            eq(tenantUsers.tenantId, ctx.tenantId),
            eq(tenantUsers.id, personOrTenantUserId),
            eq(people.tenantId, ctx.tenantId),
            isNull(people.deletedAt),
          ),
        )
        .limit(1),
    )
    return throughMember
      ? {
          personId: throughMember.id,
          departmentId: throughMember.departmentId,
          userId: throughMember.userId,
        }
      : null
  }

  const scopedPersonGroupMembers = async (
    groupId: string,
    personField: string,
  ): Promise<Array<{ personId: string; userId: string | null }>> => {
    const identities = await Promise.all(fieldIds(personField).map(personIdentity))
    const departmentIds = [
      ...new Set(
        identities
          .map((identity) => identity?.departmentId)
          .filter((id): id is string => Boolean(id)),
      ),
    ]
    if (departmentIds.length === 0) return []
    return ctx.db((tx) =>
      tx
        .selectDistinct({ personId: people.id, userId: people.userId })
        .from(personGroupMemberships)
        .innerJoin(people, eq(people.id, personGroupMemberships.personId))
        .where(
          and(
            eq(personGroupMemberships.tenantId, ctx.tenantId),
            eq(personGroupMemberships.groupId, groupId),
            eq(people.tenantId, ctx.tenantId),
            eq(people.status, 'active'),
            inArray(people.departmentId, departmentIds),
            isNull(people.deletedAt),
          ),
        ),
    )
  }

  const recordPersonManagerIds = async (personField: string): Promise<string[]> => {
    const identities = await Promise.all(fieldIds(personField).map(personIdentity))
    const personIds = [
      ...new Set(
        identities.map((identity) => identity?.personId).filter((id): id is string => Boolean(id)),
      ),
    ]
    if (personIds.length === 0) return []
    const managers = await ctx.db((tx) =>
      tx
        .selectDistinct({ managerPersonId: people.managerPersonId })
        .from(people)
        .where(
          and(
            eq(people.tenantId, ctx.tenantId),
            inArray(people.id, personIds),
            isNull(people.deletedAt),
          ),
        ),
    )
    return managers
      .map((manager) => manager.managerPersonId)
      .filter((id): id is string => Boolean(id))
  }

  const complianceRecipientApplies = async (
    obligationId: string,
    personField: string,
  ): Promise<boolean> => {
    const subjectIdentities = await Promise.all(fieldIds(personField).map(personIdentity))
    const subjectPersonIds = new Set(
      subjectIdentities
        .map((identity) => identity?.personId)
        .filter((id): id is string => Boolean(id)),
    )
    if (subjectPersonIds.size === 0) return false
    return ctx.db(async (tx) => {
      const [obligation] = await tx
        .select({ id: complianceObligations.id })
        .from(complianceObligations)
        .where(
          and(
            eq(complianceObligations.tenantId, ctx.tenantId),
            eq(complianceObligations.id, obligationId),
            eq(complianceObligations.status, 'active'),
            isNull(complianceObligations.deletedAt),
          ),
        )
        .limit(1)
      if (!obligation) return false
      const audience = await tx
        .select({ kind: complianceAudience.kind, entityKey: complianceAudience.entityKey })
        .from(complianceAudience)
        .where(
          and(
            eq(complianceAudience.tenantId, ctx.tenantId),
            eq(complianceAudience.obligationId, obligationId),
          ),
        )
      const members = await resolveObligationAudience(tx, ctx.tenantId, audience)
      return members.some((member) => subjectPersonIds.has(member.personId))
    })
  }

  const resolveEmails = async (targets: EmailTarget[]): Promise<string[]> => {
    const out = new Set<string>()
    const add = (e: string | null | undefined) => {
      const v = e?.trim()
      if (v && v.includes('@')) out.add(v)
    }
    for (const t of targets) {
      if (t.type === 'literal') {
        // One address OR a comma/semicolon/space-separated list.
        for (const part of t.email.split(/[,;\s]+/)) add(part)
      } else if (t.type === 'submitter') {
        add((await getSubmitter()).email)
      } else if (t.type === 'role') {
        for (const u of await getRoleUsers(t.role)) add(u.email)
      } else if (t.type === 'field') {
        const v = values[t.field]
        if (typeof v === 'string' && v.trim()) {
          if (v.includes('@')) {
            // One address OR a comma/semicolon/space-separated list (e.g. a
            // subject's `attendee_emails` roster field).
            for (const part of v.split(/[,;\s]+/)) add(part)
          } else {
            // Not an address — resolve one or more person / tenant-user ids.
            for (const id of fieldIds(t.field)) {
              const identity = await personIdentity(id)
              if (identity) add(await personEmail(identity.personId))
            }
          }
        }
      } else if (t.type === 'person') {
        add(await personEmail(t.personId))
      } else if (t.type === 'submitter_manager') {
        const s = await getSubmitter()
        if (s.userId) {
          const [self] = await ctx.db((tx) =>
            tx
              .select({ mgr: people.managerPersonId })
              .from(people)
              .where(eq(people.userId, s.userId!))
              .limit(1),
          )
          if (self?.mgr) add(await personEmail(self.mgr))
        }
      } else if (t.type === 'record_person_manager') {
        for (const managerPersonId of await recordPersonManagerIds(t.personField)) {
          add(await personEmail(managerPersonId))
        }
      } else if (t.type === 'department_manager') {
        const mgrs = await ctx.db((tx) =>
          tx
            .selectDistinct({ mgr: people.managerPersonId })
            .from(people)
            .where(and(eq(people.departmentId, t.departmentId), isNull(people.deletedAt))),
        )
        for (const m of mgrs) if (m.mgr) add(await personEmail(m.mgr))
      } else if (t.type === 'person_group') {
        // The single reusable People group system.
        const emails = await ctx.db((tx) => resolveGroupEmails(tx, ctx.tenantId, [t.groupId]))
        for (const e of emails) add(e)
      } else if (t.type === 'person_group_for_record_person') {
        for (const member of await scopedPersonGroupMembers(t.groupId, t.personField)) {
          add(await personEmail(member.personId))
        }
      } else if (t.type === 'org_unit_contact') {
        const orgUnitIds = fieldIds(t.orgUnitField)
        if (orgUnitIds.length > 0) {
          const [contact] = await ctx.db((tx) =>
            tx
              .select({ email: customerContacts.email })
              .from(customerContacts)
              .where(
                and(
                  eq(customerContacts.tenantId, ctx.tenantId),
                  eq(customerContacts.id, t.contactId),
                  inArray(customerContacts.orgUnitId, orgUnitIds),
                ),
              )
              .limit(1),
          )
          add(contact?.email)
        }
      } else if (t.type === 'compliance_recipient') {
        if (await complianceRecipientApplies(t.obligationId, t.personField)) {
          if (t.recipient.type === 'person') add(await personEmail(t.recipient.personId))
          else for (const part of t.recipient.email.split(/[,;\s]+/)) add(part)
        }
      }
    }
    return Array.from(out)
  }

  // Map a person to their linked Better-Auth user id (for non-email channels).
  const personUserId = async (personId: string): Promise<string | null> => {
    const [p] = await ctx.db((tx) =>
      tx.select({ userId: people.userId }).from(people).where(eq(people.id, personId)).limit(1),
    )
    return p?.userId ?? null
  }

  // The user-id counterpart of resolveEmails, for SMS / in-app channels (which
  // address people by user, not email). literal/field targets are email-only
  // and have no user mapping, so they're skipped here.
  const resolveUserIds = async (targets: EmailTarget[]): Promise<string[]> => {
    const out = new Set<string>()
    const add = (u: string | null | undefined) => {
      if (u) out.add(u)
    }
    for (const t of targets) {
      if (t.type === 'submitter') {
        add((await getSubmitter()).userId)
      } else if (t.type === 'role') {
        for (const u of await getRoleUsers(t.role)) add(u.userId)
      } else if (t.type === 'person') {
        add(await personUserId(t.personId))
      } else if (t.type === 'field') {
        for (const id of fieldIds(t.field)) add((await personIdentity(id))?.userId)
      } else if (t.type === 'person_group') {
        for (const u of await ctx.db((tx) => resolveGroupUserIds(tx, ctx.tenantId, [t.groupId])))
          add(u)
      } else if (t.type === 'submitter_manager') {
        const s = await getSubmitter()
        if (s.userId) {
          const [self] = await ctx.db((tx) =>
            tx
              .select({ mgr: people.managerPersonId })
              .from(people)
              .where(eq(people.userId, s.userId!))
              .limit(1),
          )
          if (self?.mgr) add(await personUserId(self.mgr))
        }
      } else if (t.type === 'record_person_manager') {
        for (const managerPersonId of await recordPersonManagerIds(t.personField)) {
          add(await personUserId(managerPersonId))
        }
      } else if (t.type === 'department_manager') {
        const mgrs = await ctx.db((tx) =>
          tx
            .selectDistinct({ mgr: people.managerPersonId })
            .from(people)
            .where(and(eq(people.departmentId, t.departmentId), isNull(people.deletedAt))),
        )
        for (const m of mgrs) if (m.mgr) add(await personUserId(m.mgr))
      } else if (t.type === 'person_group_for_record_person') {
        for (const member of await scopedPersonGroupMembers(t.groupId, t.personField)) {
          add(member.userId)
        }
      } else if (t.type === 'compliance_recipient') {
        if (
          t.recipient.type === 'person' &&
          (await complianceRecipientApplies(t.obligationId, t.personField))
        ) {
          add(await personUserId(t.recipient.personId))
        }
      }
    }
    return Array.from(out)
  }

  const resolveAssignee = async (t: AssigneeTarget): Promise<string | null> => {
    if (t.type === 'submitter') return (await getSubmitter()).tenantUserId
    if (t.type === 'role') return (await getRoleUsers(t.role))[0]?.tenantUserId ?? null
    if (t.type === 'literal') return verifyTenantUser(t.userId)
    if (t.type === 'field') {
      const v = values[t.field]
      return typeof v === 'string' && v ? verifyTenantUser(v) : null
    }
    return null
  }

  // --- Execute actions ----------------------------------------------------

  const fieldPatch = new Map<string, unknown>()
  const setField = (field: string, value: unknown): void => {
    fieldPatch.set(field, value)
    // defineProperty has data-property semantics for every field name; unlike
    // bracket assignment on a normal object, "__proto__" cannot mutate the
    // record prototype. Graph validation separately limits writable fields.
    Object.defineProperty(values, field, {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    })
  }
  let flagReason: string | null | undefined

  const { enqueueEmail, enqueueNotification, enqueuePdfEmail } = await import('@beaconhs/jobs')

  // Inline flow emails carry the tenant's name in the shell and a "View
  // record" button to the subject's page. Both resolved once per run.
  const appBase = appBaseUrl()
  let tenantNameCache: string | null | undefined
  const tenantName = async (): Promise<string | null> => {
    if (tenantNameCache !== undefined) return tenantNameCache
    tenantNameCache = await withSuperAdmin(db, async (tx) => {
      const [t] = await tx
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1)
      return t?.name ?? null
    }).catch(() => null)
    return tenantNameCache
  }

  for (const { nodeId, action } of plan.actionNodes) {
    const actionEffectKey = `${flowId}:action:${nodeId}`
    const durableExecutionKey = params.executionId
      ? `${params.executionId}:${actionEffectKey}`
      : undefined
    if (completedEffects.has(actionEffectKey)) continue
    const failedBefore = failed.length
    try {
      switch (action.action) {
        case 'create_capa': {
          if (!adapter.spawnCorrectiveAction) {
            failed.push('create_capa (unsupported)')
            break
          }
          const dueOn =
            action.dueInDays != null
              ? new Date(Date.now() + action.dueInDays * 86_400_000).toISOString().slice(0, 10)
              : null
          const res = await adapter.spawnCorrectiveAction({
            title: interpolate(action.titleTemplate, values) || 'Action from form',
            description: action.descriptionTemplate
              ? interpolate(action.descriptionTemplate, values)
              : null,
            severity: action.severity,
            dueOn,
            flowExecutionKey: durableExecutionKey,
          })
          if (!res.ok) failed.push('create_capa (failed)')
          else ran.push('create_capa')
          break
        }
        case 'create_incident': {
          if (!adapter.spawnIncident) {
            failed.push('create_incident (unsupported)')
            break
          }
          const res = await adapter.spawnIncident({
            title: interpolate(action.titleTemplate, values) || 'Incident from form',
            flowExecutionKey: durableExecutionKey,
          })
          if (!res.ok) failed.push('create_incident (failed)')
          else ran.push('create_incident')
          break
        }
        case 'send_email': {
          const channel = action.channel ?? 'email'
          const mode = action.mode ?? 'inline'
          let spec: RenderableEmail
          if (mode === 'template' && action.templateId) {
            const tpl = await loadTenantEmailTemplate(ctx, action.templateId)
            if (!tpl || !tpl.isActive) {
              failed.push('send_email (template missing)')
              break
            }
            spec = {
              mode: 'template',
              subjectTemplate: action.subjectOverride || tpl.subjectTemplate,
              compiledHtml: tpl.compiledHtml,
            }
          } else if (mode === 'design' && action.compiledHtml) {
            spec = {
              mode: 'design',
              subjectTemplate: action.subjectTemplate ?? '',
              compiledHtml: action.compiledHtml,
            }
          } else {
            spec = {
              mode: 'inline',
              subject: action.subject ?? 'Notification',
              bodyTemplate: action.bodyTemplate ?? '',
              cta: { url: `${appBase}${adapter.deepLink()}`, label: 'View record' },
              brandName: (await tenantName()) ?? undefined,
            }
          }
          const { subject, html, text } = renderEmail(spec, values)

          // SMS / in-app channels address people by user (not email): resolve to
          // user ids and post a notification the worker fans out on that channel.
          // SMS is critical by design (cost) so it bypasses digest/quiet-hours.
          if (channel === 'sms' || channel === 'in_app') {
            const userIds = await resolveUserIds(action.to)
            if (userIds.length === 0) {
              failed.push(`send_email:${channel} (no users)`)
              break
            }
            await enqueueNotification(
              {
                tenantId: ctx.tenantId,
                userIds,
                category: adapter.notifyCategory,
                type: 'flow.send',
                title: subject,
                body: text,
                channels: [channel],
                isCritical: channel === 'sms',
              },
              jobId(nodeId, `send-${channel}`)
                ? { jobId: jobId(nodeId, `send-${channel}`) }
                : undefined,
            )
            ran.push(`send_email:${channel}→${userIds.length}`)
            break
          }

          const to = await resolveEmails(action.to)
          if (to.length === 0) {
            failed.push('send_email (no recipients)')
            break
          }
          const spreadsheetConfigs = (action.spreadsheetAttachments ?? []).filter(
            (attachment) => !attachment.when || evaluateLogicRule(attachment.when, evalCtx),
          )
          const spreadsheetAttachments = await renderSpreadsheetAttachments(
            ctx,
            spreadsheetConfigs,
            values,
          )
          if (action.attachPdf) {
            const refForFile = values.reference
            const fileBase =
              typeof refForFile === 'string' && refForFile.trim() ? refForFile : 'record'
            const pdfFilename = `${fileBase.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60)}.pdf`
            const emailPayload = {
              to,
              subject,
              html,
              text,
              filename: pdfFilename,
              category: adapter.notifyCategory,
              tenantId: ctx.tenantId,
              attachments: spreadsheetAttachments,
            }
            // Resolve the PDF DOCUMENT template: the flow's explicit pick, else
            // (unless the flow forces the field summary) the subject's assigned
            // default — the module default or the form's own template.
            let tpl: PdfTemplateRenderConfig | null = action.pdfTemplateId
              ? await loadTenantPdfTemplate(ctx, action.pdfTemplateId)
              : null
            if (!tpl && action.pdfFormat !== 'summary') {
              tpl = await resolveSubjectDefaultPdfTemplate(ctx, adapter)
            }
            if (tpl) {
              // Merge here (cheap) and hand the worker pre-rendered HTML + page
              // setup to print. {{page}}/{{pages}} are preserved for the printer.
              const headerVals = { ...values, page: '{{page}}', pages: '{{pages}}' }
              await enqueuePdfEmail(
                {
                  kind: 'template_pdf',
                  tenantId: ctx.tenantId,
                  html: renderTemplate(tpl.compiledHtml, values, { escapeHtml: true }),
                  paperSize: tpl.paperSize,
                  orientation: tpl.orientation,
                  marginMm: tpl.marginMm,
                  headerHtml: tpl.headerHtml
                    ? renderTemplate(tpl.headerHtml, headerVals, { escapeHtml: false })
                    : null,
                  footerHtml: tpl.footerHtml
                    ? renderTemplate(tpl.footerHtml, headerVals, { escapeHtml: false })
                    : null,
                  entityType: adapter.auditEntityType,
                  entityId: adapter.subjectId,
                  filename: pdfFilename,
                },
                emailPayload,
                jobId(nodeId, 'pdf-email'),
              )
              ran.push(`send_email+pdfdoc→${to.length}`)
              break
            }
            // No template ⇒ the generic field-summary PDF, rendered in the
            // worker then emailed (non-blocking — the submit never waits on
            // Chromium).
            const pdfJob =
              adapter.pdfJob?.(values) ??
              buildRecordSummaryPdfJob({
                tenantId: ctx.tenantId,
                subjectId: adapter.subjectId,
                entityType: adapter.auditEntityType,
                heading: adapter.auditEntityType
                  .replace(/_/g, ' ')
                  .replace(/\b\w/g, (c) => c.toUpperCase()),
                reference: values.reference,
                subtitle: values.title,
                values,
              })
            await enqueuePdfEmail(pdfJob, emailPayload, jobId(nodeId, 'pdf-email'))
            ran.push(`send_email+pdf→${to.length}`)
            break
          }
          await enqueueEmail(
            {
              to,
              subject,
              text,
              html,
              attachments: spreadsheetAttachments,
              meta: { tenantId: ctx.tenantId, category: adapter.notifyCategory },
            },
            jobId(nodeId, 'email') ? { jobId: jobId(nodeId, 'email') } : undefined,
          )
          ran.push(`send_email→${to.length}`)
          break
        }
        case 'notify_role': {
          const usersForRole = await getRoleUsers(action.role)
          const userIds = usersForRole.map((u) => u.userId)
          if (userIds.length === 0) {
            failed.push('notify_role (no users)')
            break
          }
          await enqueueNotification(
            {
              tenantId: ctx.tenantId,
              userIds,
              category: adapter.notifyCategory,
              type: 'flow.notify',
              title: interpolate(action.message, values) || 'Notification',
              channels:
                action.channel === 'email'
                  ? ['email']
                  : action.channel === 'sms'
                    ? ['sms']
                    : ['in_app'],
              isCritical: action.channel === 'sms',
            },
            jobId(nodeId, 'notify') ? { jobId: jobId(nodeId, 'notify') } : undefined,
          )
          ran.push(`notify_role→${userIds.length}`)
          break
        }
        case 'set_field': {
          const v = resolveDefaultValue(action.value, evalCtx)
          setField(action.field, v)
          ran.push('set_field')
          break
        }
        case 'flag_non_compliant': {
          flagReason = action.reason ?? null
          ran.push('flag_non_compliant')
          break
        }
        case 'webhook': {
          const payload = JSON.stringify(values)
          const res = await secureFetch(action.url, {
            method: action.method,
            headers: {
              'content-type': 'application/json',
              ...(params.executionId ? { 'idempotency-key': jobId(nodeId, 'webhook')! } : {}),
            },
            body: payload,
            timeoutMs: 8_000,
            maxRequestBytes: 2 * 1024 * 1024,
            maxResponseBytes: 64 * 1024,
            maxRedirects: 2,
          })
          if (!res.ok) throw new Error(`Webhook returned HTTP ${res.status}`)
          ran.push('webhook')
          break
        }
        default: {
          // create_response | analyze_photos | start_monitored_session — subject-specific.
          const r = await adapter.handleExtraAction?.(action, {
            values,
            setField,
            evalCtx,
            executionKey: durableExecutionKey,
          })
          if (r) {
            ran.push(...r.ran)
            failed.push(...r.failed)
          } else {
            failed.push(`${(action as { action: string }).action} (unsupported)`)
          }
        }
      }
      if (failed.length === failedBefore) {
        if (fieldPatch.size > 0 || flagReason !== undefined) {
          if (!adapter.persistAfterRun) throw new Error('Flow subject cannot persist field changes')
          await adapter.persistAfterRun({
            fieldPatch: Object.fromEntries(fieldPatch),
            flagNonCompliant: flagReason !== undefined,
          })
          fieldPatch.clear()
          flagReason = undefined
        }
        await markEffectComplete(actionEffectKey, { action: action.action })
      } else {
        break
      }
    } catch (error) {
      if (action.action === 'webhook') {
        const detail = describeFlowWebhookError(error)
        failed.push(`webhook (${detail})`)
        await recordAudit(ctx, {
          entityType: adapter.auditEntityType,
          entityId: adapter.subjectId,
          action: 'update',
          dedupKey: params.executionId
            ? `domain:${params.executionId}:flow-webhook-failed:${flowId}:${nodeId}`
            : undefined,
          summary: `Flow webhook failed: ${detail}`,
          metadata: { flowId, nodeId },
        })
      } else {
        failed.push(`${action.action} (error)`)
      }
      break
    }
  }

  // Gates → pending approvals. Resolving one (from the record's detail page)
  // resumes the chosen branch via planFromGate → executeFlowPlan.
  for (const { nodeId, gate } of plan.gates) {
    const gateEffectKey = `${flowId}:gate:${nodeId}`
    if (completedEffects.has(gateEffectKey)) continue
    try {
      const assignee = await resolveAssignee(gate.assignee)
      await recordFlowGate(ctx, {
        subjectType: adapter.subjectType,
        subjectKey: adapter.subjectKey,
        subjectId: adapter.subjectId,
        flowId,
        nodeId,
        title: gate.title,
        assigneeTenantUserId: assignee,
        signatureRequired: !!gate.signatureRequired,
        executionId: params.executionId,
      })
      if (assignee) {
        const [u] = await ctx.db((tx) =>
          tx
            .select({ userId: tenantUsers.userId })
            .from(tenantUsers)
            .where(eq(tenantUsers.id, assignee))
            .limit(1),
        )
        if (u?.userId) {
          await enqueueNotification(
            {
              tenantId: ctx.tenantId,
              userIds: [u.userId],
              category: adapter.notifyCategory,
              type: 'flow.approval',
              title: `Approval needed: ${gate.title}`,
              linkPath: adapter.deepLink(),
              channels: ['in_app'],
            },
            jobId(nodeId, 'gate-notification')
              ? { jobId: jobId(nodeId, 'gate-notification') }
              : undefined,
          )
        }
      }
      await markEffectComplete(gateEffectKey, { gate: gate.title })
      ran.push('gate')
    } catch {
      failed.push('gate (error)')
      break
    }
  }

  return { ran, failed }
}
