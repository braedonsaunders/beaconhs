import 'server-only'

// Runtime for a template's Flows. Loads ALL enabled form_automations graphs,
// plans each trigger (conditions evaluated against the submitted data + the
// compliance verdict), and dispatches the resulting actions + human gates
// through the EXISTING primitives. Fully guarded: a Flow must NEVER break a
// submit, so every step is individually try/caught and the whole run is
// best-effort.
//
// `executeFlowPlan` is the shared executor reused by both on_submit and the
// gate-resume path (apps/web/.../responses/[id]/_flow-gate-actions.ts).
//
// Actions: create_capa / create_incident (reuse spawn primitives),
// send_email / notify_role (recipient resolution → jobs queues), set_field +
// flag_non_compliant (patched back onto the response), webhook (outbound) and
// create_response (spawn a draft of another App). Gates create pending
// form_response_steps rows (stepKey `gate:{flowId}:{nodeId}`) assigned to the
// resolved approver; the Flow-approvals panel drives them and resumes the
// downstream branch.

import { and, desc, eq } from 'drizzle-orm'
import {
  planAutomation,
  resolveDefaultValue,
  type AssigneeTarget,
  type AutomationPlan,
  type EmailTarget,
} from '@beaconhs/forms-core'
import {
  formAutomations,
  formResponseSteps,
  formResponses,
  formTemplateVersions,
  roleAssignments,
  roles,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import {
  createCorrectiveActionFromResponse,
  createIncidentFromResponse,
} from '@/app/(app)/forms/responses/[id]/_spawn-actions'
import { analyzePhotoAttachments } from '@/app/(app)/forms/_lib/analyze-photos'

// Pull attachment ids out of a photo / photo_upload (AttachedFile[]) or photo_ai
// ({ attachments: AttachedFile[] }) field value.
function attachmentIdsFromValue(raw: unknown): string[] {
  const pick = (arr: unknown[]) =>
    arr
      .map((x) => (x && typeof x === 'object' ? (x as { attachmentId?: string }).attachmentId : null))
      .filter((x): x is string => !!x)
  if (Array.isArray(raw)) return pick(raw)
  if (raw && typeof raw === 'object') {
    const atts = (raw as { attachments?: unknown }).attachments
    if (Array.isArray(atts)) return pick(atts)
  }
  return []
}

const SEVERITY_ORDER: Record<string, number> = { low: 1, medium: 2, high: 3 }

// {{field_id}} token interpolation against the response values.
function interpolate(tpl: string, values: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => {
    const v = values[k]
    return v == null ? '' : String(v)
  })
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function gateKeyOf(flowId: string, nodeId: string): string {
  return `gate:${flowId}:${nodeId}`
}

/**
 * Execute a planned Flow (actions + gates) against a response. Shared by the
 * on_submit runner and the gate-resume action. Best-effort + guarded; returns a
 * summary for the caller to audit. NEVER throws.
 */
export async function executeFlowPlan(
  ctx: RequestContext,
  params: {
    responseId: string
    flowId: string
    plan: AutomationPlan
    values: Record<string, unknown>
  },
): Promise<{ ran: string[]; failed: string[] }> {
  const { responseId, flowId, plan, values } = params
  const evalCtx = { values, rows: {}, entities: {} }
  const ran: string[] = []
  const failed: string[] = []

  // --- Lazy, cached resolvers --------------------------------------------

  let submitter: { tenantUserId: string | null; email: string | null; userId: string | null } | undefined
  const getSubmitter = async () => {
    if (submitter) return submitter
    const [r] = await ctx.db((tx) =>
      tx
        .select({ tuid: formResponses.submittedBy })
        .from(formResponses)
        .where(eq(formResponses.id, responseId))
        .limit(1),
    )
    let email: string | null = null
    let userId: string | null = null
    const tuid = r?.tuid ?? null
    if (tuid) {
      const [u] = await ctx.db((tx) =>
        tx
          .select({ email: users.email, userId: users.id })
          .from(tenantUsers)
          .innerJoin(users, eq(users.id, tenantUsers.userId))
          .where(eq(tenantUsers.id, tuid))
          .limit(1),
      )
      email = u?.email ?? null
      userId = u?.userId ?? null
    }
    submitter = { tenantUserId: r?.tuid ?? null, email, userId }
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

  // Resolve an approver to a tenant_users.id (the FK on form_response_steps).
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
          const dueOn =
            action.dueInDays != null
              ? new Date(Date.now() + action.dueInDays * 86_400_000).toISOString().slice(0, 10)
              : null
          const res = await createCorrectiveActionFromResponse({
            responseId,
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
          const res = await createIncidentFromResponse({
            responseId,
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
          const subject = interpolate(action.subject, values) || 'Notification'
          const body = interpolate(action.bodyTemplate, values)
          await enqueueEmail({
            to,
            subject,
            text: body,
            html: `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:680px;white-space:pre-wrap;">${esc(
              body,
            )}</div>`,
            meta: { tenantId: ctx.tenantId, category: 'forms' },
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
            category: 'forms',
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
        case 'create_response': {
          const [ver] = await ctx.db((tx) =>
            tx
              .select({ id: formTemplateVersions.id })
              .from(formTemplateVersions)
              .where(eq(formTemplateVersions.templateId, action.templateId))
              .orderBy(desc(formTemplateVersions.version))
              .limit(1),
          )
          if (!ver) {
            failed.push('create_response (no version)')
            break
          }
          const data: Record<string, unknown> = {}
          if (action.prefill) {
            for (const [k, expr] of Object.entries(action.prefill)) {
              data[k] = resolveDefaultValue(expr, evalCtx)
            }
          }
          await ctx.db((tx) =>
            tx.insert(formResponses).values({
              tenantId: ctx.tenantId,
              templateId: action.templateId,
              templateVersionId: ver.id,
              status: 'draft',
              data,
            }),
          )
          ran.push('create_response')
          break
        }
        case 'analyze_photos': {
          const attIds = attachmentIdsFromValue(values[action.fieldId])
          if (attIds.length === 0) {
            failed.push('analyze_photos (no photos)')
            break
          }
          const analysis = await analyzePhotoAttachments(ctx, attIds)
          if (!analysis) {
            failed.push('analyze_photos (AI unconfigured / unreadable)')
            break
          }
          const badPpe = analysis.ppe.filter((p) => p.status !== 'present')
          // Optionally write a plain-text summary onto a field of the response.
          if (action.storeInField) {
            const lines: string[] = [analysis.summary]
            if (analysis.hazards.length)
              lines.push(`Hazards: ${analysis.hazards.map((h) => `${h.type} (${h.severity})`).join('; ')}`)
            if (badPpe.length) lines.push(`PPE: ${badPpe.map((p) => p.item).join(', ')}`)
            const summary = lines.filter(Boolean).join('\n')
            fieldPatch[action.storeInField] = summary
            values[action.storeInField] = summary
          }
          // Optionally spawn a CAPA when hazards at/above the threshold are found.
          if (action.createCapaOnHazard) {
            const min = SEVERITY_ORDER[action.minSeverity ?? 'medium'] ?? 2
            const bad = analysis.hazards.filter((h) => (SEVERITY_ORDER[h.severity] ?? 0) >= min)
            const top = bad[0]
            if (top) {
              const sev = bad.some((h) => h.severity === 'high') ? 'high' : 'medium'
              const res = await createCorrectiveActionFromResponse({
                responseId,
                title: `Photo hazard: ${top.type}`.slice(0, 120),
                description:
                  analysis.summary +
                  '\n\n' +
                  bad.map((h) => `• ${h.type} (${h.severity}) — ${h.detail}`).join('\n'),
                severity: sev as 'low' | 'medium' | 'high' | 'critical',
              })
              ran.push(res.ok ? 'analyze_photos→capa' : 'analyze_photos→capa (failed)')
            }
          }
          ran.push(`analyze_photos (${analysis.hazards.length}h/${badPpe.length}ppe)`)
          break
        }
      }
    } catch {
      failed.push(`${action.action} (error)`)
    }
  }

  // Persist set_field + flag_non_compliant onto the response in one update.
  if (Object.keys(fieldPatch).length > 0 || flagReason !== undefined) {
    try {
      await ctx.db(async (tx) => {
        const patch: Record<string, unknown> = {}
        if (Object.keys(fieldPatch).length > 0) {
          const [cur] = await tx
            .select({ data: formResponses.data })
            .from(formResponses)
            .where(eq(formResponses.id, responseId))
            .limit(1)
          patch.data = { ...(cur?.data ?? {}), ...fieldPatch }
        }
        if (flagReason !== undefined) patch.complianceStatus = 'non_compliant'
        if (Object.keys(patch).length > 0) {
          await tx.update(formResponses).set(patch).where(eq(formResponses.id, responseId))
        }
      })
    } catch {
      failed.push('persist (error)')
    }
  }

  // Gates → pending approval steps (the Flow-approvals panel drives them and
  // resumes the chosen branch).
  if (plan.gates.length > 0) {
    try {
      const existing = await ctx.db((tx) =>
        tx
          .select({ seq: formResponseSteps.sequence })
          .from(formResponseSteps)
          .where(eq(formResponseSteps.responseId, responseId)),
      )
      let seq = existing.reduce((m, r) => Math.max(m, r.seq), 0)
      for (const { nodeId, gate } of plan.gates) {
        try {
          const assignee = await resolveAssignee(gate.assignee)
          seq += 1
          await ctx.db((tx) =>
            tx.insert(formResponseSteps).values({
              tenantId: ctx.tenantId,
              responseId,
              stepKey: gateKeyOf(flowId, nodeId),
              sequence: seq,
              assigneeTenantUserId: assignee,
              status: 'pending',
              comment: gate.title,
            }),
          )
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
                category: 'forms',
                type: 'flow.approval',
                title: `Approval needed: ${gate.title}`,
                linkPath: `/forms/responses/${responseId}`,
                channels: ['in_app'],
              })
            }
          }
          ran.push('gate')
        } catch {
          failed.push('gate (error)')
        }
      }
    } catch {
      failed.push('gates (error)')
    }
  }

  return { ran, failed }
}

export async function runOnSubmitAutomations(
  ctx: RequestContext,
  args: {
    templateId: string
    responseId: string
    data: Record<string, unknown>
    score: number
    status: string
  },
): Promise<void> {
  const flows = await ctx.db((tx) =>
    tx
      .select({ id: formAutomations.id, graph: formAutomations.graph })
      .from(formAutomations)
      .where(and(eq(formAutomations.templateId, args.templateId), eq(formAutomations.enabled, true))),
  )
  if (flows.length === 0) return

  // Reserved keys let conditions reference the compliance verdict, e.g.
  // `compliance_score < 80`.
  const baseValues: Record<string, unknown> = {
    ...args.data,
    compliance_score: args.score,
    compliance_status: args.status,
  }

  const ran: string[] = []
  const failed: string[] = []
  for (const flow of flows) {
    let plan: AutomationPlan
    try {
      plan = planAutomation(flow.graph, 'on_submit', { values: baseValues, rows: {}, entities: {} })
    } catch {
      continue
    }
    if (plan.actions.length === 0 && plan.gates.length === 0) continue
    // Each flow gets its own values copy so set_field stays flow-local.
    const res = await executeFlowPlan(ctx, {
      responseId: args.responseId,
      flowId: flow.id,
      plan,
      values: { ...baseValues },
    })
    ran.push(...res.ran)
    failed.push(...res.failed)
  }

  if (ran.length > 0 || failed.length > 0) {
    await recordAudit(ctx, {
      entityType: 'form_response',
      entityId: args.responseId,
      action: 'update',
      summary: `Flows: ${ran.length ? `ran ${ran.join(', ')}` : 'no actions ran'}${
        failed.length ? ` · issues ${failed.join(', ')}` : ''
      }`,
    })
  }
}

/**
 * Fire flows whose trigger is `status_change` and whose target status matches
 * `toStatus`. Called from the workflow sign/advance/reject actions. Guarded.
 */
export async function runStatusChangeAutomations(
  ctx: RequestContext,
  args: {
    templateId: string
    responseId: string
    data: Record<string, unknown>
    score: number | null
    status: string | null
    toStatus: string
  },
): Promise<void> {
  const flows = await ctx.db((tx) =>
    tx
      .select({ id: formAutomations.id, graph: formAutomations.graph })
      .from(formAutomations)
      .where(and(eq(formAutomations.templateId, args.templateId), eq(formAutomations.enabled, true))),
  )
  if (flows.length === 0) return

  const baseValues: Record<string, unknown> = {
    ...args.data,
    compliance_score: args.score,
    compliance_status: args.status,
  }

  const ran: string[] = []
  const failed: string[] = []
  for (const flow of flows) {
    const trig = flow.graph.nodes.find(
      (n) => n.data.kind === 'trigger' && n.data.trigger.trigger === 'status_change',
    )
    if (!trig || trig.data.kind !== 'trigger') continue
    const td = trig.data.trigger
    if (td.trigger !== 'status_change' || td.to !== args.toStatus) continue

    let plan: AutomationPlan
    try {
      plan = planAutomation(flow.graph, 'status_change', {
        values: baseValues,
        rows: {},
        entities: {},
      })
    } catch {
      continue
    }
    if (plan.actions.length === 0 && plan.gates.length === 0) continue
    const res = await executeFlowPlan(ctx, {
      responseId: args.responseId,
      flowId: flow.id,
      plan,
      values: { ...baseValues },
    })
    ran.push(...res.ran)
    failed.push(...res.failed)
  }

  if (ran.length > 0 || failed.length > 0) {
    await recordAudit(ctx, {
      entityType: 'form_response',
      entityId: args.responseId,
      action: 'update',
      summary: `Flows (status→${args.toStatus}): ${
        ran.length ? `ran ${ran.join(', ')}` : 'no actions ran'
      }${failed.length ? ` · issues ${failed.join(', ')}` : ''}`,
    })
  }
}
