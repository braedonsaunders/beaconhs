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
import { createHash } from 'node:crypto'
import { planAutomation, type EmailTarget } from '@beaconhs/forms-core'
import { formAutomations, roleAssignments, roles, tenantUsers, users } from '@beaconhs/db/schema'
import { enqueueEmail, enqueueNotification } from '@beaconhs/jobs'
import { renderEmail } from '@beaconhs/email-render'

export function interpolate(tpl: string, values: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => {
    const v = values[k]
    return v == null ? '' : String(v)
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function roleUserIds(tx: any, tenantId: string, roleKey: string) {
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

export async function resolveEmails(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 * alert). Queue failures throw so the caller's status transaction rolls back;
 * deterministic job ids make a partial publication safe to retry.
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
  const flows = await tx
    .select({ id: formAutomations.id, graph: formAutomations.graph })
    .from(formAutomations)
    .where(and(eq(formAutomations.templateId, templateId), eq(formAutomations.enabled, true)))
  for (const flow of flows) {
    const plan = planAutomation(flow.graph, 'session_overdue', {
      values: data,
      rows: {},
      entities: {},
    })
    if (plan.gates.length > 0) {
      throw new Error('Session-overdue flows cannot enter a human approval gate')
    }
    for (const [index, action] of plan.actions.entries()) {
      const suffix = createHash('sha256')
        .update(`${responseId}\0${flow.id}\0${index}`)
        .digest('hex')
      if (action.action === 'notify_role') {
        const recipients = await roleUserIds(tx, tenantId, action.role)
        const userIds = recipients.map((r: { userId: string }) => r.userId)
        if (userIds.length > 0) {
          await enqueueNotification(
            {
              tenantId,
              userIds,
              category: 'monitored_session',
              type: 'monitored_session.overdue',
              title: interpolate(action.message, data) || 'Monitored session check-in overdue',
              linkPath: `/apps/responses/${responseId}`,
              isCritical: true,
              channels: action.channel === 'email' ? ['in_app', 'email'] : ['in_app'],
            },
            { jobId: `session-overdue-notify|${suffix}` },
          )
          ran = true
        }
      } else if (action.action === 'send_email') {
        const to = await resolveEmails(tx, tenantId, action.to, submitterEmail, data)
        if (to.length > 0) {
          const rendered = renderEmail(
            {
              mode: 'inline',
              subject: action.subject || 'Monitored session check-in overdue',
              bodyTemplate: action.bodyTemplate ?? '',
            },
            data,
          )
          await enqueueEmail(
            {
              to,
              subject: rendered.subject,
              text: rendered.text,
              html: rendered.html,
              meta: { tenantId, category: 'lone_worker' },
            },
            { jobId: `session-overdue-email|${suffix}` },
          )
          ran = true
        }
      } else {
        throw new Error(
          `${action.action} is not supported for a session-overdue worker flow; use notify_role or send_email`,
        )
      }
    }
  }
  return ran
}
