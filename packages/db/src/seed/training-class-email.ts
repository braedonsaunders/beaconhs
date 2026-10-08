import { and, eq, sql } from 'drizzle-orm'
import { expandRepeatMarkers, sanitizeEmailHtml } from '@beaconhs/email-render'
import type { AutomationGraph } from '@beaconhs/forms-core'
import type { Database } from '../client'
import { auditLog } from '../schema/audit'
import { emailTemplates } from '../schema/email-templates'
import { formAutomations } from '../schema/forms'

const TEMPLATE_KEY = 'training-class-booking'
const SUBJECT = 'Training Class: {{course_name}} - {{starts_at}}'
const PREVIOUS_BODY =
  'A training class was scheduled.\n\nCourse: {{course_name}}\nStarts: {{starts_at}}\nEnds: {{ends_at}}\nClass location: {{site_name}}\nInstructor: {{instructor_name}}'

// Editable source for the native email designer. Row markers survive the
// designer's HTML parser; compile only after sanitizing, exactly as on save.
export const TRAINING_CLASS_BOOKING_SOURCE = `
<div style="font-family:Arial,sans-serif;color:#0f172a;max-width:600px;margin:0 auto;padding:20px;">
  <h1 style="font-size:22px;margin:0 0 16px;">Training class booking</h1>
  <p style="font-size:14px;line-height:1.6;margin:0 0 16px;">Your training class is confirmed. The booked attendees are listed below.</p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.6;">
    <tr><td style="padding:4px 8px 4px 0;font-weight:bold;vertical-align:top;">Course</td><td style="padding:4px 0;">{{course_name}}</td></tr>
    <tr><td style="padding:4px 8px 4px 0;font-weight:bold;vertical-align:top;">Starts</td><td style="padding:4px 0;">{{starts_at}}</td></tr>
    <tr><td style="padding:4px 8px 4px 0;font-weight:bold;vertical-align:top;">Ends</td><td style="padding:4px 0;">{{ends_at}}</td></tr>
    <tr data-if="site_name"><td style="padding:4px 8px 4px 0;font-weight:bold;vertical-align:top;">Class location</td><td style="padding:4px 0;">{{site_name}}</td></tr>
    <tr data-if="instructor_name"><td style="padding:4px 8px 4px 0;font-weight:bold;vertical-align:top;">Instructor</td><td style="padding:4px 0;">{{instructor_name}}</td></tr>
    <tr data-if="notes"><td style="padding:4px 8px 4px 0;font-weight:bold;vertical-align:top;">Notes</td><td style="padding:4px 0;">{{notes}}</td></tr>
  </table>
  <h2 style="font-size:16px;margin:24px 0 10px;">Attendees ({{attendee_count}})</h2>
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px;line-height:1.5;">
    <colgroup><col style="width:55%;" /><col style="width:45%;" /></colgroup>
    <thead><tr><th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid #cbd5e1;background:#f1f5f9;">Name</th><th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid #cbd5e1;background:#f1f5f9;">Email</th></tr></thead>
    <tbody><tr data-each="attendees"><td style="padding:8px;border-bottom:1px solid #e2e8f0;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;">{{name}}</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;">{{email}}</td></tr></tbody>
  </table>
</div>`

type SeedTx = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>

/** Provision a native, editable booking email without replacing tenant designs.
 * The explicit upgrade option switches only the former default inline booking
 * body. Recipients, subjects, channels, attachments and graph wiring survive.
 */
export async function seedTrainingClassBookingEmail(
  tx: SeedTx,
  tenantId: string,
  options: { upgradeInlineFlows?: boolean } = {},
): Promise<{ templateId: string | null; templateCreated: boolean; flowsChanged: number }> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`training-class-email:${tenantId}`}, 0))`,
  )
  const sourceHtml = sanitizeEmailHtml(TRAINING_CLASS_BOOKING_SOURCE)
  const [created] = await tx
    .insert(emailTemplates)
    .values({
      tenantId,
      key: TEMPLATE_KEY,
      name: 'Training class booking',
      description: 'Confirmed class details and a table of booked attendees.',
      category: 'notification',
      recordSubjectType: 'module',
      recordSubjectKey: 'training-classes',
      subjectTemplate: SUBJECT,
      sourceHtml,
      compiledHtml: expandRepeatMarkers(sourceHtml),
      mergeFields: [
        { key: 'course_name', label: 'Course' },
        { key: 'starts_at', label: 'Starts at' },
        { key: 'ends_at', label: 'Ends at' },
        { key: 'site_name', label: 'Class location' },
        { key: 'instructor_name', label: 'Instructor' },
        { key: 'notes', label: 'Notes' },
        { key: 'attendee_count', label: 'Attendee count' },
      ],
    })
    .onConflictDoNothing({ target: [emailTemplates.tenantId, emailTemplates.key] })
    .returning({ id: emailTemplates.id })
  const [template] = await tx
    .select({
      id: emailTemplates.id,
      deletedAt: emailTemplates.deletedAt,
      isActive: emailTemplates.isActive,
    })
    .from(emailTemplates)
    .where(and(eq(emailTemplates.tenantId, tenantId), eq(emailTemplates.key, TEMPLATE_KEY)))
    .limit(1)
  if (created) {
    await tx.insert(auditLog).values({
      tenantId,
      entityType: 'email_template',
      entityId: created.id,
      action: 'create',
      summary: 'Added native training class booking email with attendee table',
    })
  }
  // Respect an administrator's deletion or disabling of the default template.
  if (!template || template.deletedAt || !template.isActive)
    return { templateId: null, templateCreated: !!created, flowsChanged: 0 }

  const flows = await tx
    .select()
    .from(formAutomations)
    .where(
      and(
        eq(formAutomations.tenantId, tenantId),
        eq(formAutomations.subjectType, 'module'),
        eq(formAutomations.subjectKey, 'training-classes'),
      ),
    )
  const bookingFlows = flows.filter((flow) =>
    flow.graph.nodes.some(
      (node) => node.data.kind === 'trigger' && node.data.trigger.trigger === 'class_confirmed',
    ),
  )
  let flowsChanged = 0
  if (bookingFlows.length === 0) {
    const graph: AutomationGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'booking-trigger',
          position: { x: 0, y: 0 },
          data: { kind: 'trigger', trigger: { trigger: 'class_confirmed' } },
        },
        {
          id: 'booking-email',
          position: { x: 320, y: 0 },
          data: {
            kind: 'action',
            action: {
              action: 'send_email',
              mode: 'template',
              templateId: template.id,
              to: [{ type: 'field', field: 'attendee_emails' }],
            },
          },
        },
      ],
      edges: [
        {
          id: 'booking-send',
          source: 'booking-trigger',
          target: 'booking-email',
          sourceHandle: 'next',
        },
      ],
    }
    const [flow] = await tx
      .insert(formAutomations)
      .values({
        tenantId,
        subjectType: 'module',
        subjectKey: 'training-classes',
        name: 'Training class email',
        graph,
      })
      .returning({ id: formAutomations.id })
    if (!flow) throw new Error('Could not create the training class booking email flow.')
    await tx.insert(auditLog).values({
      tenantId,
      entityType: 'form_automation',
      entityId: flow.id,
      action: 'create',
      summary: 'Added manual class booking email using the native template',
    })
    flowsChanged++
  } else if (options.upgradeInlineFlows) {
    for (const flow of bookingFlows) {
      let changed = false
      const nodes = flow.graph.nodes.map((node) => {
        if (node.data.kind !== 'action') return node
        const action = node.data.action
        if (
          action.action !== 'send_email' ||
          (action.mode ?? 'inline') !== 'inline' ||
          (action.channel ?? 'email') !== 'email' ||
          action.bodyTemplate?.trim() !== PREVIOUS_BODY
        )
          return node
        const { subject, bodyTemplate: _body, ...delivery } = action
        changed = true
        return {
          ...node,
          data: {
            ...node.data,
            action: {
              ...delivery,
              mode: 'template' as const,
              templateId: template.id,
              subjectOverride: subject || SUBJECT,
            },
          },
        }
      })
      if (!changed) continue
      const graph = { ...flow.graph, nodes }
      await tx
        .update(formAutomations)
        .set({ graph, updatedAt: new Date() })
        .where(and(eq(formAutomations.tenantId, tenantId), eq(formAutomations.id, flow.id)))
      await tx.insert(auditLog).values({
        tenantId,
        entityType: 'form_automation',
        entityId: flow.id,
        action: 'update',
        summary: 'Switched class booking email to native attendee-table template',
        before: { graph: flow.graph },
        after: { graph },
      })
      flowsChanged++
    }
  }
  return { templateId: template.id, templateCreated: !!created, flowsChanged }
}
