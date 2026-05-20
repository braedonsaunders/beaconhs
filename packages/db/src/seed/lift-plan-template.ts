// Per-tenant seeder for the built-in Lift Plan form template.
//
// Lift plans were previously a first-class native module (apps/web/lift-plans
// + lift_plan* tables). The clean cutover replaces that with a form template
// owned by each tenant. The template lives behind the bound-modules view at
// /inspections?bound=lift_plan, so it picks up the same surface JSHAs,
// toolbox talks, and WAH rescue plans use.
//
// The template carries:
//   - category='lift_plan' + moduleBinding='lift_plan' so the bound view picks
//     it up automatically
//   - key='lift-plan' as the stable per-tenant identifier (form_templates has
//     a unique index on (tenant_id, key))
//   - status='published' so users can fill it immediately
//
// Idempotency contract: insert with ON CONFLICT (tenant_id, key) DO NOTHING.
// If the template already exists for this tenant we skip — admins may have
// edited it after seed and we don't want to clobber their version history.

import { and, eq } from 'drizzle-orm'
import { formTemplates, formTemplateVersions } from '../schema'
import type { FormSchemaV1 } from '../schema/forms'

export const LIFT_PLAN_TEMPLATE_KEY = 'lift-plan'
export const LIFT_PLAN_TEMPLATE_CATEGORY = 'lift_plan'
export const LIFT_PLAN_TEMPLATE_MODULE_BINDING = 'lift_plan'
export const LIFT_PLAN_TEMPLATE_NAME = 'Lift Plan'

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

const PRE_LIFT_CHECKLIST_OPTIONS = [
  { value: 'ground_bearing_assessed', label: { en: 'Ground bearing assessed' } },
  { value: 'tail_swing_cleared', label: { en: 'Tail swing path cleared' } },
  { value: 'crane_level', label: { en: 'Crane level confirmed' } },
  { value: 'rigging_inspected', label: { en: 'All rigging inspected' } },
  { value: 'comms_briefed', label: { en: 'Communication plan briefed' } },
  { value: 'exclusion_zone', label: { en: 'Exclusion zone established' } },
  { value: 'wind_within_limits', label: { en: 'Wind speed within limits' } },
  { value: 'outriggers_deployed', label: { en: 'Outriggers fully deployed' } },
]

/**
 * The lift-plan form template schema. Stored verbatim into
 * form_template_versions.schema as v1.
 *
 * Sections (8):
 *   1. General info    — date, site, project, supervisor, description
 *   2. Crane data      — type, model, capacity, radius, boom, counterweight,
 *                        ground bearing PSI, tail swing
 *   3. Loads           — repeating: description, load weight, rigging weight
 *   4. Hazards & ctrls — repeating: hazard, control, residual risk
 *   5. PPE required    — multi_select picker
 *   6. Pre-lift chklst — checkbox_group with 8 default items
 *   7. Lift diagram    — file upload (single image)
 *   8. Signatures      — supervisor / operator / rigger / spotter (4 signature
 *                        fields, all required)
 */
export const LIFT_PLAN_TEMPLATE_SCHEMA: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'Lift Plan' },
  description: {
    en: 'Engineering plan for any critical lift: crane data, loads, hazards & controls, PPE, pre-lift checklist, diagram, sign-off by supervisor + operator + rigger + spotter.',
  },
  sections: [
    {
      id: 'general_info',
      title: { en: 'General info' },
      fields: [
        { id: 'lift_date', type: 'date', label: { en: 'Lift date' }, required: true },
        { id: 'site', type: 'site_picker', label: { en: 'Site' }, required: true },
        { id: 'project', type: 'text', label: { en: 'Project' } },
        { id: 'supervisor', type: 'person_picker', label: { en: 'Lift supervisor' }, required: true },
        { id: 'description', type: 'textarea', label: { en: 'Description / scope' } },
      ],
    },
    {
      id: 'crane_data',
      title: { en: 'Crane data' },
      fields: [
        { id: 'crane_type', type: 'text', label: { en: 'Crane type' }, required: true },
        { id: 'crane_model', type: 'text', label: { en: 'Crane model' } },
        { id: 'crane_capacity_lbs', type: 'number', label: { en: 'Crane capacity (lbs)' }, required: true },
        { id: 'crane_radius_ft', type: 'number', label: { en: 'Working radius (ft)' }, required: true },
        { id: 'crane_boom_length_ft', type: 'number', label: { en: 'Boom length (ft)' }, required: true },
        { id: 'crane_counterweight_lbs', type: 'number', label: { en: 'Counterweight (lbs)' } },
        { id: 'ground_bearing_psi', type: 'number', label: { en: 'Ground bearing (psi)' } },
        { id: 'tail_swing_ft', type: 'number', label: { en: 'Tail swing (ft)' } },
      ],
    },
    {
      id: 'loads',
      title: { en: 'Loads' },
      description: { en: 'One row per discrete item being lifted.' },
      repeating: true,
      fields: [
        { id: 'description', type: 'text', label: { en: 'Description' }, required: true },
        { id: 'load_weight_lbs', type: 'number', label: { en: 'Load weight (lbs)' }, required: true },
        { id: 'rigging_weight_lbs', type: 'number', label: { en: 'Rigging weight (lbs)' } },
      ],
    },
    {
      id: 'hazards_controls',
      title: { en: 'Hazards & controls' },
      description: { en: 'One row per hazard.' },
      repeating: true,
      fields: [
        { id: 'hazard', type: 'text', label: { en: 'Hazard' }, required: true },
        { id: 'control', type: 'text', label: { en: 'Control' }, required: true },
        {
          id: 'residual_risk',
          type: 'select',
          label: { en: 'Residual risk' },
          required: true,
          validation: { options: RISK_OPTIONS },
        },
      ],
    },
    {
      id: 'ppe_required',
      title: { en: 'PPE required' },
      fields: [
        {
          id: 'ppe',
          type: 'ppe_picker',
          label: { en: 'PPE required' },
          required: true,
          validation: { options: PPE_OPTIONS },
        },
      ],
    },
    {
      id: 'pre_lift_checklist',
      title: { en: 'Pre-lift checklist' },
      fields: [
        {
          id: 'pre_lift_items',
          type: 'checkbox_group',
          label: { en: 'Confirm each item before the lift begins' },
          required: true,
          validation: { options: PRE_LIFT_CHECKLIST_OPTIONS },
        },
      ],
    },
    {
      id: 'lift_diagram',
      title: { en: 'Lift diagram' },
      fields: [
        {
          id: 'diagram',
          type: 'file',
          label: { en: 'Lift diagram (image / PDF)' },
          helpText: { en: 'Upload the engineered lift drawing or sketch.' },
        },
      ],
    },
    {
      id: 'signatures',
      title: { en: 'Signatures' },
      fields: [
        { id: 'supervisor_signature', type: 'signature', label: { en: 'Supervisor signature' }, required: true },
        { id: 'operator_signature', type: 'signature', label: { en: 'Operator signature' }, required: true },
        { id: 'rigger_signature', type: 'signature', label: { en: 'Rigger signature' }, required: true },
        { id: 'spotter_signature', type: 'signature', label: { en: 'Spotter signature' }, required: true },
      ],
    },
  ],
  workflow: {
    steps: [
      {
        key: 'submit',
        title: { en: 'Submit' },
        assignee: { type: 'expression', expr: '$submitter' },
      },
    ],
  },
}

// Anything providing a transaction with the same surface as our drizzle
// instance can run this seeder. We accept `any` because:
//   - seed.ts hands us a `tx: any` (its function signatures use any throughout)
//   - the tenant-create server action hands us a drizzle PgTransaction whose
//     generic params would force us to import + re-export the full schema
//     module to satisfy the structural type
// The function is small and well-scoped, so the `any` here is contained.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleTx = any

/**
 * Idempotently seed the built-in lift-plan form template for one tenant.
 * Safe to call multiple times — uses ON CONFLICT (tenant_id, key) DO NOTHING.
 *
 * @returns 'inserted' if newly created, 'skipped' if it already existed.
 */
export async function seedLiftPlanTemplate(
  tx: DrizzleTx,
  tenantId: string,
): Promise<'inserted' | 'skipped'> {
  // Cheap pre-check: an explicit SELECT keeps the log line accurate (vs.
  // relying on ON CONFLICT's silent skip). If the template exists for this
  // tenant we return early.
  const existing = await tx
    .select({ id: formTemplates.id })
    .from(formTemplates)
    .where(
      and(
        eq(formTemplates.tenantId, tenantId),
        eq(formTemplates.key, LIFT_PLAN_TEMPLATE_KEY),
      ),
    )
    .limit(1)
  if (existing.length > 0) return 'skipped'

  const inserts = await tx
    .insert(formTemplates)
    .values({
      tenantId,
      key: LIFT_PLAN_TEMPLATE_KEY,
      name: LIFT_PLAN_TEMPLATE_NAME,
      category: LIFT_PLAN_TEMPLATE_CATEGORY,
      moduleBinding: LIFT_PLAN_TEMPLATE_MODULE_BINDING,
      description:
        'Engineering plan for any critical lift. Crane data, loads, hazards & controls, PPE, pre-lift checklist, diagram, sign-off.',
      status: 'published' as const,
      createdBy: null,
    })
    .onConflictDoNothing({ target: [formTemplates.tenantId, formTemplates.key] })
    .returning({ id: formTemplates.id })

  const tmpl = inserts[0]
  if (!tmpl) {
    // Race: another concurrent call won the insert. Treat as skipped — the
    // version row will already exist from the winning call.
    return 'skipped'
  }

  await tx.insert(formTemplateVersions).values({
    tenantId,
    templateId: tmpl.id,
    version: 1,
    schema: LIFT_PLAN_TEMPLATE_SCHEMA,
    publishedAt: new Date(),
    publishedBy: null,
    changelog: 'Built-in lift-plan template v1',
  })

  return 'inserted'
}
