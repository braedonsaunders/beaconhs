// Canonical form templates — first-class library shipped with every tenant.
// Seeded into the first tenant by the dev seed and cloned on-demand into any
// tenant from the "Start from template" gallery at /apps/templates/new.
//
// Each entry is the persistence shape: { key, name, category, moduleBinding,
// description, schema }. Add new canonical templates by appending here — the
// gallery and seed both pick them up automatically.

import type { FormSchemaV1 } from './schema/forms'

type CanonicalTemplate = {
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

// Working at Heights Rescue Plan -------------------------------------------
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
        {
          id: 'height_above_ground_m',
          type: 'number',
          label: { en: 'Height above grade (m)' },
          required: true,
        },
        { id: 'duration_hours', type: 'number', label: { en: 'Expected duration (hours)' } },
        { id: 'supervisor', type: 'person_picker', label: { en: 'Supervisor' }, required: true },
        {
          id: 'workers',
          type: 'multi_person_picker',
          label: { en: 'Workers at height' },
          required: true,
        },
      ],
    },
    {
      id: 'fall_hazards',
      title: { en: 'Fall hazards' },
      fields: [
        {
          id: 'fall_hazards',
          type: 'long_text',
          label: { en: 'Fall hazards identified' },
          required: true,
        },
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
        {
          id: 'anchor_points',
          type: 'long_text',
          label: { en: 'Anchor points (location + rating)' },
          required: true,
        },
        { id: 'controls', type: 'long_text', label: { en: 'Controls in place' }, required: true },
      ],
    },
    {
      id: 'rescue_equipment',
      title: { en: 'Rescue equipment' },
      description: {
        en: 'List every piece of equipment available on-site for self-rescue / assisted rescue.',
      },
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
      description: {
        en: 'Who does what when a rescue is required. Every role assigned to a competent person.',
      },
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
        {
          id: 'training_current',
          type: 'yes_no_comment',
          label: { en: 'Training current?' },
          required: true,
        },
      ],
    },
    {
      id: 'sign_off',
      title: { en: 'Sign-off' },
      fields: [
        {
          id: 'supervisor_signature',
          type: 'signature',
          label: { en: 'Supervisor signature' },
          required: true,
        },
        {
          id: 'worker_signature',
          type: 'signature',
          label: { en: 'Worker signature' },
          required: true,
        },
        { id: 'signed_date', type: 'date', label: { en: 'Signed date' }, required: true },
      ],
    },
  ],
  workflow: SUBMIT_WORKFLOW,
}

// Deliberately NOT canonical templates:
// • JSHA — a first-class native module at /hazard-assessments (multi-section
//   sign-off, hazard library, atmospheric readings); a gallery copy would be
//   confusing alongside it.
// • Lift Plan — a per-tenant built-in seeded by
//   packages/db/src/seed/lift-plan-template.ts, surfaced at
//   /inspections?bound=lift_plan.
// • Toolbox Talk — a per-tenant built-in seeded by
//   packages/db/src/seed/toolbox-template.ts (key 'toolbox-talk') and
//   auto-pinned to the sidebar.
export const CANONICAL_TEMPLATES: CanonicalTemplate[] = [
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
