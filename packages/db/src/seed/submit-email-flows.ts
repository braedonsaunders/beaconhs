// Per-tenant seeder: a branded "record notification" email template +
// per-module Flows that, on submit/sign/finalize, email that styled template
// WITH a PDF attachment — replicating the legacy Laravel
// submit→styled-email+PDF behaviour on the applicable native modules.
// Idempotent (skips templates/flows already present). Invoked by the dev seed
// (packages/db/src/seed.ts) BEFORE seedRecordEmailTemplates, which repoints
// these flows to per-module report templates and retires the generic one.

import { sql } from 'drizzle-orm'

const TEMPLATE_KEY = 'record-notification'
const TEMPLATE_SUBJECT = 'New submission: {{reference}}'
const MERGE_FIELDS = [
  { key: 'reference', label: 'Reference' },
  { key: 'title', label: 'Title' },
]

// Branded, responsive, inline-styled email (legacy parity: logo header, card,
// footer). {{reference}} / {{title}} interpolate from the record's field-map.
const TEMPLATE_HTML = `<div style="background:#f1f5f9;padding:24px 0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <tr><td style="background:#0f172a;padding:18px 28px;">
      <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.3px;">BeaconHS</span>
    </td></tr>
    <tr><td style="padding:28px;">
      <h1 style="margin:0 0 8px;font-size:20px;color:#0f172a;">A new record was submitted</h1>
      <p style="margin:0 0 4px;font-size:15px;color:#334155;"><strong>{{title}}</strong></p>
      <p style="margin:0 0 20px;font-size:13px;color:#64748b;">Reference: {{reference}}</p>
      <p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.6;">A full copy is attached to this email as a PDF. Open the record in BeaconHS for the latest details, photos and sign-offs.</p>
      <p style="margin:0;font-size:12px;color:#94a3b8;">You're receiving this because you're on the notification list for this record type.</p>
    </td></tr>
    <tr><td style="background:#f8fafc;padding:14px 28px;border-top:1px solid #e2e8f0;">
      <span style="font-size:11px;color:#94a3b8;">BeaconHS &middot; Health &amp; Safety Management</span>
    </td></tr>
  </table>
</div>`

type TriggerData =
  | { trigger: 'on_submit' }
  | { trigger: 'on_sign' }
  | { trigger: 'on_create' }
  | { trigger: 'status_change'; to: string }

const FLOWS: {
  moduleKey: string
  name: string
  trigger: TriggerData
  subjectOverride: string
}[] = [
  {
    moduleKey: 'journals',
    name: 'Email + PDF on submit',
    trigger: { trigger: 'on_submit' },
    subjectOverride: 'New daily journal: {{reference}}',
  },
  {
    moduleKey: 'hazid',
    name: 'Email + PDF on sign',
    trigger: { trigger: 'on_sign' },
    subjectOverride: 'Hazard assessment signed: {{reference}}',
  },
  {
    moduleKey: 'inspections',
    name: 'Email + PDF on submit',
    trigger: { trigger: 'on_submit' },
    subjectOverride: 'Inspection submitted: {{reference}}',
  },
  {
    moduleKey: 'corrective-actions',
    name: 'Email + PDF on create',
    trigger: { trigger: 'on_create' },
    subjectOverride: 'New corrective action: {{reference}}',
  },
  {
    moduleKey: 'incidents',
    name: 'Email + PDF on report',
    trigger: { trigger: 'on_create' },
    subjectOverride: 'New incident reported: {{reference}}',
  },
  {
    moduleKey: 'training',
    name: 'Email + PDF on assessment submit',
    trigger: { trigger: 'on_submit' },
    subjectOverride: 'Training assessment submitted',
  },
  {
    moduleKey: 'equipment',
    name: 'Email + PDF on work-order open',
    trigger: { trigger: 'on_create' },
    subjectOverride: 'Work order opened: {{reference}}',
  },
  {
    moduleKey: 'documents',
    name: 'Email + PDF on management review',
    trigger: { trigger: 'on_create' },
    subjectOverride: 'Management review recorded: {{title}}',
  },
]

function buildGraph(templateId: string, trigger: TriggerData, subjectOverride: string) {
  return {
    schemaVersion: 1,
    nodes: [
      { id: 'trigger_1', position: { x: 80, y: 80 }, data: { kind: 'trigger', trigger } },
      {
        id: 'action_1',
        position: { x: 380, y: 80 },
        data: {
          kind: 'action',
          action: {
            action: 'send_email',
            to: [{ type: 'submitter' }, { type: 'role', role: 'safety_manager' }],
            mode: 'template',
            templateId,
            subjectOverride,
            attachPdf: true,
          },
        },
      },
    ],
    edges: [{ id: 'e1', source: 'trigger_1', target: 'action_1', sourceHandle: 'next' }],
  }
}

type DrizzleTx = any

export async function seedSubmitEmailFlows(tx: DrizzleTx, tenantId: string): Promise<void> {
  let templatesCreated = 0
  let flowsCreated = 0

  // Incidents are now native with an on_create seam — retire the earlier
  // status_change→closed workaround flow if this tenant still carries it.
  await tx.execute(
    sql`delete from form_automations where tenant_id=${tenantId} and subject_type='module' and subject_key='incidents' and name='Email + PDF when closed'`,
  )

  // 1. Upsert the branded email template for this tenant. The lookup includes a
  //    soft-deleted row on purpose: seedRecordEmailTemplates retires this
  //    generic template after repointing the flows, and a re-seed must not
  //    resurrect a fresh copy every run.
  const found = (await tx.execute(
    sql`select id from email_templates where tenant_id=${tenantId} and key=${TEMPLATE_KEY} limit 1`,
  )) as unknown as { id: string }[]
  let templateId = found[0]?.id
  if (!templateId) {
    const ins = (await tx.execute(sql`
      insert into email_templates
        (tenant_id, key, name, description, category, subject_template, compiled_html, merge_fields, is_active)
      values
        (${tenantId}, ${TEMPLATE_KEY}, 'Record notification',
         'Branded submit notification (PDF attached).', 'notification',
         ${TEMPLATE_SUBJECT}, ${TEMPLATE_HTML}, ${JSON.stringify(MERGE_FIELDS)}::jsonb, true)
      returning id
    `)) as unknown as { id: string }[]
    templateId = ins[0]?.id
    if (templateId) templatesCreated++
  }
  if (!templateId) return

  // 2. Seed the per-module flows (skip if a same-named flow already exists).
  for (const f of FLOWS) {
    const existing = (await tx.execute(
      sql`select id from form_automations where tenant_id=${tenantId} and subject_type='module' and subject_key=${f.moduleKey} and name=${f.name} limit 1`,
    )) as unknown as { id: string }[]
    if (existing[0]) continue
    const graph = JSON.stringify(buildGraph(templateId, f.trigger, f.subjectOverride))
    await tx.execute(sql`
      insert into form_automations
        (tenant_id, subject_type, subject_key, template_id, name, enabled, graph)
      values
        (${tenantId}, 'module', ${f.moduleKey}, null, ${f.name}, true, ${graph}::jsonb)
    `)
    flowsCreated++
  }

  console.log(
    `  · submit→email+PDF: ${templatesCreated} template(s) created, ${flowsCreated} module flow(s) seeded`,
  )
}
