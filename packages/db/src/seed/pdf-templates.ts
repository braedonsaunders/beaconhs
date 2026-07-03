// Seed: the record reports as paper-size PDF DOCUMENT templates (pdf_templates),
// recreating the legacy Laravel PDFs. Same record subjects + collections as the
// email report templates, but a full-page document layout (no narrow email card)
// and page metadata (paper size / orientation / margins / header / footer). The
// dense tabular reports (hazid, incident) default to landscape.
//
// UPSERTs. Run after db:migrate (the pdf_templates table must exist + have RLS).
//
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../.env src/seed-pdf-templates.ts

import { sql } from 'drizzle-orm'
import { createClient, withSuperAdmin } from './index'

// data-each row → {{#each}} (mirror of @beaconhs/email-render's expandRepeatMarkers).
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

const H1 = 'font-size:22px;font-weight:800;color:#0f172a;margin:0 0 2px'
const SUB = 'font-size:12px;color:#64748b;margin:0 0 14px'
const H2 =
  'font-size:14px;font-weight:700;color:#0f172a;margin:18px 0 6px;border-bottom:2px solid #0f172a;padding-bottom:3px'
const TH =
  'text-align:left;border-bottom:2px solid #cbd5e1;padding:5px 8px;font-size:10px;color:#475569;font-weight:700;text-transform:uppercase'
const TD =
  'border-bottom:1px solid #e2e8f0;padding:5px 8px;font-size:12px;color:#0f172a;vertical-align:top'
const LBL =
  'padding:3px 12px 3px 0;font-size:11px;color:#64748b;white-space:nowrap;vertical-align:top'
const VAL = 'padding:3px 0;font-size:12px;color:#0f172a;vertical-align:top'

const DOC_OPEN =
  '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;">' +
  '<div style="border-bottom:3px solid #0f172a;padding-bottom:6px;margin-bottom:12px;"><span style="font-size:16px;font-weight:800;letter-spacing:.3px;">BeaconHS</span></div>'
const DOC_CLOSE = '</div>'

function detailRow(label: string, token: string): string {
  return `<tr><td style="${LBL}">${label}</td><td style="${VAL}">${token}</td></tr>`
}
function table(headers: string[], cells: string[], eachKey: string): string {
  const head = headers.map((h) => `<th style="${TH}">${h}</th>`).join('')
  const body = cells.map((c) => `<td style="${TD}">${c}</td>`).join('')
  return (
    `<table style="width:100%;border-collapse:collapse;margin:0 0 6px;"><tr>${head}</tr>` +
    `<tr data-each="${eachKey}">${body}</tr></table>`
  )
}
function para(heading: string, token: string): string {
  return `<h2 style="${H2}">${heading}</h2><p style="margin:0 0 4px;font-size:12px;color:#0f172a;line-height:1.5;white-space:pre-wrap;">${token}</p>`
}
function section(heading: string, body: string): string {
  return `<h2 style="${H2}">${heading}</h2>${body}`
}
function head(title: string, subtitle: string, rows: string): string {
  return (
    `${DOC_OPEN}<h1 style="${H1}">${title}</h1><p style="${SUB}">${subtitle}</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:4px">${rows}</table>`
  )
}
const PHOTO_CELL =
  '<img src="{{url}}" width="120" style="border-radius:3px;border:1px solid #e2e8f0;display:block;" alt="" />'
const photosTable = () => table(['Photo', 'Caption'], [PHOTO_CELL, '{{caption}}'], 'photos')

// --- the 8 report documents --------------------------------------------------

const HAZID =
  head(
    'Hazard Assessment',
    '{{reference}} &middot; {{type_name}} &middot; {{status_label}}',
    detailRow('Occurred', '{{occurred_at}}') +
      detailRow('Site', '{{site_name}}') +
      detailRow('Location on site', '{{location_on_site}}') +
      detailRow('Project', '{{project_name}}') +
      detailRow('Supervisor', '{{supervisor_name}}') +
      detailRow('Reported by', '{{reported_by_name}}'),
  ) +
  para('Job scope', '{{job_scope}}') +
  section(
    'Hazards & controls',
    table(
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
    ),
  ) +
  section('Tasks', table(['Task', 'Controls'], ['{{name}}', '{{controls}}'], 'tasks')) +
  section(
    'PPE',
    table(
      ['PPE', 'Description', 'Required', 'Answer'],
      ['{{name}}', '{{description}}', '{{required}}', '{{answer}}'],
      'ppe',
    ),
  ) +
  section(
    'Questions',
    table(
      ['Question', 'Answer', 'Requires yes'],
      ['{{question}}', '{{answer}}', '{{requires_yes}}'],
      'questions',
    ),
  ) +
  section(
    'Signatures',
    table(
      ['Name', 'Type', 'Entrant', 'Attendant', 'Rescue', 'Signed'],
      [
        '{{name}}',
        '{{type}}',
        '{{cs_entrant}}',
        '{{cs_attendant}}',
        '{{cs_rescue}}',
        '{{signed_at}}',
      ],
      'signatures',
    ),
  ) +
  section('Photos', photosTable()) +
  DOC_CLOSE

const INCIDENT =
  head(
    'Incident Report',
    '{{reference}} &middot; {{status_label}} &middot; {{severity_label}}',
    detailRow('Title', '{{title}}') +
      detailRow('Type', '{{type_label}}') +
      detailRow('Occurred', '{{occurred_at}}') +
      detailRow('Site', '{{site_name}}') +
      detailRow('Department', '{{department_name}}') +
      detailRow('Supervisor', '{{supervisor_name}}') +
      detailRow('Reported by', '{{reported_by_name}}'),
  ) +
  para('Description', '{{description}}') +
  para('Root cause', '{{root_cause}}') +
  section('People involved', table(['Name', 'Role'], ['{{name}}', '{{role}}'], 'people_involved')) +
  section(
    'Injuries',
    table(
      ['Person', 'Body parts', 'Injury types', 'Treatment', 'Facility'],
      [
        '{{person_name}}',
        '{{body_parts}}',
        '{{injury_types}}',
        '{{treatment}}',
        '{{treated_at_facility}}',
      ],
      'injuries',
    ),
  ) +
  section(
    'Events',
    table(
      ['When', 'Description', 'Recorded by'],
      ['{{occurred_at}}', '{{description}}', '{{recorded_by_name}}'],
      'events',
    ),
  ) +
  section(
    'Contributing factors',
    table(['Category', 'Description'], ['{{category}}', '{{description}}'], 'contributing_factors'),
  ) +
  section(
    'Preventative steps',
    table(
      ['Description', 'Owner', 'Target', 'Status'],
      ['{{description}}', '{{owner_name}}', '{{target_date}}', '{{status}}'],
      'preventative_steps',
    ),
  ) +
  section('Photos', photosTable()) +
  DOC_CLOSE

const CA =
  head(
    'Corrective Action',
    '{{reference}} &middot; {{status_label}} &middot; {{severity_label}}',
    detailRow('Title', '{{title}}') +
      detailRow('Source', '{{source_label}}') +
      detailRow('Owner', '{{owner_name}}') +
      detailRow('Assigned by', '{{assigned_by_name}}') +
      detailRow('Site', '{{site_name}}') +
      detailRow('Assigned on', '{{assigned_on}}') +
      detailRow('Due on', '{{due_on}}'),
  ) +
  para('Description', '{{description}}') +
  para('Root cause', '{{root_cause}}') +
  para('Action taken', '{{action_taken}}') +
  section(
    'Completion steps',
    table(
      ['Kind', 'Description', 'Completed by', 'Completed at'],
      ['{{kind}}', '{{description}}', '{{completed_by_name}}', '{{completed_at}}'],
      'complete_steps',
    ),
  ) +
  section('Photos', photosTable()) +
  DOC_CLOSE

const INSPECTION =
  head(
    'Inspection Report',
    '{{reference}} &middot; {{type_name}} &middot; {{status_label}}',
    detailRow('Occurred', '{{occurred_at}}') +
      detailRow('Site', '{{site_name}}') +
      detailRow('Inspector', '{{inspector_name}}') +
      detailRow('Supervisor', '{{supervisor_name}}'),
  ) +
  section(
    'Inspection items',
    table(
      ['Group', 'Item', 'Answer', 'Severity', 'Non-compliance', 'Action taken'],
      [
        '{{group}}',
        '{{question}}',
        '{{answer}}',
        '{{severity}}',
        '{{non_compliance}}',
        '{{action_taken}}',
      ],
      'criteria',
    ),
  ) +
  para('Notes', '{{notes}}') +
  section('Photos', photosTable()) +
  DOC_CLOSE

const TRAINING =
  head(
    'Training Assessment',
    '{{assessment_name}} &middot; {{status_label}}',
    detailRow('Person', '{{person_name}}') +
      detailRow('Result', '{{pass_fail}}') +
      detailRow('Score', '{{score_percent}}') +
      detailRow('Passing score', '{{passing_score}}') +
      detailRow('Completed', '{{completed_at}}'),
  ) +
  para('Description', '{{assessment_description}}') +
  section(
    'Questions & responses',
    table(
      ['Question', 'Answer', 'Correct answer', 'Result', 'Points'],
      ['{{prompt}}', '{{answer}}', '{{correct_answer}}', '{{result}}', '{{points}}'],
      'questions',
    ),
  ) +
  DOC_CLOSE

const JOURNAL =
  head(
    'Daily Journal',
    '{{reference}} &middot; {{entry_date}}',
    detailRow('Author', '{{author_name}}') +
      detailRow('Supervisor', '{{supervisor_name}}') +
      detailRow('Site', '{{site_name}}') +
      detailRow('Tags', '{{tags}}'),
  ) +
  para('{{title}}', '{{body_text}}') +
  section('Photos', photosTable()) +
  DOC_CLOSE

const EQUIPMENT =
  head(
    'Work Order',
    '{{reference}} &middot; {{status_label}} &middot; {{priority_label}}',
    detailRow('Summary', '{{summary}}') +
      detailRow('Equipment', '{{equipment_name}}') +
      detailRow('Site', '{{site_name}}') +
      detailRow('Assigned to', '{{assigned_to_name}}') +
      detailRow('Reported by', '{{reported_by_name}}') +
      detailRow('Opened', '{{opened_at}}') +
      detailRow('Closed', '{{closed_at}}') +
      detailRow('Cost', '{{cost}}'),
  ) +
  para('Description', '{{description}}') +
  para('Action taken', '{{action_taken}}') +
  DOC_CLOSE

const REVIEW =
  head(
    'Management Review',
    '{{title}}',
    detailRow('Period', '{{period_start}} – {{period_end}}') +
      detailRow('Next review', '{{next_review_on}}') +
      detailRow('Chaired by', '{{chair_name}}') +
      detailRow('Created by', '{{owner_name}}'),
  ) +
  para('Discussion notes', '{{discussion_notes}}') +
  para('Decisions', '{{decisions}}') +
  section('Attendees', table(['Name', 'Email'], ['{{name}}', '{{email}}'], 'attendees')) +
  section(
    'Documents reviewed',
    table(['Document', 'Status'], ['{{title}}', '{{status}}'], 'documents_reviewed'),
  ) +
  section(
    'Action items',
    table(
      ['Reference', 'Title', 'Status', 'Due'],
      ['{{reference}}', '{{title}}', '{{status}}', '{{due_on}}'],
      'action_items',
    ),
  ) +
  DOC_CLOSE

type Seed = {
  key: string
  name: string
  subjectKey: string
  html: string
  orientation: 'portrait' | 'landscape'
  header: string
}

const TEMPLATES: Seed[] = [
  {
    key: 'hazid-assessment-pdf',
    name: 'Hazard Assessment (PDF)',
    subjectKey: 'hazid',
    html: HAZID,
    orientation: 'landscape',
    header: '{{reference}} — {{type_name}}',
  },
  {
    key: 'incident-report-pdf',
    name: 'Incident Report (PDF)',
    subjectKey: 'incidents',
    html: INCIDENT,
    orientation: 'landscape',
    header: 'Incident {{reference}}',
  },
  {
    key: 'corrective-action-pdf',
    name: 'Corrective Action (PDF)',
    subjectKey: 'corrective-actions',
    html: CA,
    orientation: 'portrait',
    header: 'CA {{reference}}',
  },
  {
    key: 'inspection-report-pdf',
    name: 'Inspection Report (PDF)',
    subjectKey: 'inspections',
    html: INSPECTION,
    orientation: 'landscape',
    header: 'Inspection {{reference}}',
  },
  {
    key: 'training-assessment-pdf',
    name: 'Training Assessment (PDF)',
    subjectKey: 'training',
    html: TRAINING,
    orientation: 'portrait',
    header: '{{assessment_name}}',
  },
  {
    key: 'journal-entry-pdf',
    name: 'Daily Journal (PDF)',
    subjectKey: 'journals',
    html: JOURNAL,
    orientation: 'portrait',
    header: 'Journal {{reference}}',
  },
  {
    key: 'work-order-pdf',
    name: 'Equipment Work Order (PDF)',
    subjectKey: 'equipment',
    html: EQUIPMENT,
    orientation: 'portrait',
    header: 'Work order {{reference}}',
  },
  {
    key: 'management-review-pdf',
    name: 'Management Review (PDF)',
    subjectKey: 'documents',
    html: REVIEW,
    orientation: 'portrait',
    header: '{{title}}',
  },
]

async function main() {
  const { db, sql: pg } = createClient({ max: 4 })
  let created = 0
  let updated = 0
  try {
    await withSuperAdmin(db, async (tx) => {
      const tenants = (await tx.execute(sql`select id from tenants`)) as unknown as { id: string }[]
      for (const t of tenants) {
        for (const tpl of TEMPLATES) {
          const compiled = expandRepeatMarkers(tpl.html)
          const footer = 'Page {{page}} of {{pages}}'
          const found = (await tx.execute(
            sql`select id from pdf_templates where tenant_id=${t.id} and key=${tpl.key} and deleted_at is null limit 1`,
          )) as unknown as { id: string }[]
          if (found[0]) {
            await tx.execute(sql`
              update pdf_templates set name=${tpl.name},
                record_subject_type='module', record_subject_key=${tpl.subjectKey},
                orientation=${tpl.orientation}, header_html=${tpl.header}, footer_html=${footer},
                compiled_html=${compiled}, source_html=${tpl.html}, design='{}'::jsonb,
                is_active=true, updated_at=now()
              where id=${found[0].id}`)
            updated++
          } else {
            await tx.execute(sql`
              insert into pdf_templates
                (tenant_id, key, name, record_subject_type, record_subject_key, paper_size,
                 orientation, margin_mm, header_html, footer_html, compiled_html, source_html, is_active)
              values
                (${t.id}, ${tpl.key}, ${tpl.name}, 'module', ${tpl.subjectKey}, 'letter',
                 ${tpl.orientation}, 16, ${tpl.header}, ${footer}, ${compiled}, ${tpl.html}, true)`)
            created++
          }
        }
      }
    })
    console.log(`✔ PDF document templates: ${created} created, ${updated} updated.`)
  } finally {
    await pg.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
