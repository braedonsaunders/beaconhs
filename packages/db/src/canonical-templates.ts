// Canonical form templates — first-class library shipped with every tenant.
//
// These are the four "big legacy modules" from the original Laravel app
// (JSHA / Toolbox Talk / Lift Plan / Working-at-Heights Rescue Plan) re-implemented
// as form templates. They are seeded into the first tenant by the dev seed, and
// cloned on-demand into any tenant from the "Start from template" gallery
// at /forms/templates/new.
//
// Each entry is the persistence shape: { key, name, category, moduleBinding,
// description, schema }. Add new canonical templates by appending here — the
// gallery and seed both pick them up automatically.

import type { FormSchemaV1 } from './schema/forms'

export type CanonicalTemplate = {
  key: string
  name: string
  category: string
  moduleBinding: string
  description: string
  schema: FormSchemaV1
}

const SUBMIT_WORKFLOW: FormSchemaV1['workflow'] = {
  steps: [
    {
      key: 'submit',
      title: { en: 'Submit' },
      assignee: { type: 'expression', expr: '$submitter' },
    },
  ],
}

const RISK_OPTIONS = [
  { value: 'low', label: { en: 'Low' } },
  { value: 'medium', label: { en: 'Medium' } },
  { value: 'high', label: { en: 'High' } },
  { value: 'critical', label: { en: 'Critical' } },
]

const PPE_OPTIONS = [
  { value: 'hard_hat', label: { en: 'Hard hat' } },
  { value: 'safety_glasses', label: { en: 'Safety glasses' } },
  { value: 'gloves', label: { en: 'Gloves' } },
  { value: 'cut_gloves', label: { en: 'Cut-resistant gloves' } },
  { value: 'respirator', label: { en: 'Respirator' } },
  { value: 'harness', label: { en: 'Fall-arrest harness' } },
  { value: 'high_vis', label: { en: 'Hi-vis vest' } },
  { value: 'safety_boots', label: { en: 'Safety boots' } },
  { value: 'hearing_protection', label: { en: 'Hearing protection' } },
  { value: 'face_shield', label: { en: 'Face shield' } },
]

// 1) JSHA / Job Safety Hazard Analysis -------------------------------------
const jshaSchema: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'JSHA — Job Safety Hazard Analysis' },
  description: {
    en: 'Identify task steps, hazards, initial risk, controls, and residual risk before work starts. Capture sign-off from supervisor + crew.',
  },
  sections: [
    {
      id: 'job_details',
      title: { en: 'Job details' },
      fields: [
        { id: 'job_description', type: 'text', label: { en: 'Job description' }, required: true },
        { id: 'site', type: 'site_picker', label: { en: 'Site' }, required: true },
        { id: 'date_of_work', type: 'date', label: { en: 'Date of work' }, required: true },
        { id: 'supervisor', type: 'person_picker', label: { en: 'Supervisor' }, required: true },
        { id: 'crew_members', type: 'multi_person_picker', label: { en: 'Crew members' } },
      ],
    },
    {
      id: 'hazards',
      title: { en: 'Hazards' },
      description: { en: 'One row per task step. Up to 20 rows.' },
      repeating: true,
      fields: [
        { id: 'task_step', type: 'text', label: { en: 'Task step' }, required: true },
        { id: 'hazard', type: 'text', label: { en: 'Hazard' }, required: true },
        {
          id: 'initial_risk',
          type: 'select',
          label: { en: 'Initial risk' },
          required: true,
          validation: { options: RISK_OPTIONS },
        },
        { id: 'controls', type: 'long_text', label: { en: 'Controls' }, required: true },
        {
          id: 'post_control_risk',
          type: 'select',
          label: { en: 'Post-control risk' },
          required: true,
          validation: { options: RISK_OPTIONS },
        },
        {
          id: 'ppe_required',
          type: 'multi_select',
          label: { en: 'PPE required' },
          validation: { options: PPE_OPTIONS },
        },
        { id: 'evidence', type: 'photo_upload', label: { en: 'Evidence (photo)' } },
      ],
    },
    {
      id: 'sign_off',
      title: { en: 'Sign-off' },
      fields: [
        { id: 'supervisor_signature', type: 'signature', label: { en: 'Supervisor signature' }, required: true },
        { id: 'worker_signature', type: 'signature', label: { en: 'Worker signature' }, required: true },
        { id: 'signed_date', type: 'date', label: { en: 'Signed date' }, required: true },
      ],
    },
  ],
  workflow: SUBMIT_WORKFLOW,
}

// 2) Toolbox Talk ----------------------------------------------------------
const toolboxSchema: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'Toolbox Talk' },
  description: {
    en: 'Pre-shift safety discussion: topic, attendees, key points, action items, photos.',
  },
  sections: [
    {
      id: 'topic',
      title: { en: 'Topic' },
      fields: [
        { id: 'topic', type: 'text', label: { en: 'Topic' }, required: true },
        { id: 'date', type: 'date', label: { en: 'Date' }, required: true },
        { id: 'site', type: 'site_picker', label: { en: 'Site' }, required: true },
        { id: 'facilitator', type: 'person_picker', label: { en: 'Facilitator' }, required: true },
      ],
    },
    {
      id: 'discussion',
      title: { en: 'Discussion' },
      fields: [
        { id: 'discussion_notes', type: 'long_text', label: { en: 'Discussion notes' }, required: true },
        { id: 'questions_raised', type: 'long_text', label: { en: 'Questions raised' } },
        { id: 'action_items', type: 'long_text', label: { en: 'Action items' } },
      ],
    },
    {
      id: 'attendees',
      title: { en: 'Attendees' },
      description: { en: 'Each attendee signs in.' },
      repeating: true,
      fields: [
        { id: 'attendee', type: 'person_picker', label: { en: 'Attendee' }, required: true },
        { id: 'attendee_signature', type: 'signature', label: { en: 'Signature' }, required: true },
      ],
    },
    {
      id: 'photos',
      title: { en: 'Photos' },
      fields: [
        { id: 'photos', type: 'photo_upload', label: { en: 'Photos' }, config: { multiple: true } },
      ],
    },
  ],
  workflow: SUBMIT_WORKFLOW,
}

// 3) Working at Heights Rescue Plan ---------------------------------------
const wahRescueSchema: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'Working at Heights Rescue Plan' },
  description: {
    en: 'Pre-job rescue plan for any work at height. Documents fall hazards, rescue equipment, rescue team roles, and sign-off.',
  },
  sections: [
    {
      id: 'task',
      title: { en: 'Task' },
      fields: [
        { id: 'task_description', type: 'text', label: { en: 'Task description' }, required: true },
        { id: 'site', type: 'site_picker', label: { en: 'Site' }, required: true },
        { id: 'work_date', type: 'date', label: { en: 'Work date' }, required: true },
        { id: 'height_above_ground_m', type: 'number', label: { en: 'Height above grade (m)' }, required: true },
        { id: 'duration_hours', type: 'number', label: { en: 'Expected duration (hours)' } },
        { id: 'supervisor', type: 'person_picker', label: { en: 'Supervisor' }, required: true },
        { id: 'workers', type: 'multi_person_picker', label: { en: 'Workers at height' }, required: true },
      ],
    },
    {
      id: 'fall_hazards',
      title: { en: 'Fall hazards' },
      fields: [
        { id: 'fall_hazards', type: 'long_text', label: { en: 'Fall hazards identified' }, required: true },
        {
          id: 'fall_arrest_method',
          type: 'select',
          label: { en: 'Fall arrest method' },
          required: true,
          validation: {
            options: [
              { value: 'guardrails', label: { en: 'Guardrails' } },
              { value: 'travel_restraint', label: { en: 'Travel restraint' } },
              { value: 'fall_arrest_harness', label: { en: 'Fall-arrest harness + lanyard' } },
              { value: 'safety_net', label: { en: 'Safety net' } },
              { value: 'scaffold_platform', label: { en: 'Scaffold platform' } },
            ],
          },
        },
        { id: 'anchor_points', type: 'long_text', label: { en: 'Anchor points (location + rating)' }, required: true },
        { id: 'controls', type: 'long_text', label: { en: 'Controls in place' }, required: true },
      ],
    },
    {
      id: 'rescue_equipment',
      title: { en: 'Rescue equipment' },
      description: { en: 'List every piece of equipment available on-site for self-rescue / assisted rescue.' },
      repeating: true,
      fields: [
        { id: 'equipment_name', type: 'text', label: { en: 'Equipment' }, required: true },
        { id: 'location', type: 'text', label: { en: 'Location / storage' } },
        { id: 'last_inspected', type: 'date', label: { en: 'Last inspected' } },
        { id: 'photo', type: 'photo_upload', label: { en: 'Photo' } },
      ],
    },
    {
      id: 'rescue_team',
      title: { en: 'Rescue team' },
      description: { en: 'Who does what when a rescue is required. Every role assigned to a competent person.' },
      repeating: true,
      fields: [
        {
          id: 'role',
          type: 'select',
          label: { en: 'Role' },
          required: true,
          validation: {
            options: [
              { value: 'rescue_lead', label: { en: 'Rescue lead' } },
              { value: 'first_aid', label: { en: 'First aid' } },
              { value: 'comms', label: { en: 'Communications' } },
              { value: 'rigging', label: { en: 'Rigging / lowering' } },
              { value: 'liaison_ems', label: { en: 'EMS liaison' } },
            ],
          },
        },
        { id: 'assigned_to', type: 'person_picker', label: { en: 'Assigned to' }, required: true },
        { id: 'training_current', type: 'yes_no_comment', label: { en: 'Training current?' }, required: true },
      ],
    },
    {
      id: 'sign_off',
      title: { en: 'Sign-off' },
      fields: [
        { id: 'supervisor_signature', type: 'signature', label: { en: 'Supervisor signature' }, required: true },
        { id: 'worker_signature', type: 'signature', label: { en: 'Worker signature' }, required: true },
        { id: 'signed_date', type: 'date', label: { en: 'Signed date' }, required: true },
      ],
    },
  ],
  workflow: SUBMIT_WORKFLOW,
}

// Note: JSHA is NOT a canonical template — there's a real first-class
// module at /hazid with multi-section sign-off, hazard library, atmospheric
// readings, etc. The form-template gallery would have been confusing
// alongside the native module, so we skipped it. The `jshaSchema` constant
// is kept above for reference; it isn't exported.
//
// Lift Plan is ALSO not a canonical template — it's now a per-tenant built-in
// template seeded by packages/db/src/seed/lift-plan-template.ts, surfaced at
// /inspections?bound=lift_plan. The gallery is for "start from a template",
// which doesn't make sense for a built-in that's already provisioned.
export const CANONICAL_TEMPLATES: CanonicalTemplate[] = [
  {
    key: 'toolbox_v1',
    name: 'Toolbox Talk',
    category: 'toolbox_talk',
    moduleBinding: 'toolbox_talk',
    description:
      'Pre-shift safety discussion with topic, attendees, key points, action items, photos. Used daily on every active site.',
    schema: toolboxSchema,
  },
  {
    key: 'wah_rescue_v1',
    name: 'Working at Heights Rescue Plan',
    category: 'wah',
    moduleBinding: 'wah',
    description:
      'Pre-job rescue plan for any work at height: fall hazards, rescue equipment, rescue team roles & training, sign-off.',
    schema: wahRescueSchema,
  },
]

export function getCanonicalTemplate(key: string): CanonicalTemplate | undefined {
  return CANONICAL_TEMPLATES.find((t) => t.key === key)
}
