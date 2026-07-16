// Per-tenant seeder for the record-print PDF DOCUMENT templates
// (pdf_templates) — one bespoke-parity document per native module subject,
// recreating the deleted hand-coded renderers (letterhead heading, badge
// chips, two-column field grids, sectioned collection tables, signature
// blocks, photo lists, page-break hints) as fully builder-editable HTML.
// Every {{token}} / data-each collection maps 1:1 to the module's flow
// profile (apps/web/src/lib/flows/module-profiles.ts) — the same value map
// the adapters' loadValues() returns.
//
// UPSERTs — re-running refreshes the layout. A seeded template becomes the
// module's print default ONLY when the tenant has no default for that subject
// yet (never steals a tenant's chosen default); a template the tenant
// soft-deleted stays deleted. Invoked by the dev seed
// (packages/db/src/seed.ts) for every tenant on every run, together with
// seedFormPdfTemplates below (generated per-Builder-app documents).

import { sql } from 'drizzle-orm'
import { generateFormPdfTemplate, type FormSchemaV1 } from '@beaconhs/forms-core'
import { expandRepeatMarkers } from './expand-repeat-markers'

// --- design language (slate letterhead document) -----------------------------

const FONT = "font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;"
const H1 = 'font-size:21px;font-weight:800;color:#0f172a;margin:0;letter-spacing:.2px;'
const SUB = 'font-size:12px;color:#64748b;margin:3px 0 0;'
const H2 =
  'font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.6px;margin:0;border-bottom:2px solid #0f172a;padding-bottom:3px;'
const CHIP =
  'display:inline-block;border:1px solid #cbd5e1;background:#f1f5f9;color:#334155;border-radius:999px;padding:2px 10px;font-size:10px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;margin:0 6px 4px 0;'
const TH =
  'text-align:left;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10px;color:#475569;font-weight:700;text-transform:uppercase;letter-spacing:.3px;'
const TD =
  'border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;'
const LBL =
  'width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;'
const VAL =
  'width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;'
const TABLE = 'width:100%;border-collapse:collapse;margin:0 0 10px;'
const ROW = 'page-break-inside:avoid;'
const HEAD_CELL = 'border:none;padding:14px 0 6px;'
const NARR =
  'border:1px solid #e2e8f0;border-left:3px solid #0f172a;background:#f8fafc;padding:8px 10px;font-size:11.5px;color:#0f172a;line-height:1.55;white-space:pre-wrap;'
const RIGHT = 'text-align:right;font-variant-numeric:tabular-nums;'

/** Letterhead: document title + subtitle left, reference (or blank) right. */
function letterhead(title: string, subtitle: string, right = ''): string {
  return (
    `<div style="border-bottom:3px solid #0f172a;padding-bottom:8px;margin-bottom:10px;">` +
    `<table style="width:100%;border-collapse:collapse;"><tr>` +
    `<td style="border:none;padding:0;"><h1 style="${H1}">${title}</h1><p style="${SUB}">${subtitle}</p></td>` +
    (right
      ? `<td style="border:none;padding:0;text-align:right;font-size:12px;color:#475569;vertical-align:top;">${right}</td>`
      : '') +
    `</tr></table></div>`
  )
}

/** A row of status/severity badge chips. */
function chips(...tokens: string[]): string {
  return (
    `<div style="margin:0 0 10px;">` +
    tokens.map((t) => `<span style="${CHIP}">${t}</span>`).join('') +
    `</div>`
  )
}

type GridItem =
  | { label: string; value: string } // short pair — packed 2-up
  | { if: string; label: string; value: string } // conditional full-width row

function p(label: string, value: string): GridItem {
  return { label, value }
}
function pIf(gate: string, label: string, value: string): GridItem {
  return { if: gate, label, value }
}

/** Two-column label/value field grid; conditional items get a gated full row. */
function grid(items: GridItem[]): string {
  const out: string[] = []
  let pending: { label: string; value: string } | null = null
  const flush = () => {
    if (!pending) return
    out.push(
      `<tr style="${ROW}"><td style="${LBL}">${pending.label}</td><td colspan="3" style="${VAL}">${pending.value}</td></tr>`,
    )
    pending = null
  }
  for (const it of items) {
    if ('if' in it) {
      flush()
      out.push(
        `<tr data-if="${it.if}" style="${ROW}"><td style="${LBL}">${it.label}</td><td colspan="3" style="${VAL}">${it.value}</td></tr>`,
      )
      continue
    }
    if (pending) {
      out.push(
        `<tr style="${ROW}"><td style="${LBL}">${pending.label}</td><td style="${VAL}">${pending.value}</td>` +
          `<td style="${LBL}">${it.label}</td><td style="${VAL}">${it.value}</td></tr>`,
      )
      pending = null
    } else {
      pending = { label: it.label, value: it.value }
    }
  }
  flush()
  return `<table style="${TABLE}">${out.join('')}</table>`
}

/** A section heading on its own (gate hides it with its content). */
function heading(title: string, gate?: string): string {
  const marker = gate ? ` data-if="${gate}"` : ''
  return `<table style="width:100%;border-collapse:collapse;"><tr${marker}><td style="${HEAD_CELL}"><div style="${H2}">${title}</div></td></tr></table>`
}

type Col = [header: string, cell: string, extraStyle?: string]

/**
 * A sectioned collection table: heading + header row gated on the collection
 * (empty ⇒ the whole block collapses), one data-each body row, optional
 * static footer row (totals).
 */
function collection(title: string, eachKey: string, cols: Col[], footerRow = ''): string {
  const ths = cols.map(([h, , s]) => `<th style="${TH}${s ?? ''}">${h}</th>`).join('')
  const tds = cols.map(([, c, s]) => `<td style="${TD}${s ?? ''}">${c}</td>`).join('')
  return (
    `<table style="${TABLE}">` +
    `<tr data-if="${eachKey}"><td colspan="${cols.length}" style="${HEAD_CELL}"><div style="${H2}">${title}</div></td></tr>` +
    `<tr data-if="${eachKey}">${ths}</tr>` +
    `<tr data-each="${eachKey}" style="${ROW}">${tds}</tr>` +
    footerRow +
    `</table>`
  )
}

/** A narrative block (heading + pre-wrap prose), hidden when empty. */
function narrative(title: string, token: string, gate = ''): string {
  const g = gate || token.replace(/[{}]/g, '')
  return (
    `<table style="width:100%;border-collapse:collapse;margin:0 0 10px;">` +
    `<tr data-if="${g}" style="${ROW}"><td style="border:none;padding:12px 0 0;">` +
    `<div style="${H2}">${title}</div>` +
    `<div style="${NARR}margin-top:6px;">${token}</div>` +
    `</td></tr></table>`
  )
}

/** Photo list: gated heading + one bordered image per row with its caption. */
function photos(eachKey = 'photos', title = 'Photos'): string {
  return (
    `<table style="width:100%;border-collapse:collapse;margin:0 0 10px;">` +
    `<tr data-if="${eachKey}"><td style="${HEAD_CELL}"><div style="${H2}">${title}</div></td></tr>` +
    `<tr data-each="${eachKey}" style="${ROW}"><td style="border:none;padding:4px 0 8px;">` +
    `<img src="{{url}}" width="320" style="border:1px solid #e2e8f0;border-radius:4px;display:block;" alt="" />` +
    `<div style="font-size:10px;color:#64748b;padding-top:3px;">{{caption}}</div>` +
    `</td></tr></table>`
  )
}

/** Blank ruled manual sign-off block (name / signature / date lines). */
function signoff(labels: string[], title = 'Sign-off'): string {
  const cells = labels
    .map(
      (l) =>
        `<td style="border:none;padding:34px 18px 0 0;"><div style="border-top:1.5px solid #334155;padding-top:4px;font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:.4px;">${l}</div></td>`,
    )
    .join('')
  return (
    `<table style="width:100%;border-collapse:collapse;margin-top:16px;">` +
    `<tr style="${ROW}"><td style="${HEAD_CELL}"><div style="${H2}">${title}</div>` +
    `<table style="width:100%;border-collapse:collapse;"><tr>${cells}</tr></table>` +
    `</td></tr></table>`
  )
}

/** An inline signature <img> that renders nothing when unsigned. */
function sigImg(token: string, maxH = 44): string {
  return `{{#if ${token.replace(/[{}]/g, '')}}}<img src="${token}" style="max-height:${maxH}px;display:block;" alt="" />{{/if}}`
}

const wrap = (body: string) => `<div style="${FONT}color:#0f172a;">${body}</div>`

// --- the module documents ----------------------------------------------------

const HAZID = wrap(
  letterhead('Hazard Assessment', '{{type_name}}', 'Reference <strong>{{reference}}</strong>') +
    chips('{{status_label}}', '{{type_name}}') +
    heading('General information') +
    grid([
      p('Occurred', '{{occurred_at}}'),
      p('Site', '{{site_name}}'),
      p('Location on site', '{{location_on_site}}'),
      p('Project', '{{project_name}}'),
      p('Supervisor', '{{supervisor_name}}'),
      p('Reported by', '{{reported_by_name}}'),
      pIf('locked_at', 'Locked at', '{{locked_at}}'),
    ]) +
    narrative('Job scope', '{{job_scope}}') +
    collection('Tasks', 'tasks', [
      ['#', '{{@number}}', 'width:4%;'],
      ['Task', '{{name}}', 'width:30%;'],
      ['Controls', '{{controls}}'],
    ]) +
    collection('Hazards & controls', 'hazards', [
      ['#', '{{@number}}', 'width:4%;'],
      ['Hazard', '{{name}}'],
      ['Standard controls', '{{standard_controls}}'],
      ['Specific controls', '{{specific_controls}}'],
      ['Pre L/S (risk)', '{{pre_likelihood}} / {{pre_severity}} ({{pre_risk}})', 'width:9%;'],
      ['Post L/S (risk)', '{{post_likelihood}} / {{post_severity}} ({{post_risk}})', 'width:9%;'],
      ['Applies', '{{applicable}}', 'width:6%;'],
    ]) +
    collection('PPE manifest', 'ppe', [
      ['PPE', '{{name}}', 'width:22%;'],
      ['Description', '{{description}}'],
      ['Required', '{{required}}', 'width:10%;'],
      ['Answer', '{{answer}}', 'width:10%;'],
    ]) +
    collection('Questions & answers', 'questions', [
      ['#', '{{@number}}', 'width:4%;'],
      ['Question', '{{question}}'],
      ['Answer', '{{answer}}', 'width:14%;'],
      ['Requires yes', '{{requires_yes}}', 'width:11%;'],
    ]) +
    collection('Signatures', 'signatures', [
      ['Name', '{{name}}'],
      ['Type', '{{type}}', 'width:12%;'],
      ['Entrant', '{{cs_entrant}}', 'width:8%;'],
      ['Attendant', '{{cs_attendant}}', 'width:8%;'],
      ['Rescue', '{{cs_rescue}}', 'width:8%;'],
      ['Signature', sigImg('{{image}}'), 'width:20%;'],
      ['Signed', '{{signed_at}}', 'width:14%;'],
    ]) +
    photos(),
)

const INCIDENT = wrap(
  letterhead('Incident Report', '{{title}}', 'Reference <strong>{{reference}}</strong>') +
    chips('{{severity_label}}', '{{status_label}}', '{{type_label}}') +
    heading('General information') +
    grid([
      p('Occurred', '{{occurred_at}}'),
      p('Reported', '{{reported_at}}'),
      p('Site', '{{site_name}}'),
      p('Location on site', '{{location}}'),
      p('Department', '{{department_name}}'),
      p('Weather', '{{weather}}'),
      p('Supervisor', '{{supervisor_name}}'),
      p('Foreman', '{{foreman_text}}'),
      p('Reported by', '{{reported_by_name}}'),
      p('Closed at', '{{closed_at}}'),
      pIf('classification_labels', 'Classification', '{{classification_labels}}'),
    ]) +
    narrative('Events leading up to the incident', '{{events_leading_up}}') +
    narrative('Event details / cause', '{{description}}') +
    narrative('Immediate action taken', '{{immediate_action_taken}}') +
    narrative('PPE worn', '{{ppe_worn}}') +
    collection('People involved', 'people_involved', [
      ['Name', '{{name}}'],
      ['Role', '{{role}}'],
    ]) +
    heading('Witnesses & external parties', 'witnesses') +
    grid([
      pIf('external_people_involved', 'External people involved', '{{external_people_involved}}'),
      pIf('witnesses', 'Witnesses', '{{witnesses}}'),
    ]) +
    heading('Medical & regulatory') +
    grid([
      pIf('critical_injury', 'Critical injury', 'Yes'),
      pIf('ministry_of_labour_notified', '{{regulatory_authority_name}} notified', 'Yes'),
      pIf('ems_notified', 'EMS notified', 'Yes'),
      pIf('externally_reportable', 'Externally reportable', 'Yes'),
      pIf('first_aid_received', 'First aid received', 'Yes — provider: {{first_aid_provider}}'),
      pIf(
        'medical_attention_received',
        'Medical attention',
        'Yes — treated at {{treated_at_hospital}}, {{treated_in_city}} · transport: {{transportation}}',
      ),
      pIf(
        'lost_time',
        'Lost time',
        '{{lost_time_first_day}} → {{lost_time_last_day}} ({{lost_time_days}} days)',
      ),
      pIf(
        'modified_duty',
        'Modified duty',
        '{{modified_duty_first_day}} → {{modified_duty_last_day}} ({{modified_duty_days}} days)',
      ),
      p('Actual severity (1–5)', '{{actual_severity}}'),
      p('Potential severity (1–5)', '{{potential_severity}}'),
    ]) +
    collection('Injuries', 'injuries', [
      ['Person', '{{person_name}}'],
      ['Body part(s)', '{{body_parts}}'],
      ['Injury type(s)', '{{injury_types}}'],
      ['Result / outcome', '{{injury_result}}'],
      ['Treatment', '{{treatment}}'],
      ['Facility', '{{treated_at_facility}}'],
      ['Hours prior', '{{worked_hours_prior_to}}', RIGHT + 'width:8%;'],
    ]) +
    collection('Lost-time events', 'lost_time_events', [
      ['Status', '{{status}}', 'width:18%;'],
      ['From', '{{valid_from}}', 'width:16%;'],
      ['To', '{{valid_to}}', 'width:16%;'],
      ['Notes', '{{notes}}'],
    ]) +
    collection('Investigation events', 'events', [
      ['When', '{{occurred_at}}', 'width:18%;'],
      ['Description', '{{description}}'],
      ['Recorded by', '{{recorded_by_name}}', 'width:18%;'],
    ]) +
    narrative('Root cause', '{{root_cause}}') +
    collection('Contributing factors', 'contributing_factors', [
      ['Category', '{{category}}', 'width:24%;'],
      ['Description', '{{description}}'],
    ]) +
    collection('Preventative steps', 'preventative_steps', [
      ['#', '{{@number}}', 'width:4%;'],
      ['Description', '{{description}}'],
      ['Owner', '{{owner_name}}', 'width:16%;'],
      ['Target', '{{target_date}}', 'width:12%;'],
      ['Status', '{{status}}', 'width:12%;'],
    ]) +
    photos() +
    signoff(['Signature', 'Investigator / Supervisor', 'Date signed']),
)

const CA = wrap(
  letterhead('Corrective Action', '{{title}}', 'Reference <strong>{{reference}}</strong>') +
    chips('{{severity_label}}', '{{status_label}}', '{{source_label}}') +
    heading('General') +
    grid([
      p('Status', '{{status_label}}'),
      p('Severity', '{{severity_label}}'),
      p('Source', '{{source_label}}'),
      p('Site', '{{site_name}}'),
      p('Owner', '{{owner_name}}'),
      p('Assigned by', '{{assigned_by_name}}'),
      p('Assigned on', '{{assigned_on}}'),
      p('Due on', '{{due_on}}'),
      pIf('closed_at', 'Closed at', '{{closed_at}}'),
      pIf('cost_impact', 'Cost impact', '{{cost_impact}}'),
    ]) +
    narrative('Description', '{{description}}') +
    narrative('Root cause', '{{root_cause}}') +
    narrative('Action taken', '{{action_taken}}') +
    heading('Verification', 'verification_required') +
    grid([
      pIf('verification_required', 'Verified by', '{{verifier_name}}'),
      pIf('verification_required', 'Verified at', '{{verified_at}}'),
      pIf('verification_notes', 'Verification notes', '{{verification_notes}}'),
    ]) +
    collection('Completion steps', 'complete_steps', [
      ['#', '{{@number}}', 'width:5%;'],
      ['Step', '{{kind}}', 'width:16%;'],
      ['Description', '{{description}}'],
      ['Completed by', '{{completed_by_name}}', 'width:16%;'],
      ['Completed at', '{{completed_at}}', 'width:15%;'],
      ['Signature', sigImg('{{signature_image}}'), 'width:18%;'],
    ]) +
    photos(),
)

const INSPECTION = wrap(
  letterhead('Inspection Report', '{{type_name}}', 'Reference <strong>{{reference}}</strong>') +
    chips('{{status_label}}', '{{type_name}}') +
    heading('General information') +
    grid([
      p('Occurred', '{{occurred_at}}'),
      p('Site', '{{site_name}}'),
      p('Inspector', '{{inspector_name}}'),
      p('Supervisor', '{{supervisor_name}}'),
      p('Foreman', '{{foreman_text}}'),
      pIf('submitted_at', 'Submitted at', '{{submitted_at}}'),
      pIf('closed_at', 'Closed at', '{{closed_at}}'),
    ]) +
    collection('Inspection items', 'criteria', [
      ['Group', '{{group}}', 'width:14%;'],
      ['Item', '{{question}}'],
      ['Answer', '{{answer}}', 'width:9%;'],
      ['Severity', '{{severity}}', 'width:9%;'],
      ['Non-compliance', '{{non_compliance}}', 'width:20%;'],
      ['Action taken', '{{action_taken}}', 'width:20%;'],
    ]) +
    narrative('Notes', '{{notes}}') +
    heading('Customer sign-off', 'customer_name') +
    grid([
      pIf('customer_name', 'Customer', '{{customer_name}}'),
      pIf('customer_contact_name', 'Customer contact', '{{customer_contact_name}}'),
      pIf('customer_signer_name', 'Signed by', '{{customer_signer_name}}'),
      pIf('customer_signed_at', 'Signed at', '{{customer_signed_at}}'),
      pIf('customer_signature_image', 'Signature', sigImg('{{customer_signature_image}}', 56)),
    ]) +
    photos(),
)

const TRAINING = wrap(
  letterhead('Training Assessment', '{{assessment_name}}', '{{person_name}}') +
    chips('{{status_label}}', '{{pass_fail}}') +
    heading('Result') +
    grid([
      p('Person', '{{person_name}}'),
      p('Result', '{{pass_fail}}'),
      p('Score', '{{score_percent}}'),
      p('Passing score', '{{passing_score}}'),
      p('Completed', '{{completed_at}}'),
    ]) +
    narrative('About this assessment', '{{assessment_description}}') +
    collection('Questions & responses', 'questions', [
      ['#', '{{@number}}', 'width:5%;'],
      ['Question', '{{prompt}}'],
      ['Answer', '{{answer}}', 'width:18%;'],
      ['Correct answer', '{{correct_answer}}', 'width:18%;'],
      ['Result', '{{result}}', 'width:9%;'],
      ['Points', '{{points}}', RIGHT + 'width:7%;'],
    ]),
)

const JOURNAL = wrap(
  letterhead('Daily Journal', '{{entry_date}}', 'Reference <strong>{{reference}}</strong>') +
    heading('Details') +
    grid([
      p('Entry date', '{{entry_date}}'),
      p('Author', '{{author_name}}'),
      p('Supervisor', '{{supervisor_name}}'),
      p('Site', '{{site_name}}'),
      pIf('weather', 'Weather', '{{weather}}'),
      pIf('tags', 'Tags', '{{tags}}'),
      pIf('title', 'Title', '{{title}}'),
    ]) +
    narrative('Entry', '{{body_text}}') +
    photos(),
)

const EQUIPMENT = wrap(
  letterhead('Equipment Work Order', '{{summary}}', 'Reference <strong>{{reference}}</strong>') +
    chips('{{status_label}}', 'Priority: {{priority_label}}') +
    heading('Work order') +
    grid([
      p('Status', '{{status_label}}'),
      p('Priority', '{{priority_label}}'),
      p('Opened', '{{opened_at}}'),
      p('Closed', '{{closed_at}}'),
      p('Reported by', '{{reported_by_name}}'),
      p('Opened by', '{{opened_by_name}}'),
      p('Assigned to', '{{assigned_to_name}}'),
      pIf('cost', 'Cost', '{{cost}}'),
    ]) +
    heading('Equipment item') +
    grid([
      p('Equipment', '{{equipment_name}}'),
      p('Asset tag', '{{asset_tag}}'),
      p('Serial #', '{{serial_number}}'),
      p('Type', '{{equipment_type_name}}'),
      p('Category', '{{equipment_category_name}}'),
      p('Status', '{{equipment_status_label}}'),
      p('Manufacturer', '{{manufacturer}}'),
      p('Model', '{{model}}'),
      pIf('license_plate', 'License plate', '{{license_plate}}'),
      p('Current site', '{{site_name}}'),
      p('Current holder', '{{holder_name}}'),
      pIf('equipment_description', 'Description', '{{equipment_description}}'),
    ]) +
    narrative('Description', '{{description}}') +
    narrative('Action taken', '{{action_taken}}') +
    signoff(['Assigned technician — name / signature', 'Supervisor — name / signature']),
)

const REVIEW = wrap(
  letterhead('Management Review', '{{title}}') +
    heading('Details') +
    grid([
      p('Period', '{{period_start}} – {{period_end}}'),
      p('Next review', '{{next_review_on}}'),
      p('Chaired by', '{{chair_name}}'),
      p('Created by', '{{owner_name}}'),
    ]) +
    narrative('Discussion notes', '{{discussion_notes}}') +
    narrative('Decisions', '{{decisions}}') +
    collection('Attendees', 'attendees', [
      ['Name', '{{name}}'],
      ['Email', '{{email}}'],
    ]) +
    collection('Documents reviewed', 'documents_reviewed', [
      ['Document', '{{title}}'],
      ['Version', '{{version}}', 'width:12%;'],
      ['Status', '{{status}}', 'width:20%;'],
    ]) +
    collection('Action items', 'action_items', [
      ['Reference', '{{reference}}', 'width:14%;'],
      ['Title', '{{title}}'],
      ['Status', '{{status}}', 'width:14%;'],
      ['Due', '{{due_on}}', 'width:14%;'],
    ]),
)

const EQUIPMENT_INSPECTION = wrap(
  letterhead(
    'Equipment Inspection',
    '{{type_name}} · {{equipment_name}}',
    'Reference <strong>{{reference}}</strong>',
  ) +
    chips('{{status_label}}', '{{result_label}}', '{{interval_label}}') +
    heading('General information') +
    grid([
      p('Equipment', '{{equipment_name}}'),
      p('Asset tag', '{{asset_tag}}'),
      p('Serial #', '{{serial}}'),
      p('Rental', '{{is_rental}}'),
      p('Occurred', '{{occurred_at}}'),
      p('Next due', '{{next_due_on}}'),
      p('Hours reading', '{{hours}}'),
      p('Site', '{{site_name}}'),
      p('Inspector', '{{inspector_name}}'),
    ]) +
    collection('Inspection items', 'criteria', [
      ['Group', '{{group}}', 'width:14%;'],
      ['Item', '{{question}}'],
      ['Answer', '{{answer}}', 'width:9%;'],
      ['Severity', '{{severity}}', 'width:9%;'],
      ['Comment', '{{comment}}', 'width:20%;'],
      ['Action taken', '{{action_taken}}', 'width:20%;'],
    ]) +
    narrative('Notes', '{{notes}}') +
    photos(),
)

const PPE_INSPECTION = wrap(
  letterhead(
    'PPE Inspection',
    '{{type_name}} · {{item_serial}}',
    'Reference <strong>{{reference}}</strong>',
  ) +
    chips('{{kind_label}}', '{{result_label}}') +
    heading('Inspection') +
    grid([
      p('Inspected on', '{{inspected_on}}'),
      p('Next due on', '{{next_due_on}}'),
      p('Inspected by', '{{inspector_name}}'),
      p('Result', '{{result_label}}'),
    ]) +
    heading('PPE item') +
    grid([
      p('Type', '{{type_name}}'),
      p('Category', '{{type_category}}'),
      p('Serial #', '{{item_serial}}'),
      p('Size', '{{item_size}}'),
      p('Issued to', '{{holder_name}}'),
    ]) +
    narrative('Notes', '{{notes}}'),
)

const PPE_ISSUE = wrap(
  letterhead(
    'PPE Issue Report',
    '{{type_name}} · {{item_serial}}',
    'Reference <strong>{{reference}}</strong>',
  ) +
    chips('{{status_label}}') +
    heading('Report') +
    grid([
      p('Reported', '{{reported_at}}'),
      p('Status', '{{status_label}}'),
      p('Reported by', '{{reported_by_name}}'),
      pIf('resolved_at', 'Resolved', '{{resolved_at}}'),
    ]) +
    heading('PPE item') +
    grid([
      p('Type', '{{type_name}}'),
      p('Category', '{{type_category}}'),
      p('Serial #', '{{item_serial}}'),
      p('Size', '{{item_size}}'),
      p('Item status', '{{item_status_label}}'),
      p('Current holder', '{{holder_name}}'),
      p('Purchase date', '{{purchase_date}}'),
      p('Expires on', '{{expires_on}}'),
    ]) +
    narrative('Description', '{{description}}') +
    narrative('Resolution', '{{resolution}}'),
)

const TRAINING_CLASS = wrap(
  letterhead('Training Class', '{{course_name}}', '{{status_label}}') +
    chips('{{status_label}}', '{{course_code}}') +
    heading('Session') +
    grid([
      p('Class', '{{title}}'),
      p('Course', '{{course_name}} ({{course_code}})'),
      p('Starts', '{{starts_at}}'),
      p('Ends', '{{ends_at}}'),
      p('Location', '{{site_name}}'),
      p('Instructor', '{{instructor_name}}'),
      p('Capacity', '{{capacity}}'),
      p(
        'Roster',
        '{{attendee_count}} enrolled · {{attended_count}} attended · {{absent_count}} absent',
      ),
    ]) +
    narrative('About this course', '{{course_description}}') +
    narrative('Notes', '{{notes}}') +
    collection('Attendees', 'attendees', [
      ['#', '{{@number}}', 'width:5%;'],
      ['Name', '{{name}}'],
      ['Email', '{{email}}'],
      ['Status', '{{status}}', 'width:14%;'],
    ]),
)

// The legacy monthly truck-log sheet: the value map carries the whole
// driver+vehicle month (`entries` + month totals) anchored on one entry.
const VEHICLE_LOG_TOTALS =
  `<tr data-if="entries" style="${ROW}">` +
  `<td colspan="5" style="${TD}${RIGHT}background:#e2e8f0;font-weight:700;">Month total</td>` +
  `<td style="${TD}${RIGHT}background:#e2e8f0;font-weight:700;">{{month_business_km}}</td>` +
  `<td style="${TD}${RIGHT}background:#e2e8f0;font-weight:700;">{{month_personal_km}}</td>` +
  `<td style="${TD}${RIGHT}background:#e2e8f0;font-weight:700;">{{month_total_km}}</td>` +
  `<td style="${TD}${RIGHT}background:#e2e8f0;font-weight:700;">{{month_hours_on_site}}</td>` +
  `<td colspan="2" style="${TD}background:#e2e8f0;font-weight:700;">{{month_days_logged}} days logged</td>` +
  `</tr>`

const VEHICLE_LOG = wrap(
  letterhead(
    'Vehicle Log',
    '{{month_label}} · {{driver_name}} · {{vehicle_name}}',
    '{{month_key}}',
  ) +
    heading('Details') +
    grid([
      p('Driver', '{{driver_name}}'),
      p('Employee #', '{{driver_employee_no}}'),
      p('Vehicle', '{{vehicle_name}}'),
      p('Month', '{{month_label}}'),
    ]) +
    collection(
      'Daily entries',
      'entries',
      [
        ['Day', '{{day}} {{weekday}}', 'width:7%;white-space:nowrap;'],
        ['Customer / site', '{{site_name}}'],
        ['Other destination', '{{other_destination}}'],
        ['Start odo', '{{start_odometer}}', RIGHT + 'width:7%;'],
        ['End odo', '{{end_odometer}}', RIGHT + 'width:7%;'],
        ['Business km', '{{business_km}}', RIGHT + 'width:7%;'],
        ['Personal km', '{{personal_km}}', RIGHT + 'width:7%;'],
        ['Total km', '{{total_km}}', RIGHT + 'width:7%;'],
        ['Hours', '{{hours_on_site}}', RIGHT + 'width:6%;'],
        ['Crew', '{{crew_count}}', RIGHT + 'width:5%;'],
        ['Notes', '{{notes}}', 'width:12%;'],
      ],
      VEHICLE_LOG_TOTALS,
    ),
)

const EQUIPMENT_ASSET = wrap(
  letterhead('Equipment Asset Record', '{{name}}', 'Reference <strong>{{reference}}</strong>') +
    chips('{{status_label}}', '{{ownership}}') +
    heading('Asset') +
    grid([
      p('Asset tag', '{{asset_tag}}'),
      p('Name', '{{name}}'),
      p('Serial #', '{{serial_number}}'),
      p('Manufacturer', '{{manufacturer}}'),
      p('Model', '{{model}}'),
      pIf('vin', 'VIN', '{{vin}}'),
      pIf('license_plate', 'License plate', '{{license_plate}}'),
      p('Category', '{{category_name}}'),
      p('Type', '{{type_name}}'),
      p('Ownership', '{{ownership}}'),
      p('Location', '{{site_name}}'),
      p('Current holder', '{{holder_name}}'),
    ]) +
    narrative('Description', '{{description}}'),
)

export type ModulePdfTemplateSeed = {
  key: string
  name: string
  subjectKey: string
  html: string
  orientation: 'portrait' | 'landscape'
  header: string
}

// Exported so the web app's token-contract test can verify every {{token}} /
// collection against MODULE_FLOW_PROFILES (which lives in apps/web).
export const MODULE_PDF_TEMPLATE_SEEDS: ModulePdfTemplateSeed[] = [
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
  {
    key: 'equipment-inspection-pdf',
    name: 'Equipment Inspection (PDF)',
    subjectKey: 'equipment-inspections',
    html: EQUIPMENT_INSPECTION,
    orientation: 'landscape',
    header: 'Equipment inspection {{reference}}',
  },
  {
    key: 'ppe-inspection-pdf',
    name: 'PPE Inspection (PDF)',
    subjectKey: 'ppe',
    html: PPE_INSPECTION,
    orientation: 'portrait',
    header: 'PPE inspection {{reference}}',
  },
  {
    key: 'ppe-issue-report-pdf',
    name: 'PPE Issue Report (PDF)',
    subjectKey: 'ppe-issues',
    html: PPE_ISSUE,
    orientation: 'portrait',
    header: 'PPE issue {{reference}}',
  },
  {
    key: 'training-class-pdf',
    name: 'Training Class (PDF)',
    subjectKey: 'training-classes',
    html: TRAINING_CLASS,
    orientation: 'portrait',
    header: '{{title}}',
  },
  {
    key: 'vehicle-log-month-pdf',
    name: 'Vehicle Log — Monthly Sheet (PDF)',
    subjectKey: 'vehicle-log',
    html: VEHICLE_LOG,
    orientation: 'landscape',
    header: 'Vehicle log {{month_label}}',
  },
  {
    key: 'equipment-asset-pdf',
    name: 'Equipment Asset Record (PDF)',
    subjectKey: 'equipment-assets',
    html: EQUIPMENT_ASSET,
    orientation: 'portrait',
    header: 'Asset {{reference}}',
  },
]

type DrizzleTx = any

// `is_module_default` may only be true for ONE template per (tenant, subject) —
// the partial unique index enforces it. Seeds claim the default only when the
// subject has none (a tenant's explicit choice is never stolen).
function noDefaultExists(tenantId: string, subjectKey: string) {
  return sql`not exists (
    select 1 from pdf_templates p2
    where p2.tenant_id = ${tenantId}
      and p2.record_subject_type = 'module'
      and p2.record_subject_key = ${subjectKey}
      and p2.is_module_default
      and p2.deleted_at is null
  )`
}

export async function seedPdfTemplates(tx: DrizzleTx, tenantId: string): Promise<void> {
  let created = 0
  let updated = 0
  for (const tpl of MODULE_PDF_TEMPLATE_SEEDS) {
    const compiled = expandRepeatMarkers(tpl.html)
    const footer = 'Page {{page}} of {{pages}}'
    // The tenant-key unique index covers soft-deleted rows too — look the row
    // up regardless, and respect a tenant's deletion of a seeded template.
    const found = (await tx.execute(
      sql`select id, deleted_at from pdf_templates where tenant_id=${tenantId} and key=${tpl.key} limit 1`,
    )) as unknown as { id: string; deleted_at: string | null }[]
    if (found[0]?.deleted_at) continue
    if (found[0]) {
      await tx.execute(sql`
        update pdf_templates set name=${tpl.name},
          record_subject_type='module', record_subject_key=${tpl.subjectKey},
          orientation=${tpl.orientation}, header_html=${tpl.header}, footer_html=${footer},
          compiled_html=${compiled}, source_html=${tpl.html},
          is_active=true,
          is_module_default=(is_module_default or ${noDefaultExists(tenantId, tpl.subjectKey)}),
          updated_at=now()
        where id=${found[0].id}`)
      updated++
    } else {
      await tx.execute(sql`
        insert into pdf_templates
          (tenant_id, key, name, record_subject_type, record_subject_key, paper_size,
           orientation, margin_mm, header_html, footer_html, compiled_html, source_html,
           is_active, is_module_default)
        values
          (${tenantId}, ${tpl.key}, ${tpl.name}, 'module', ${tpl.subjectKey}, 'letter',
           ${tpl.orientation}, 14, ${tpl.header}, ${footer}, ${compiled}, ${tpl.html},
           true, ${noDefaultExists(tenantId, tpl.subjectKey)})`)
      created++
    }
  }
  console.log(`  · PDF document templates: ${created} created, ${updated} updated`)
}

/**
 * Backfill a generated default PDF document per PUBLISHED Builder app that has
 * none yet (recordSubjectType='form_template'). Never touches a form that
 * already has any template — user edits are sacred. Same generator the
 * publish hook uses (apps/web/src/lib/pdf-template-generate.ts).
 */
export async function seedFormPdfTemplates(tx: DrizzleTx, tenantId: string): Promise<void> {
  const forms = (await tx.execute(sql`
    select ft.id, ft.key, ft.name, v.schema
    from form_templates ft
    join lateral (
      select schema from form_template_versions v
      where v.template_id = ft.id
      order by v.version desc
      limit 1
    ) v on true
    where ft.tenant_id=${tenantId} and ft.status='published' and ft.deleted_at is null
  `)) as unknown as { id: string; key: string; name: string; schema: FormSchemaV1 }[]

  let created = 0
  for (const form of forms) {
    // Any template for the subject — INCLUDING soft-deleted ones — means the
    // tenant has (or explicitly removed) a document for this app: skip.
    const existing = (await tx.execute(sql`
      select id from pdf_templates
      where tenant_id=${tenantId} and record_subject_type='form_template'
        and record_subject_key=${form.id}
      limit 1
    `)) as unknown as { id: string }[]
    if (existing[0]) continue

    const gen = generateFormPdfTemplate(form.schema, form.name)
    const compiled = expandRepeatMarkers(gen.sourceHtml)

    // The tenant-key unique index covers soft-deleted rows — probe all keys.
    let key = `form-${form.key}-pdf`
    for (let n = 2; ; n++) {
      const taken = (await tx.execute(
        sql`select 1 as x from pdf_templates where tenant_id=${tenantId} and key=${key} limit 1`,
      )) as unknown as { x: number }[]
      if (!taken[0]) break
      key = `form-${form.key}-pdf-${n}`
    }

    await tx.execute(sql`
      insert into pdf_templates
        (tenant_id, key, name, record_subject_type, record_subject_key, paper_size,
         orientation, margin_mm, header_html, footer_html, compiled_html, source_html,
         is_active, is_module_default)
      values
        (${tenantId}, ${key}, ${`${form.name} PDF`}, 'form_template', ${form.id}, 'letter',
         'portrait', 14, ${gen.headerHtml}, ${gen.footerHtml}, ${compiled}, ${gen.sourceHtml},
         true, true)`)
    created++
  }
  if (created > 0) console.log(`  · Builder app PDF templates: ${created} generated`)
}
