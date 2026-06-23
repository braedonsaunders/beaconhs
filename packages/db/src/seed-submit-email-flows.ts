// Seed: a branded "record notification" email template + per-module Flows that,
// on submit/sign/finalize, email that styled template WITH a PDF attachment —
// replicating the legacy Laravel submit→styled-email+PDF behaviour on the
// applicable native modules. Idempotent (skips templates/flows already present).
//
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../.env \
//     src/seed-submit-email-flows.ts

import { sql } from 'drizzle-orm'
import { createClient, withSuperAdmin } from './index'

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
    name: 'Email + PDF when closed',
    trigger: { trigger: 'status_change', to: 'closed' },
    subjectOverride: 'Incident closed: {{reference}}',
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

async function main() {
  const { db, sql: pg } = createClient({ max: 4 })
  let templatesCreated = 0
  let flowsCreated = 0
  try {
    await withSuperAdmin(db, async (tx) => {
      const tenants = (await tx.execute(sql`select id, name from tenants`)) as unknown as {
        id: string
        name: string
      }[]

      for (const t of tenants) {
        // 1. Upsert the branded email template for this tenant.
        const found = (await tx.execute(
          sql`select id from email_templates where tenant_id=${t.id} and key=${TEMPLATE_KEY} and deleted_at is null limit 1`,
        )) as unknown as { id: string }[]
        let templateId = found[0]?.id
        if (!templateId) {
          const ins = (await tx.execute(sql`
            insert into email_templates
              (tenant_id, key, name, description, category, subject_template, compiled_html, merge_fields, is_active)
            values
              (${t.id}, ${TEMPLATE_KEY}, 'Record notification',
               'Branded submit notification (PDF attached).', 'notification',
               ${TEMPLATE_SUBJECT}, ${TEMPLATE_HTML}, ${JSON.stringify(MERGE_FIELDS)}::jsonb, true)
            returning id
          `)) as unknown as { id: string }[]
          templateId = ins[0]?.id
          if (templateId) templatesCreated++
        }
        if (!templateId) continue

        // 2. Seed the per-module flows (skip if a same-named flow already exists).
        for (const f of FLOWS) {
          const existing = (await tx.execute(
            sql`select id from form_automations where tenant_id=${t.id} and subject_type='module' and subject_key=${f.moduleKey} and name=${f.name} limit 1`,
          )) as unknown as { id: string }[]
          if (existing[0]) continue
          const graph = JSON.stringify(buildGraph(templateId, f.trigger, f.subjectOverride))
          await tx.execute(sql`
            insert into form_automations
              (tenant_id, subject_type, subject_key, template_id, name, enabled, graph)
            values
              (${t.id}, 'module', ${f.moduleKey}, null, ${f.name}, true, ${graph}::jsonb)
          `)
          flowsCreated++
        }
      }
    })
    console.log(
      `✔ seeded ${templatesCreated} email template(s) + ${flowsCreated} module flow(s) (submit→email+PDF).`,
    )
  } finally {
    await pg.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
