import 'server-only'

// The ONE Flows executor — subject-agnostic. Runs a planned graph (actions +
// gates) against any FlowSubjectAdapter (forms today, native modules too). The
// generic actions (send_email / notify_role / set_field / flag / webhook) and
// recipient/assignee resolution live here; everything record-specific is an
// adapter call. Fully guarded: a Flow must NEVER break a submit/save, so every
// action is individually try/caught and the whole run is best-effort.

import { and, eq } from 'drizzle-orm'
import {
  resolveDefaultValue,
  type AssigneeTarget,
  type AutomationPlan,
  type EmailTarget,
  type EvalContext,
} from '@beaconhs/forms-core'
import { roleAssignments, roles, tenantUsers, users } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { interpolate, renderEmail, type RenderableEmail } from '@beaconhs/email-render'
import { loadTenantEmailTemplate } from '@/lib/email-templates'
import { recordFlowGate } from './gate-store'
import type { FlowActorRef, FlowSubjectAdapter } from './types'

export async function executeFlowPlan(
  ctx: RequestContext,
  adapter: FlowSubjectAdapter,
  params: { flowId: string; plan: AutomationPlan; values: Record<string, unknown> },
): Promise<{ ran: string[]; failed: string[] }> {
  const { flowId, plan, values } = params
  const evalCtx: EvalContext = { values, rows: {}, entities: {} }
  const ran: string[] = []
  const failed: string[] = []

  // --- Lazy, cached resolvers (generic) ----------------------------------

  let submitter: FlowActorRef | undefined
  const getSubmitter = async () => {
    if (!submitter) submitter = await adapter.resolveSubmitter()
    return submitter
  }

  const roleCache = new Map<string, { userId: string; email: string | null; tenantUserId: string }[]>()
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

  const resolveEmails = async (targets: EmailTarget[]): Promise<string[]> => {
    const out = new Set<string>()
    for (const t of targets) {
      if (t.type === 'literal') {
        if (t.email.includes('@')) out.add(t.email.trim())
      } else if (t.type === 'submitter') {
        const s = await getSubmitter()
        if (s.email) out.add(s.email)
      } else if (t.type === 'role') {
        for (const u of await getRoleUsers(t.role)) if (u.email) out.add(u.email)
      } else if (t.type === 'field') {
        const v = values[t.field]
        if (typeof v === 'string' && v.includes('@')) out.add(v.trim())
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

  const fieldPatch: Record<string, unknown> = {}
  let flagReason: string | null | undefined

  const { enqueueEmail, enqueueNotification } = await import('@beaconhs/jobs')

  for (const action of plan.actions) {
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
          })
          ran.push(res.ok ? 'create_capa' : 'create_capa (failed)')
          break
        }
        case 'create_incident': {
          if (!adapter.spawnIncident) {
            failed.push('create_incident (unsupported)')
            break
          }
          const res = await adapter.spawnIncident({
            title: interpolate(action.titleTemplate, values) || 'Incident from form',
          })
          ran.push(res.ok ? 'create_incident' : 'create_incident (failed)')
          break
        }
        case 'send_email': {
          const to = await resolveEmails(action.to)
          if (to.length === 0) {
            failed.push('send_email (no recipients)')
            break
          }
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
            }
          }
          const { subject, html, text } = renderEmail(spec, values)
          await enqueueEmail({
            to,
            subject,
            text,
            html,
            meta: { tenantId: ctx.tenantId, category: adapter.notifyCategory },
          })
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
          await enqueueNotification({
            tenantId: ctx.tenantId,
            userIds,
            category: adapter.notifyCategory,
            type: 'flow.notify',
            title: interpolate(action.message, values) || 'Notification',
            channels: action.channel === 'email' ? ['email'] : ['in_app'],
          })
          ran.push(`notify_role→${userIds.length}`)
          break
        }
        case 'set_field': {
          const v = resolveDefaultValue(action.value, evalCtx)
          fieldPatch[action.field] = v
          values[action.field] = v // visible to later nodes
          ran.push('set_field')
          break
        }
        case 'flag_non_compliant': {
          flagReason = action.reason ?? null
          ran.push('flag_non_compliant')
          break
        }
        case 'webhook': {
          const payload = action.bodyTemplate
            ? interpolate(action.bodyTemplate, values)
            : JSON.stringify(values)
          const res = await fetch(action.url, {
            method: action.method,
            headers: { 'content-type': 'application/json', ...(action.headers ?? {}) },
            body: payload,
            signal: AbortSignal.timeout(8000),
          })
          ran.push(res.ok ? 'webhook' : `webhook (${res.status})`)
          break
        }
        default: {
          // create_response | analyze_photos | start_monitored_session — subject-specific.
          const r = await adapter.handleExtraAction?.(action, { values, fieldPatch, evalCtx })
          if (r) {
            ran.push(...r.ran)
            failed.push(...r.failed)
          } else {
            failed.push(`${(action as { action: string }).action} (unsupported)`)
          }
        }
      }
    } catch {
      failed.push(`${action.action} (error)`)
    }
  }

  // Persist set_field + flag_non_compliant (subjects that support write-back).
  if (Object.keys(fieldPatch).length > 0 || flagReason !== undefined) {
    try {
      await adapter.persistAfterRun?.({ fieldPatch, flagNonCompliant: flagReason !== undefined })
    } catch {
      failed.push('persist (error)')
    }
  }

  // Gates → pending approvals. Resolving one (from the record's detail page)
  // resumes the chosen branch via planFromGate → executeFlowPlan.
  for (const { nodeId, gate } of plan.gates) {
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
          await enqueueNotification({
            tenantId: ctx.tenantId,
            userIds: [u.userId],
            category: adapter.notifyCategory,
            type: 'flow.approval',
            title: `Approval needed: ${gate.title}`,
            linkPath: adapter.deepLink(),
            channels: ['in_app'],
          })
        }
      }
      ran.push('gate')
    } catch {
      failed.push('gate (error)')
    }
  }

  return { ran, failed }
}
