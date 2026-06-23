// Seed: record-type-specific email templates that recreate the legacy Laravel
// PDF/email layouts (data parity) in the new builder/template system. Each is
// tied to its record type (record_subject_type='module') so the builder exposes
// that record's full field set + collections.
//
// The builder runs in plain-HTML mode (no MJML) so the tables are EDITABLE. A
// repeating row is marked with `data-each="<collection>"` (an invisible attr
// that round-trips through GrapesJS); we store:
//   • mjml_source   — the editable HTML (what the builder canvas loads/edits).
//   • compiled_html — that HTML with the data-each markers expanded into
//     {{#each}} loops (what the SEND path renders).
// design stays {} → the editor seeds the canvas from mjml_source.
//
// UPSERTs (re-running refreshes the body/subject/merge fields).
//
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../.env \
//     src/seed-record-email-templates.ts

import { sql } from 'drizzle-orm'
import { createClient, withSuperAdmin } from './index'

// Mirror of @beaconhs/email-render's expandRepeatMarkers (inlined to keep the
// db package dependency-free). data-each row → {{#each}}, data-if → {{#if}}.
function expandRepeatMarkers(html: string): string {
  return html.replace(
    /<tr\b([^>]*)\bdata-(each|if)="([^"]+)"([^>]*)>([\s\S]*?)<\/tr>/gi,
    (_m, pre: string, kind: string, key: string, post: string, inner: string) => {
      const attrs = `${pre}${post}`.replace(/\s+/g, ' ').trim()
      const open = attrs ? `<tr ${attrs}>` : '<tr>'
      const block = kind === 'each' ? 'each' : 'if'
      return `{{#${block} ${key}}}${open}${inner}</tr>{{/${block}}}`
    },
  )
}

// --- shared, email-safe building blocks (inline styles) ----------------------

const WRAP_OPEN = `<div style="background:#f1f5f9;padding:24px 0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <tr><td style="background:#0f172a;padding:16px 28px;"><span style="color:#fff;font-size:17px;font-weight:700;letter-spacing:.3px;">BeaconHS</span></td></tr>
    <tr><td style="padding:24px 28px;">`

const WRAP_CLOSE = `    </td></tr>
    <tr><td style="background:#f8fafc;padding:14px 28px;border-top:1px solid #e2e8f0;"><span style="font-size:11px;color:#94a3b8;">BeaconHS &middot; Health &amp; Safety Management</span></td></tr>
  </table>
</div>`

const H2 =
  'font-size:15px;font-weight:700;color:#0f172a;margin:22px 0 8px;border-bottom:2px solid #e2e8f0;padding-bottom:4px'
const TH =
  'text-align:left;border-bottom:2px solid #e2e8f0;padding:6px 8px;font-size:11px;color:#475569;font-weight:700;text-transform:uppercase'
const TD =
  'border-bottom:1px solid #eef2f7;padding:6px 8px;font-size:13px;color:#0f172a;vertical-align:top'
const LBL =
  'padding:4px 12px 4px 0;font-size:12px;color:#64748b;white-space:nowrap;vertical-align:top'
const VAL = 'padding:4px 0;font-size:13px;color:#0f172a;vertical-align:top'

function detailRow(label: string, token: string): string {
  return `<tr><td style="${LBL}">${label}</td><td style="${VAL}">${token}</td></tr>`
}

// An EDITABLE record table: header row + ONE body row marked data-each. The
// marker expands to {{#each}} at compile so the single editable row repeats.
function table(headers: string[], cells: string[], eachKey: string): string {
  const head = headers.map((h) => `<th style="${TH}">${h}</th>`).join('')
  const body = cells.map((c) => `<td style="${TD}">${c}</td>`).join('')
  return (
    `<table style="width:100%;border-collapse:collapse;margin:0 0 8px;"><tr>${head}</tr>` +
    `<tr data-each="${eachKey}">${body}</tr></table>`
  )
}

// --- hazard assessment (legacy pdf/hazardassessment.blade.php) ---------------

const HAZID_HTML = `${WRAP_OPEN}
<h1 style="margin:0 0 2px;font-size:20px;color:#0f172a;">Hazard Assessment</h1>
<p style="margin:0 0 14px;font-size:13px;color:#64748b;">{{reference}} &middot; {{type_name}} &middot; {{status_label}}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:6px">
${detailRow('Occurred', '{{occurred_at}}')}
${detailRow('Site', '{{site_name}}')}
${detailRow('Location on site', '{{location_on_site}}')}
${detailRow('Project', '{{project_name}}')}
${detailRow('Supervisor', '{{supervisor_name}}')}
${detailRow('Reported by', '{{reported_by_name}}')}
</table>
<h2 style="${H2}">Job scope</h2>
<p style="margin:0 0 6px;font-size:13px;color:#0f172a;line-height:1.5;white-space:pre-wrap;">{{job_scope}}</p>
<h2 style="${H2}">Hazards &amp; controls</h2>
${table(
  [
    'Hazard',
    'Standard controls',
    'Specific controls',
    'Pre L/S (risk)',
    'Post L/S (risk)',
    'Applies',
  ],
  [
    '{{name}}',
    '{{standard_controls}}',
    '{{specific_controls}}',
    '{{pre_likelihood}}/{{pre_severity}} ({{pre_risk}})',
    '{{post_likelihood}}/{{post_severity}} ({{post_risk}})',
    '{{applicable}}',
  ],
  'hazards',
)}
<h2 style="${H2}">Tasks</h2>
${table(['Task', 'Controls'], ['{{name}}', '{{controls}}'], 'tasks')}
<h2 style="${H2}">PPE</h2>
${table(['PPE', 'Description', 'Required', 'Answer'], ['{{name}}', '{{description}}', '{{required}}', '{{answer}}'], 'ppe')}
<h2 style="${H2}">Questions</h2>
${table(['Question', 'Answer', 'Requires yes'], ['{{question}}', '{{answer}}', '{{requires_yes}}'], 'questions')}
<h2 style="${H2}">Signatures</h2>
${table(
  ['Name', 'Type', 'Entrant', 'Attendant', 'Rescue', 'Signed'],
  ['{{name}}', '{{type}}', '{{cs_entrant}}', '{{cs_attendant}}', '{{cs_rescue}}', '{{signed_at}}'],
  'signatures',
)}
<h2 style="${H2}">Photos</h2>
${table(['Photo', 'Caption'], ['<img src="{{url}}" width="120" style="border-radius:4px;border:1px solid #e2e8f0;display:block;" alt="" />', '{{caption}}'], 'photos')}
${WRAP_CLOSE}`

const HAZID_MERGE = [
  { key: 'reference', label: 'Reference' },
  { key: 'type_name', label: 'Assessment type name' },
  { key: 'status_label', label: 'Status' },
  { key: 'occurred_at', label: 'Occurred at' },
  { key: 'site_name', label: 'Site name' },
  { key: 'location_on_site', label: 'Location on site' },
  { key: 'project_name', label: 'Project name' },
  { key: 'supervisor_name', label: 'Supervisor name' },
  { key: 'reported_by_name', label: 'Reported by' },
  { key: 'job_scope', label: 'Job scope' },
]

// --- journal (legacy pdf/journal.blade.php) ----------------------------------

const JOURNAL_HTML = `${WRAP_OPEN}
<h1 style="margin:0 0 2px;font-size:20px;color:#0f172a;">Daily Journal</h1>
<p style="margin:0 0 14px;font-size:13px;color:#64748b;">{{reference}} &middot; {{entry_date}}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:6px">
${detailRow('Author', '{{author_name}}')}
${detailRow('Supervisor', '{{supervisor_name}}')}
${detailRow('Site', '{{site_name}}')}
${detailRow('Tags', '{{tags}}')}
</table>
<h2 style="${H2}">{{title}}</h2>
<p style="margin:0 0 6px;font-size:13px;color:#0f172a;line-height:1.6;white-space:pre-wrap;">{{body_text}}</p>
<h2 style="${H2}">Photos</h2>
${table(['Photo', 'Caption'], ['<img src="{{url}}" width="140" style="border-radius:4px;border:1px solid #e2e8f0;display:block;" alt="" />', '{{caption}}'], 'photos')}
${WRAP_CLOSE}`

const JOURNAL_MERGE = [
  { key: 'reference', label: 'Reference' },
  { key: 'entry_date', label: 'Entry date' },
  { key: 'title', label: 'Title' },
  { key: 'body_text', label: 'Body text' },
  { key: 'author_name', label: 'Author name' },
  { key: 'supervisor_name', label: 'Supervisor name' },
  { key: 'site_name', label: 'Site name' },
  { key: 'tags', label: 'Tags' },
]

type TemplateSeed = {
  key: string
  name: string
  description: string
  subjectKey: string
  subjectTemplate: string
  html: string
  mergeFields: { key: string; label: string }[]
}

const TEMPLATES: TemplateSeed[] = [
  {
    key: 'hazid-assessment-report',
    name: 'Hazard Assessment report',
    description: 'Full hazard assessment — details, hazards, PPE, questions, signatures, photos.',
    subjectKey: 'hazid',
    subjectTemplate: 'Hazard Assessment {{reference}}',
    html: HAZID_HTML,
    mergeFields: HAZID_MERGE,
  },
  {
    key: 'journal-entry-report',
    name: 'Daily Journal report',
    description: 'Daily journal entry — details, body, and photos.',
    subjectKey: 'journals',
    subjectTemplate: 'Daily Journal {{reference}}',
    html: JOURNAL_HTML,
    mergeFields: JOURNAL_MERGE,
  },
]

async function main() {
  const { db, sql: pg } = createClient({ max: 4 })
  let created = 0
  let updated = 0
  try {
    await withSuperAdmin(db, async (tx) => {
      const tenants = (await tx.execute(sql`select id from tenants`)) as unknown as {
        id: string
      }[]
      for (const t of tenants) {
        for (const tpl of TEMPLATES) {
          const compiled = expandRepeatMarkers(tpl.html)
          const merge = JSON.stringify(tpl.mergeFields)
          const found = (await tx.execute(
            sql`select id from email_templates where tenant_id=${t.id} and key=${tpl.key} and deleted_at is null limit 1`,
          )) as unknown as { id: string }[]
          if (found[0]) {
            await tx.execute(sql`
              update email_templates set
                name=${tpl.name}, description=${tpl.description},
                record_subject_type='module', record_subject_key=${tpl.subjectKey},
                subject_template=${tpl.subjectTemplate}, compiled_html=${compiled},
                mjml_source=${tpl.html}, merge_fields=${merge}::jsonb, design='{}'::jsonb,
                is_active=true, updated_at=now()
              where id=${found[0].id}
            `)
            updated++
          } else {
            await tx.execute(sql`
              insert into email_templates
                (tenant_id, key, name, description, category, record_subject_type, record_subject_key,
                 subject_template, compiled_html, mjml_source, merge_fields, is_active)
              values
                (${t.id}, ${tpl.key}, ${tpl.name}, ${tpl.description}, 'notification', 'module',
                 ${tpl.subjectKey}, ${tpl.subjectTemplate}, ${compiled}, ${tpl.html},
                 ${merge}::jsonb, true)
            `)
            created++
          }
        }
      }
    })
    console.log(`✔ record-type email templates: ${created} created, ${updated} updated.`)
  } finally {
    await pg.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
