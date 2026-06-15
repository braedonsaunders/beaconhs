// Built-in form-builder apps that can be embedded inside hazard assessment
// types. These replace hard-coded specialty sub-forms for new dev/demo data
// while preserving the native assessment as the parent work document.

import { and, eq } from 'drizzle-orm'
import { formTemplates, formTemplateVersions } from '../schema'
import type { FormSchemaV1 } from '../schema/forms'

export const HAZID_CONFINED_SPACE_APP_KEY = 'hazid-confined-space-entry-plan'
export const HAZID_ARC_FLASH_APP_KEY = 'hazid-arc-flash-work-plan'
export const HAZID_FALL_PROTECTION_APP_KEY = 'hazid-fall-protection-plan'

const submitterStep = (key: string, title: string) => ({
  key,
  title: { en: title },
  assignee: { type: 'expression' as const, expr: '$submitter' },
})

const yesNo = (id: string, label: string, required = true) => ({
  id,
  type: 'yes_no_comment' as const,
  label: { en: label },
  required,
})

const opt = (value: string, label: string) => ({ value, label: { en: label } })
const optsFrom = (values: readonly string[]) => values.map((v) => opt(v, v))

// Working-at-heights vocabularies (mirror the retired native WAH sub-form).
const WAH_TYPE_OPTIONS = [
  'Ladder',
  'Step ladder',
  'Scaffold',
  'Elevated work platform (EWP)',
  'Scissor lift',
  'Boom lift',
  'Roof work',
  'Suspended access',
  'Leading edge',
]
const WAH_ACCESS_OPTIONS = [
  'Extension ladder',
  'Step ladder',
  'Scaffold stair tower',
  'Scissor lift',
  'Boom lift',
  'Fixed stairs / platform',
  'Man basket',
]
const WAH_COMMUNICATION_OPTIONS = [
  'Radio',
  'Hand signals',
  'Verbal / line of sight',
  'Spotter',
  'Air horn / whistle',
  'Phone',
]
const WAH_EQUIPMENT_OPTIONS = [
  'Full-body harness',
  'Shock-absorbing lanyard',
  'Self-retracting lifeline (SRL)',
  'Engineered anchor point',
  'Horizontal lifeline',
  'Guardrails',
  'Travel restraint',
  'Safety net',
  'Ladder tie-off',
]

export const HAZID_CONFINED_SPACE_APP_SCHEMA: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'Confined Space Entry Plan' },
  description: {
    en: 'Permit-required confined-space entry plan with isolation, atmospheric readings, entry log, rescue planning, and sign-off.',
  },
  sections: [
    {
      id: 'entry_setup',
      title: { en: 'Entry setup' },
      step: 'setup',
      fields: [
        { id: 'site', type: 'site_picker', label: { en: 'Site' }, required: true },
        {
          id: 'space_name',
          type: 'text',
          label: { en: 'Space / vessel / equipment' },
          required: true,
        },
        { id: 'permit_number', type: 'text', label: { en: 'Permit number' } },
        {
          id: 'entry_date',
          type: 'date',
          label: { en: 'Entry date' },
          required: true,
          defaultValue: { kind: 'today' },
        },
        {
          id: 'supervisor',
          type: 'person_picker',
          label: { en: 'Entry supervisor' },
          required: true,
        },
        { id: 'attendant', type: 'person_picker', label: { en: 'Attendant' }, required: true },
        {
          id: 'entrants',
          type: 'multi_person_picker',
          label: { en: 'Authorized entrants' },
          required: true,
        },
      ],
    },
    {
      id: 'controls',
      title: { en: 'Controls' },
      step: 'controls',
      fields: [
        yesNo('isolated_verified', 'All energy sources isolated and verified?'),
        yesNo('cleaned_purged', 'Space cleaned, purged, or flushed as required?'),
        yesNo('ventilation_running', 'Ventilation installed and running?'),
        yesNo('access_controlled', 'Access controlled and signage/barricades posted?'),
        {
          id: 'communication_method',
          type: 'select',
          label: { en: 'Primary communication method' },
          required: true,
          validation: {
            options: [
              opt('voice', 'Voice'),
              opt('radio', 'Radio'),
              opt('visual', 'Visual contact'),
              opt('line_signal', 'Line signal'),
              opt('other', 'Other'),
            ],
          },
        },
        {
          id: 'rescue_method',
          type: 'select',
          label: { en: 'Rescue method' },
          required: true,
          validation: {
            options: [
              opt('non_entry', 'Non-entry retrieval'),
              opt('entry_team', 'Entry rescue team'),
              opt('external_rescue', 'External rescue service'),
            ],
          },
        },
        {
          id: 'rescue_equipment',
          type: 'multi_select',
          label: { en: 'Rescue equipment available' },
          required: true,
          validation: {
            options: [
              opt('tripod', 'Tripod / davit'),
              opt('winch', 'Winch / SRL-R'),
              opt('harness', 'Full-body harness'),
              opt('scba', 'SCBA / supplied air'),
              opt('first_aid', 'First-aid kit / AED'),
              opt('stretcher', 'Stretcher / basket'),
            ],
          },
        },
      ],
    },
    {
      id: 'atmospheric_readings',
      title: { en: 'Atmospheric readings' },
      description: { en: 'Record pre-entry and periodic readings at the work face.' },
      step: 'readings',
      repeating: true,
      rowLabelTemplate: 'Reading #{index+1}',
      fields: [
        { id: 'reading_time', type: 'time', label: { en: 'Time' }, required: true },
        { id: 'oxygen_pct', type: 'number', label: { en: 'O2 %' }, required: true },
        { id: 'lel_pct', type: 'number', label: { en: 'LEL %' }, required: true },
        { id: 'h2s_ppm', type: 'number', label: { en: 'H2S ppm' }, required: true },
        { id: 'co_ppm', type: 'number', label: { en: 'CO ppm' }, required: true },
        { id: 'reading_ok', type: 'pass_fail_na', label: { en: 'Within limits?' }, required: true },
        { id: 'notes', type: 'text', label: { en: 'Notes' } },
      ],
    },
    {
      id: 'entry_log',
      title: { en: 'Entry log' },
      description: { en: 'Track every entrant in and out of the space.' },
      step: 'entry_log',
      repeating: true,
      rowLabelTemplate: 'Entrant #{index+1}',
      fields: [
        { id: 'entrant', type: 'person_picker', label: { en: 'Entrant' }, required: true },
        { id: 'time_in', type: 'time', label: { en: 'Time in' }, required: true },
        { id: 'time_out', type: 'time', label: { en: 'Time out' } },
        {
          id: 'role',
          type: 'select',
          label: { en: 'Role' },
          validation: {
            options: [
              opt('entrant', 'Entrant'),
              opt('attendant', 'Attendant'),
              opt('rescue', 'Rescue'),
            ],
          },
        },
      ],
    },
    {
      id: 'sign_off',
      title: { en: 'Sign-off' },
      step: 'signoff',
      fields: [
        yesNo('all_entrants_out', 'All entrants are accounted for / signed out?'),
        {
          id: 'supervisor_signature',
          type: 'signature',
          label: { en: 'Supervisor signature' },
          required: true,
        },
        {
          id: 'attendant_signature',
          type: 'signature',
          label: { en: 'Attendant signature' },
          required: true,
        },
      ],
    },
  ],
  workflow: {
    steps: [
      submitterStep('setup', 'Setup'),
      submitterStep('controls', 'Controls'),
      submitterStep('readings', 'Readings'),
      submitterStep('entry_log', 'Entry log'),
      submitterStep('signoff', 'Sign-off'),
    ],
  },
}

export const HAZID_ARC_FLASH_APP_SCHEMA: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'Arc Flash Work Plan' },
  description: {
    en: 'Electrical work planning app for arc-flash hazard details, boundaries, controls, PPE, and qualified-person sign-off.',
  },
  sections: [
    {
      id: 'equipment',
      title: { en: 'Equipment & job' },
      fields: [
        { id: 'site', type: 'site_picker', label: { en: 'Site' }, required: true },
        { id: 'equipment_name', type: 'text', label: { en: 'Equipment / panel' }, required: true },
        {
          id: 'work_date',
          type: 'date',
          label: { en: 'Work date' },
          required: true,
          defaultValue: { kind: 'today' },
        },
        {
          id: 'qualified_person',
          type: 'person_picker',
          label: { en: 'Qualified person' },
          required: true,
        },
        yesNo('energized_work', 'Will work be performed energized?'),
        {
          id: 'scope',
          type: 'long_text',
          label: { en: 'Scope of electrical work' },
          required: true,
        },
      ],
    },
    {
      id: 'arc_flash_study',
      title: { en: 'Arc-flash study' },
      fields: [
        { id: 'nominal_voltage', type: 'text', label: { en: 'Nominal voltage' }, required: true },
        { id: 'incident_energy', type: 'number', label: { en: 'Incident energy (cal/cm2)' } },
        {
          id: 'arc_flash_boundary',
          type: 'text',
          label: { en: 'Arc-flash boundary' },
          required: true,
        },
        {
          id: 'ppe_category',
          type: 'select',
          label: { en: 'PPE category' },
          required: true,
          validation: {
            options: [
              opt('cat_1', 'Category 1'),
              opt('cat_2', 'Category 2'),
              opt('cat_3', 'Category 3'),
              opt('cat_4', 'Category 4'),
              opt('engineered', 'Engineered / label-specific'),
            ],
          },
        },
        {
          id: 'shock_boundaries',
          type: 'table',
          label: { en: 'Shock approach boundaries' },
          config: {
            rowMode: 'fixed',
            rows: [
              { label: 'Limited' },
              { label: 'Restricted' },
              { label: 'Prohibited / arc flash' },
            ],
            columns: [
              { key: 'distance', label: 'Distance', type: 'text' },
              { key: 'notes', label: 'Notes', type: 'text' },
            ],
          },
        },
      ],
    },
    {
      id: 'controls',
      title: { en: 'Controls & PPE' },
      fields: [
        yesNo('loto_complete', 'Lockout/tagout completed where possible?'),
        yesNo('test_before_touch', 'Test-before-touch completed with verified meter?'),
        yesNo(
          'covers_barriers',
          'Insulated covers, barriers, and restricted approach controls in place?',
        ),
        yesNo('hot_work_justified', 'Energized work justified and authorized?'),
        {
          id: 'required_ppe',
          type: 'multi_select',
          label: { en: 'Required arc-rated PPE' },
          required: true,
          validation: {
            options: [
              opt('arc_fr_clothing', 'Arc-rated FR clothing'),
              opt('face_shield_balaclava', 'Face shield + balaclava'),
              opt('arc_flash_hood', 'Arc-flash suit hood'),
              opt('voltage_gloves', 'Voltage-rated gloves'),
              opt('leather_protectors', 'Leather protectors'),
              opt('hearing_protection', 'Hearing protection'),
              opt('safety_glasses', 'Safety glasses'),
            ],
          },
        },
        {
          id: 'special_controls',
          type: 'long_text',
          label: { en: 'Special controls / switching procedure' },
        },
      ],
    },
    {
      id: 'sign_off',
      title: { en: 'Sign-off' },
      fields: [
        {
          id: 'qualified_signature',
          type: 'signature',
          label: { en: 'Qualified person signature' },
          required: true,
        },
        {
          id: 'supervisor_signature',
          type: 'signature',
          label: { en: 'Supervisor signature' },
          required: true,
        },
      ],
    },
  ],
  workflow: { steps: [submitterStep('submit', 'Submit')] },
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleTx = any

async function ensureTemplate(
  tx: DrizzleTx,
  args: {
    tenantId: string
    key: string
    name: string
    description: string
    schema: FormSchemaV1
  },
) {
  const [existing] = await tx
    .select({ id: formTemplates.id })
    .from(formTemplates)
    .where(and(eq(formTemplates.tenantId, args.tenantId), eq(formTemplates.key, args.key)))
    .limit(1)
  if (existing) return existing

  const [tmpl] = await tx
    .insert(formTemplates)
    .values({
      tenantId: args.tenantId,
      key: args.key,
      name: args.name,
      category: 'jsha',
      moduleBinding: 'hazard_assessment_app',
      description: args.description,
      status: 'published' as const,
      kind: 'wizard' as const,
      iconKey: args.key.includes('arc') ? 'zap' : 'badge-alert',
      createdBy: null,
    })
    .onConflictDoNothing({ target: [formTemplates.tenantId, formTemplates.key] })
    .returning({ id: formTemplates.id })
  if (!tmpl) {
    const [raceWinner] = await tx
      .select({ id: formTemplates.id })
      .from(formTemplates)
      .where(and(eq(formTemplates.tenantId, args.tenantId), eq(formTemplates.key, args.key)))
      .limit(1)
    if (!raceWinner) throw new Error(`Failed to seed ${args.key}`)
    return raceWinner
  }

  await tx.insert(formTemplateVersions).values({
    tenantId: args.tenantId,
    templateId: tmpl.id,
    version: 1,
    schema: args.schema,
    publishedAt: new Date(),
    publishedBy: null,
    changelog: 'Built-in hazard-assessment embedded app v1',
  })
  return tmpl
}

export const HAZID_FALL_PROTECTION_APP_SCHEMA: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'Fall Protection Plan' },
  description: {
    en: 'Working-at-heights plan: access method, communication, fall-protection equipment, anchorage, and rescue.',
  },
  sections: [
    {
      id: 'wah_setup',
      title: { en: 'Work at heights' },
      step: 'setup',
      fields: [
        { id: 'site', type: 'site_picker', label: { en: 'Site' }, required: true },
        {
          id: 'work_description',
          type: 'textarea',
          label: { en: 'Work description' },
          required: true,
        },
        {
          id: 'wah_type',
          type: 'select',
          label: { en: 'Type of work at heights' },
          required: true,
          validation: { options: optsFrom(WAH_TYPE_OPTIONS) },
        },
        { id: 'permit_number', type: 'text', label: { en: 'Permit number (if applicable)' } },
        { id: 'supervisor', type: 'person_picker', label: { en: 'Supervisor' }, required: true },
        {
          id: 'workers',
          type: 'multi_person_picker',
          label: { en: 'Workers at height' },
          required: true,
        },
        {
          id: 'work_date',
          type: 'date',
          label: { en: 'Date' },
          required: true,
          defaultValue: { kind: 'today' },
        },
      ],
    },
    {
      id: 'wah_access',
      title: { en: 'Access & communication' },
      step: 'access',
      fields: [
        {
          id: 'access_methods',
          type: 'multi_select',
          label: { en: 'Access methods' },
          required: true,
          validation: { options: optsFrom(WAH_ACCESS_OPTIONS) },
        },
        {
          id: 'communication',
          type: 'multi_select',
          label: { en: 'Communication' },
          required: true,
          validation: { options: optsFrom(WAH_COMMUNICATION_OPTIONS) },
        },
      ],
    },
    {
      id: 'wah_protection',
      title: { en: 'Fall protection' },
      step: 'protection',
      fields: [
        {
          id: 'equipment',
          type: 'multi_select',
          label: { en: 'Fall-protection equipment' },
          required: true,
          validation: { options: optsFrom(WAH_EQUIPMENT_OPTIONS) },
        },
        yesNo('anchor_rated', 'Anchor points rated and adequate for the load?'),
        yesNo('equipment_inspected', 'Harnesses, lanyards, and SRLs inspected before use?'),
        yesNo(
          'hierarchy_applied',
          'Guardrails / travel restraint used before fall arrest where practical?',
        ),
        {
          id: 'rescue_plan',
          type: 'textarea',
          label: { en: 'Rescue plan' },
          required: true,
          helpText: { en: 'How will a suspended worker be rescued, and by whom?' },
        },
      ],
    },
    {
      id: 'wah_signoff',
      title: { en: 'Sign-off' },
      step: 'signoff',
      fields: [
        yesNo('workers_briefed', 'All workers briefed on this plan and the rescue procedure?'),
        {
          id: 'supervisor_signature',
          type: 'signature',
          label: { en: 'Supervisor signature' },
          required: true,
        },
      ],
    },
  ],
  workflow: {
    steps: [
      submitterStep('setup', 'Setup'),
      submitterStep('access', 'Access'),
      submitterStep('protection', 'Fall protection'),
      submitterStep('signoff', 'Sign-off'),
    ],
  },
}

export async function seedHazardAssessmentAppTemplates(tx: DrizzleTx, tenantId: string) {
  const confinedSpace = await ensureTemplate(tx, {
    tenantId,
    key: HAZID_CONFINED_SPACE_APP_KEY,
    name: 'Confined Space Entry Plan',
    description:
      'Embedded hazard-assessment app for permit-required confined-space setup, readings, entry log, rescue planning, and sign-off.',
    schema: HAZID_CONFINED_SPACE_APP_SCHEMA,
  })
  const arcFlash = await ensureTemplate(tx, {
    tenantId,
    key: HAZID_ARC_FLASH_APP_KEY,
    name: 'Arc Flash Work Plan',
    description:
      'Embedded hazard-assessment app for arc-flash study details, boundaries, controls, PPE, and sign-off.',
    schema: HAZID_ARC_FLASH_APP_SCHEMA,
  })
  const fallProtection = await ensureTemplate(tx, {
    tenantId,
    key: HAZID_FALL_PROTECTION_APP_KEY,
    name: 'Fall Protection Plan',
    description:
      'Embedded hazard-assessment app for working-at-heights: access, communication, fall-protection equipment, anchorage, and rescue.',
    schema: HAZID_FALL_PROTECTION_APP_SCHEMA,
  })

  return {
    confinedSpaceTemplateId: confinedSpace.id,
    arcFlashTemplateId: arcFlash.id,
    fallProtectionTemplateId: fallProtection.id,
  }
}
