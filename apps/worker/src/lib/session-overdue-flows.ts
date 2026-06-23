// Worker-side execution of a monitored response's `session_overdue` Flow.
//
// When a monitored session goes overdue, the scan first tries the template's
// session_overdue Flow (its notify_role / send_email escalation actions). If a
// flow handled it, the caller skips the built-in default alert; otherwise the
// default (safety managers + admins) fires. Worker-safe: uses the PURE
// `planAutomation` from forms-core + db + jobs queues only — the web-side
// `executeFlowPlan` (which spawns CAPAs/incidents via web primitives) can't run
// here, so only the escalation-relevant actions are executed. Fully guarded.

import { and, eq } from 'drizzle-orm'
import { planAutomation, type EmailTarget } from '@beaconhs/forms-core'
import { formAutomations, roleAssignments, roles, tenantUsers, users } from '@beaconhs/db/schema'
import { enqueueEmail, enqueueNotification } from '@beaconhs/jobs'

function interpolate(tpl: string, values: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => {
    const v = values[k]
    return v == null ? '' : String(v)
  })
}

async function roleUserIds(tx: any, tenantId: string, roleKey: string) {
  if (!roleKey) return [] as { userId: string; email: string | null }[]
  return tx
    .select({ userId: tenantUsers.userId, email: users.email })
    .from(tenantUsers)
    .innerJoin(roleAssignments, eq(roleAssignments.tenantUserId, tenantUsers.id))
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .where(
      and(
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.status, 'active'),
        eq(roles.key, roleKey),
      ),
    )
}

async function resolveEmails(
  tx: any,
  tenantId: string,
  targets: EmailTarget[],
  submitterEmail: string | null,
  values: Record<string, unknown>,
): Promise<string[]> {
  const out = new Set<string>()
  for (const t of targets) {
    if (t.type === 'literal') {
      if (t.email.includes('@')) out.add(t.email.trim())
    } else if (t.type === 'submitter') {
      if (submitterEmail) out.add(submitterEmail)
    } else if (t.type === 'role') {
      for (const u of await roleUserIds(tx, tenantId, t.role)) if (u.email) out.add(u.email)
    } else if (t.type === 'field') {
      const v = values[t.field]
      if (typeof v === 'string' && v.includes('@')) out.add(v.trim())
    }
  }
  return Array.from(out)
}

/**
 * Run the template's `session_overdue` Flow escalation actions for an overdue
 * monitored response. Returns true if any action ran (caller skips the default
 * alert). Never throws.
 */
export async function runSessionOverdueFlows(args: {
  tx: any
  tenantId: string
  responseId: string
  templateId: string
  data: Record<string, unknown>
  submitterEmail: string | null
}): Promise<boolean> {
  const { tx, tenantId, responseId, templateId, data, submitterEmail } = args
  let ran = false
  let flows: { graph: any }[] = []
  try {
    flows = await tx
      .select({ graph: formAutomations.graph })
      .from(formAutomations)
      .where(and(eq(formAutomations.templateId, templateId), eq(formAutomations.enabled, true)))
  } catch {
    return false
  }
  for (const flow of flows) {
    let plan
    try {
      plan = planAutomation(flow.graph, 'session_overdue', { values: data, rows: {}, entities: {} })
    } catch {
      continue
    }
    for (const action of plan.actions) {
      try {
        if (action.action === 'notify_role') {
          const recipients = await roleUserIds(tx, tenantId, action.role)
          const userIds = recipients.map((r: { userId: string }) => r.userId)
          if (userIds.length > 0) {
            await enqueueNotification({
              tenantId,
              userIds,
              category: 'lone_worker',
              type: 'monitored_session.overdue',
              title: interpolate(action.message, data) || 'Monitored session check-in overdue',
              linkPath: `/apps/responses/${responseId}`,
              isCritical: true,
              channels: action.channel === 'email' ? ['in_app', 'email'] : ['in_app'],
            })
            ran = true
          }
        } else if (action.action === 'send_email') {
          const to = await resolveEmails(tx, tenantId, action.to, submitterEmail, data)
          if (to.length > 0) {
            // Worker handles inline email only; template/design modes (DB-backed)
            // are a web-side concern. Guard the now-optional inline fields.
            const body = interpolate(action.bodyTemplate ?? '', data)
            await enqueueEmail({
              to,
              subject:
                interpolate(action.subject ?? '', data) || 'Monitored session check-in overdue',
              text: body,
              html: `<div style="font-family:system-ui,Arial,sans-serif;white-space:pre-wrap">${body}</div>`,
              meta: { tenantId, category: 'lone_worker' },
            })
            ran = true
          }
        }
        // Other action kinds (CAPA, incident, webhook, …) need web-side
        // primitives and are intentionally skipped in the worker overdue path.
      } catch {
        /* guarded — one bad action never blocks escalation */
      }
    }
  }
  return ran
}
