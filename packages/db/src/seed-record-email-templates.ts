// Seed: record-type-specific email templates that recreate the legacy Laravel
// PDF/email layouts (data parity) in the new builder/template system. Each is
// tied to its record type (record_subject_type='module') so the builder exposes
// that record's full field set + collections, and the {{#each}} loop engine
// renders the line-item tables (hazards, ppe, signatures, photos, …).
//
// Two representations are stored from ONE authored HTML body:
//   • compiled_html — the authored HTML (what the SEND path renders; tested).
//   • mjml_source   — that HTML wrapped in <mj-raw> so the GrapesJS/MJML builder
//     canvas loads + edits it (mj-raw passes mustache through verbatim, incl.
//     {{#each}}/{{#if}} — so row numbers via {{@number}} are NOT used here).
// design stays {} → the editor loads mjml_source into the canvas.
//
// UPSERTs (re-running refreshes the body/subject/merge fields).
//
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../.env \
//     src/seed-record-email-templates.ts

import { sql } from 'drizzle-orm'
import { createClient, withSuperAdmin } from './index'

// --- shared, email-safe building blocks -------------------------------------

const WRAP_OPEN = `<div style="background:#f1f5f9;padding:24px 0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <tr><td style="background:#0f172a;padding:16px 28px;"><span style="color:#fff;font-size:17px;font-weight:700;letter-spacing:.3px;">BeaconHS</span></td></tr>
    <tr><td style="padding:24px 28px;">`

const WRAP_CLOSE = `    </td></tr>
    <tr><td style="background:#f8fafc;padding:14px 28px;border-top:1px solid #e2e8f0;"><span style="font-size:11px;color:#94a3b8;">BeaconHS &middot; Health &amp; Safety Management</span></td></tr>
  </table>
</div>`

const H2 =
  'margin:22px 0 8px;font-size:15px;font-weight:700;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:4px'
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

// A {{#each}} table — header row + one templated body row per collection item.
function table(headers: string[], rowCells: string[], eachKey: string): string {
  const head = headers.map((h) => `<th style="${TH}">${h}</th>`).join('')
  const body = rowCells.map((c) => `<td style="${TD}">${c}</td>`).join('')
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:6px"><tr>${head}</tr>` +
    `{{#each ${eachKey}}}<tr>${body}</tr>{{/each}}</table>`
  )
}

// Wrap authored HTML so the MJML builder canvas can load + edit it. mj-raw emits
// its content verbatim, so {{#each}}/{{#if}}/{{token}} all survive compile.
function wrapMjml(bodyHtml: string): string {
  return `<mjml><mj-body>\n<mj-raw>\n${bodyHtml}\n</mj-raw>\n</mj-body></mjml>`
}

// --- hazard assessment (legacy pdf/hazardassessment.blade.php) ---------------

const HAZID_HTML = `${WRAP_OPEN}
<h1 style="margin:0 0 2px;font-size:20px;color:#0f172a;">Hazard Assessment</h1>
<p style="margin:0 0 14px;font-size:13px;color:#64748b;">{{reference}}{{#if type_name}} &middot; {{type_name}}{{/if}} &middot; {{#if locked}}<span style="color:#15803d;font-weight:700;">LOCKED</span>{{else}}<span style="color:#b45309;font-weight:700;">IN PROGRESS</span>{{/if}}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:6px">
${detailRow('Occurred', '{{occurred_at}}')}
${detailRow('Site', '{{site_name}}')}
${detailRow('Location on site', '{{location_on_site}}')}
${detailRow('Project', '{{project_name}}')}
${detailRow('Supervisor', '{{supervisor_name}}')}
${detailRow('Reported by', '{{reported_by_name}}')}
</table>
{{#if job_scope}}<h2 style="${H2}">Job scope</h2><p style="margin:0 0 6px;font-size:13px;color:#0f172a;line-height:1.5;white-space:pre-wrap;">{{job_scope}}</p>{{/if}}
{{#if hazards}}<h2 style="${H2}">Hazards &amp; controls</h2>
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
)}{{/if}}
{{#if tasks}}<h2 style="${H2}">Tasks</h2>
${table(['Task', 'Controls'], ['{{name}}', '{{controls}}'], 'tasks')}{{/if}}
{{#if ppe}}<h2 style="${H2}">PPE</h2>
${table(['PPE', 'Description', 'Required', 'Answer'], ['{{name}}', '{{description}}', '{{required}}', '{{answer}}'], 'ppe')}{{/if}}
{{#if questions}}<h2 style="${H2}">Questions</h2>
${table(['Question', 'Answer', 'Requires yes'], ['{{question}}', '{{answer}}', '{{requires_yes}}'], 'questions')}{{/if}}
{{#if signatures}}<h2 style="${H2}">Signatures</h2>
${table(
  ['Name', 'Type', 'Entrant', 'Attendant', 'Rescue', 'Signed'],
  ['{{name}}', '{{type}}', '{{cs_entrant}}', '{{cs_attendant}}', '{{cs_rescue}}', '{{signed_at}}'],
  'signatures',
)}{{/if}}
{{#if photos}}<h2 style="${H2}">Photos</h2>
{{#each photos}}<div style="display:inline-block;margin:0 8px 8px 0;vertical-align:top;"><img src="{{url}}" width="180" style="border-radius:6px;border:1px solid #e2e8f0;display:block;" alt="" />{{#if caption}}<span style="font-size:11px;color:#64748b;">{{caption}}</span>{{/if}}</div>{{/each}}{{/if}}
${WRAP_CLOSE}`

const HAZID_MERGE = [
  { key: 'reference', label: 'Reference' },
  { key: 'type_name', label: 'Assessment type name' },
  { key: 'occurred_at', label: 'Occurred at' },
  { key: 'site_name', label: 'Site name' },
  { key: 'location_on_site', label: 'Location on site' },
  { key: 'project_name', label: 'Project name' },
  { key: 'supervisor_name', label: 'Supervisor name' },
  { key: 'reported_by_name', label: 'Reported by' },
  { key: 'job_scope', label: 'Job scope' },
  { key: 'locked', label: 'Locked' },
]

// --- journal (legacy pdf/journal.blade.php) ----------------------------------

const JOURNAL_HTML = `${WRAP_OPEN}
<h1 style="margin:0 0 2px;font-size:20px;color:#0f172a;">Daily Journal</h1>
<p style="margin:0 0 14px;font-size:13px;color:#64748b;">{{reference}}{{#if entry_date}} &middot; {{entry_date}}{{/if}}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:6px">
${detailRow('Author', '{{author_name}}')}
${detailRow('Supervisor', '{{supervisor_name}}')}
${detailRow('Site', '{{site_name}}')}
${detailRow('Tags', '{{tags}}')}
</table>
{{#if title}}<h2 style="${H2}">{{title}}</h2>{{/if}}
<p style="margin:0 0 6px;font-size:13px;color:#0f172a;line-height:1.6;white-space:pre-wrap;">{{body_text}}</p>
{{#if photos}}<h2 style="${H2}">Photos</h2>
{{#each photos}}<div style="display:inline-block;margin:0 8px 8px 0;vertical-align:top;"><img src="{{url}}" width="200" style="border-radius:6px;border:1px solid #e2e8f0;display:block;" alt="" />{{#if caption}}<span style="font-size:11px;color:#64748b;">{{caption}}</span>{{/if}}</div>{{/each}}{{/if}}
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
    subjectTemplate: 'Hazard Assessment {{reference}}{{#if type_name}} — {{type_name}}{{/if}}',
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
          const mjml = wrapMjml(tpl.html)
          const merge = JSON.stringify(tpl.mergeFields)
          const found = (await tx.execute(
            sql`select id from email_templates where tenant_id=${t.id} and key=${tpl.key} and deleted_at is null limit 1`,
          )) as unknown as { id: string }[]
          if (found[0]) {
            await tx.execute(sql`
              update email_templates set
                name=${tpl.name}, description=${tpl.description},
                record_subject_type='module', record_subject_key=${tpl.subjectKey},
                subject_template=${tpl.subjectTemplate}, compiled_html=${tpl.html},
                mjml_source=${mjml}, merge_fields=${merge}::jsonb, design='{}'::jsonb,
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
                 ${tpl.subjectKey}, ${tpl.subjectTemplate}, ${tpl.html}, ${mjml},
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
