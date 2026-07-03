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
// UPSERTs (re-running refreshes the body/subject/merge fields). Invoked by the
// dev seed (packages/db/src/seed.ts) AFTER seedSubmitEmailFlows: it repoints
// the seeded submit→email+PDF flows from the generic 'record-notification'
// template to these per-module report templates, then retires the generic.

import { sql } from 'drizzle-orm'
import { expandRepeatMarkers } from './expand-repeat-markers'

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

function para(heading: string, token: string): string {
  return `<h2 style="${H2}">${heading}</h2><p style="margin:0 0 6px;font-size:13px;color:#0f172a;line-height:1.5;white-space:pre-wrap;">${token}</p>`
}

function section(heading: string, body: string): string {
  return `<h2 style="${H2}">${heading}</h2>${body}`
}

const PHOTO_CELL =
  '<img src="{{url}}" width="120" style="border-radius:4px;border:1px solid #e2e8f0;display:block;" alt="" />'
function photosTable(): string {
  return table(['Photo', 'Caption'], [PHOTO_CELL, '{{caption}}'], 'photos')
}

function header(title: string, subtitle: string, rows: string): string {
  return (
    `${WRAP_OPEN}\n<h1 style="margin:0 0 2px;font-size:20px;color:#0f172a;">${title}</h1>\n` +
    `<p style="margin:0 0 14px;font-size:13px;color:#64748b;">${subtitle}</p>\n` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:6px">${rows}</table>`
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

// --- incidents (legacy pdf/incident.blade.php) -------------------------------

const INCIDENT_HTML =
  header(
    'Incident Report',
    '{{reference}} &middot; {{status_label}} &middot; {{severity_label}}',
    detailRow('Title', '{{title}}') +
      detailRow('Type', '{{type_label}}') +
      detailRow('Occurred', '{{occurred_at}}') +
      detailRow('Site', '{{site_name}}') +
      detailRow('Department', '{{department_name}}') +
      detailRow('Location', '{{location}}') +
      detailRow('Supervisor', '{{supervisor_name}}') +
      detailRow('Reported by', '{{reported_by_name}}'),
  ) +
  para('Description', '{{description}}') +
  para('Events leading up', '{{events_leading_up}}') +
  para('Immediate action taken', '{{immediate_action_taken}}') +
  para('PPE worn', '{{ppe_worn}}') +
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
  WRAP_CLOSE

const INCIDENT_MERGE = [
  { key: 'reference', label: 'Reference' },
  { key: 'title', label: 'Title' },
  { key: 'status_label', label: 'Status' },
  { key: 'type_label', label: 'Type' },
  { key: 'severity_label', label: 'Severity' },
  { key: 'occurred_at', label: 'Occurred at' },
  { key: 'site_name', label: 'Site name' },
  { key: 'department_name', label: 'Department' },
  { key: 'supervisor_name', label: 'Supervisor' },
  { key: 'reported_by_name', label: 'Reported by' },
]

// --- corrective actions (legacy pdf/correctiveaction.blade.php) --------------

const CA_HTML =
  header(
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
  WRAP_CLOSE

const CA_MERGE = [
  { key: 'reference', label: 'Reference' },
  { key: 'title', label: 'Title' },
  { key: 'status_label', label: 'Status' },
  { key: 'severity_label', label: 'Severity' },
  { key: 'source_label', label: 'Source' },
  { key: 'owner_name', label: 'Owner' },
  { key: 'assigned_by_name', label: 'Assigned by' },
  { key: 'site_name', label: 'Site name' },
  { key: 'due_on', label: 'Due on' },
]

// --- inspections (legacy pdf/inspection.blade.php) ---------------------------

const INSPECTION_HTML =
  header(
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
  WRAP_CLOSE

const INSPECTION_MERGE = [
  { key: 'reference', label: 'Reference' },
  { key: 'type_name', label: 'Inspection type' },
  { key: 'status_label', label: 'Status' },
  { key: 'occurred_at', label: 'Occurred at' },
  { key: 'site_name', label: 'Site name' },
  { key: 'inspector_name', label: 'Inspector' },
  { key: 'supervisor_name', label: 'Supervisor' },
]

// --- training (legacy pdf/trainingassessmentresult.blade.php) -----------------

const TRAINING_HTML =
  header(
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
  WRAP_CLOSE

const TRAINING_MERGE = [
  { key: 'assessment_name', label: 'Assessment' },
  { key: 'person_name', label: 'Person' },
  { key: 'status_label', label: 'Status' },
  { key: 'pass_fail', label: 'Pass / fail' },
  { key: 'score_percent', label: 'Score' },
  { key: 'passing_score', label: 'Passing score' },
  { key: 'completed_at', label: 'Completed at' },
]

// --- equipment work order (legacy pdf/equipmentworkorder.blade.php) -----------

const EQUIPMENT_HTML =
  header(
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
  WRAP_CLOSE

const EQUIPMENT_MERGE = [
  { key: 'reference', label: 'Reference' },
  { key: 'summary', label: 'Summary' },
  { key: 'status_label', label: 'Status' },
  { key: 'priority_label', label: 'Priority' },
  { key: 'equipment_name', label: 'Equipment' },
  { key: 'site_name', label: 'Site name' },
  { key: 'assigned_to_name', label: 'Assigned to' },
  { key: 'reported_by_name', label: 'Reported by' },
]

// --- documents management review (legacy pdf/documentreview.blade.php) --------

const REVIEW_HTML =
  header(
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
  WRAP_CLOSE

const REVIEW_MERGE = [
  { key: 'title', label: 'Title' },
  { key: 'period_start', label: 'Period start' },
  { key: 'period_end', label: 'Period end' },
  { key: 'next_review_on', label: 'Next review on' },
  { key: 'chair_name', label: 'Chaired by' },
  { key: 'owner_name', label: 'Created by' },
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
  {
    key: 'incident-report',
    name: 'Incident report',
    description:
      'Full incident — details, narrative, people, injuries, events, factors, steps, photos.',
    subjectKey: 'incidents',
    subjectTemplate: 'Incident {{reference}}',
    html: INCIDENT_HTML,
    mergeFields: INCIDENT_MERGE,
  },
  {
    key: 'corrective-action-report',
    name: 'Corrective Action report',
    description: 'Corrective action — details, root cause, action taken, completion steps, photos.',
    subjectKey: 'corrective-actions',
    subjectTemplate: 'Corrective Action {{reference}}',
    html: CA_HTML,
    mergeFields: CA_MERGE,
  },
  {
    key: 'inspection-report',
    name: 'Inspection report',
    description: 'Inspection — details, criteria/items with pass-fail, notes, photos.',
    subjectKey: 'inspections',
    subjectTemplate: 'Inspection {{reference}}',
    html: INSPECTION_HTML,
    mergeFields: INSPECTION_MERGE,
  },
  {
    key: 'training-assessment-report',
    name: 'Training Assessment report',
    description: 'Training assessment — result, score, and per-question responses.',
    subjectKey: 'training',
    subjectTemplate: 'Training assessment — {{assessment_name}}',
    html: TRAINING_HTML,
    mergeFields: TRAINING_MERGE,
  },
  {
    key: 'work-order-report',
    name: 'Equipment Work Order report',
    description:
      'Equipment work order — details, equipment, assignment, description, action taken.',
    subjectKey: 'equipment',
    subjectTemplate: 'Work order {{reference}}',
    html: EQUIPMENT_HTML,
    mergeFields: EQUIPMENT_MERGE,
  },
  {
    key: 'management-review-report',
    name: 'Management Review report',
    description:
      'Management review — period, notes, decisions, attendees, documents, action items.',
    subjectKey: 'documents',
    subjectTemplate: 'Management review — {{title}}',
    html: REVIEW_HTML,
    mergeFields: REVIEW_MERGE,
  },
]

type GraphJson = {
  nodes?: { data?: { action?: { action?: string; templateId?: string } } }[]
}

type DrizzleTx = any

export async function seedRecordEmailTemplates(tx: DrizzleTx, tenantId: string): Promise<void> {
  let created = 0
  let updated = 0
  let repointed = 0
  for (const tpl of TEMPLATES) {
    const compiled = expandRepeatMarkers(tpl.html)
    const merge = JSON.stringify(tpl.mergeFields)
    const found = (await tx.execute(
      sql`select id from email_templates where tenant_id=${tenantId} and key=${tpl.key} and deleted_at is null limit 1`,
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
          (${tenantId}, ${tpl.key}, ${tpl.name}, ${tpl.description}, 'notification', 'module',
           ${tpl.subjectKey}, ${tpl.subjectTemplate}, ${compiled}, ${tpl.html},
           ${merge}::jsonb, true)
      `)
      created++
    }
  }

  // Repoint the seeded submit→email+PDF module flows from the generic
  // 'record-notification' template to this module's new report template, then
  // retire the generic. Only touches actions STILL pointing at the generic —
  // user customizations are preserved. The generic lookup deliberately includes
  // an already-retired row so flows seeded after the first retirement still get
  // repointed on re-seed.
  const [generic] = (await tx.execute(
    sql`select id from email_templates where tenant_id=${tenantId} and key='record-notification' limit 1`,
  )) as unknown as { id: string }[]
  if (generic) {
    const reportRows = (await tx.execute(
      sql`select key, id from email_templates where tenant_id=${tenantId} and deleted_at is null and record_subject_type='module'`,
    )) as unknown as { key: string; id: string }[]
    const keyToId = new Map(reportRows.map((r) => [r.key, r.id]))
    const subjectToTemplate = new Map<string, string>()
    for (const tpl of TEMPLATES) {
      const id = keyToId.get(tpl.key)
      if (id) subjectToTemplate.set(tpl.subjectKey, id)
    }
    const flows = (await tx.execute(
      sql`select id, subject_key, graph from form_automations where tenant_id=${tenantId} and subject_type='module'`,
    )) as unknown as { id: string; subject_key: string; graph: GraphJson }[]
    for (const f of flows) {
      const tplId = subjectToTemplate.get(f.subject_key)
      if (!tplId) continue
      let changed = false
      for (const node of f.graph?.nodes ?? []) {
        const action = node?.data?.action
        if (action?.action === 'send_email' && action.templateId === generic.id) {
          action.templateId = tplId
          changed = true
        }
      }
      if (changed) {
        await tx.execute(
          sql`update form_automations set graph=${JSON.stringify(f.graph)}::jsonb, updated_at=now() where id=${f.id}`,
        )
        repointed++
      }
    }
    await tx.execute(
      sql`update email_templates set deleted_at=now(), updated_at=now() where id=${generic.id} and deleted_at is null`,
    )
  }

  console.log(
    `  · record-type email templates: ${created} created, ${updated} updated, ${repointed} flow(s) repointed`,
  )
}
