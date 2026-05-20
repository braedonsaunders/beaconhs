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
 * Multi-step layout (3 pages):
 *   1. "Plan"   — general info, crane data, loads (repeating), totals (formula)
 *   2. "Risk"   — hazards & controls (repeating), PPE, pre-lift checklist, diagram
 *   3. "Sign"   — supervisor / operator / rigger / spotter signatures
 *
 * Demonstrates the foundation features end-to-end:
 *   - Repeating sections w/ row-label-template + min-rows
 *   - Formula field (total_weight_lbs) cross-referencing repeating rows
 *   - Conditional visibility (critical_control textarea shows only when
 *     residual_risk = 'critical')
 *   - Default value (today's date)
 *   - Multi-step workflow w/ section bindings
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
      step: 'plan',
      fields: [
        {
          id: 'lift_date',
          type: 'date',
          label: { en: 'Lift date' },
          required: true,
          defaultValue: { kind: 'today' },
        },
        { id: 'site', type: 'site_picker', label: { en: 'Site' }, required: true },
        { id: 'project', type: 'text', label: { en: 'Project' } },
        {
          id: 'supervisor',
          type: 'person_picker',
          label: { en: 'Lift supervisor' },
          required: true,
          defaultValue: { kind: 'current_user_person_id' },
        },
        // Live entity-attr lookup: surface the supervisor's current job
        // title from the people table. Recomputes whenever the picker
        // changes. Demonstrates the entity_attr → entity-loader → filler
        // pipeline end-to-end on a real seeded template.
        {
          id: 'supervisor_job_title',
          type: 'formula',
          label: { en: 'Supervisor — current job title' },
          helpText: { en: 'Read-only. Pulled from the supervisor\'s people record.' },
          formula: {
            kind: 'entity_attr',
            pickerFieldKey: 'supervisor',
            attrKey: 'jobTitle',
          },
        },
        { id: 'description', type: 'textarea', label: { en: 'Description / scope' } },
      ],
    },
    {
      id: 'crane_data',
      title: { en: 'Crane data' },
      step: 'plan',
      fields: [
        { id: 'crane_type', type: 'text', label: { en: 'Crane type' }, required: true },
        { id: 'crane_model', type: 'text', label: { en: 'Crane model' } },
        { id: 'crane_capacity_lbs', type: 'number', label: { en: 'Crane capacity (lbs)' }, required: true },
        { id: 'crane_radius_ft', type: 'number', label: { en: 'Working radius (ft)' }, required: true },
        { id: 'crane_boom_length_ft', type: 'number', label: { en: 'Boom length (ft)' }, required: true },
        { id: 'crane_counterweight_lbs', type: 'number', label: { en: 'Counterweight (lbs)' } },
        { id: 'ground_bearing_psi', type: 'number', label: { en: 'Ground bearing (psi)' } },
        { id: 'tail_swing_ft', type: 'number', label: { en: 'Tail swing (ft)' } },
        // Equipment-picker + entity-attr smoke pair: pick the actual crane
        // asset, then surface its current status as a read-only formula.
        // Optional so the template doesn't break for tenants that haven't
        // registered their cranes in the equipment register yet.
        {
          id: 'crane_equipment',
          type: 'equipment_picker',
          label: { en: 'Crane (asset register)' },
          helpText: { en: 'Optional. Link to the actual crane asset to surface live status.' },
        },
        {
          id: 'crane_current_status',
          type: 'formula',
          label: { en: 'Crane — current status' },
          helpText: { en: 'Read-only. Pulled from the equipment item\'s status column.' },
          formula: {
            kind: 'entity_attr',
            pickerFieldKey: 'crane_equipment',
            attrKey: 'status',
          },
        },
      ],
    },
    {
      id: 'loads',
      title: { en: 'Loads' },
      description: { en: 'One row per discrete item being lifted.' },
      repeating: true,
      minRows: 1,
      rowLabelTemplate: 'Load #{index+1} · {description}',
      step: 'plan',
      fields: [
        { id: 'description', type: 'text', label: { en: 'Description' }, required: true },
        { id: 'load_weight_lbs', type: 'number', label: { en: 'Load weight (lbs)' }, required: true },
        { id: 'rigging_weight_lbs', type: 'number', label: { en: 'Rigging weight (lbs)' } },
      ],
    },
    {
      id: 'totals',
      title: { en: 'Totals' },
      step: 'plan',
      fields: [
        {
          id: 'total_weight_lbs',
          type: 'formula',
          label: { en: 'Total weight (lbs)' },
          helpText: { en: 'Sum of all load weights + rigging weights across every Loads row.' },
          formula: {
            kind: 'sum',
            of: [
              { kind: 'sum_section', sectionKey: 'loads', rowFieldKey: 'load_weight_lbs' },
              { kind: 'sum_section', sectionKey: 'loads', rowFieldKey: 'rigging_weight_lbs' },
            ],
          },
        },
      ],
    },
    {
      id: 'hazards_controls',
      title: { en: 'Hazards & controls' },
      description: { en: 'One row per hazard.' },
      repeating: true,
      rowLabelTemplate: 'Hazard #{index+1}',
      step: 'risk',
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
        {
          // Only appears when residual risk is rated critical — proves the
          // conditional-visibility runtime works against repeating rows.
          id: 'critical_control',
          type: 'textarea',
          label: { en: 'Additional control for critical risk' },
          helpText: { en: 'Required when residual risk is critical.' },
          required: true,
          showIf: { op: 'eq', field: 'residual_risk', value: 'critical' },
        },
      ],
    },
    {
      id: 'ppe_required',
      title: { en: 'PPE required' },
      step: 'risk',
      fields: [
        {
          id: 'ppe',
          type: 'checkbox_group',
          label: { en: 'PPE required' },
          required: true,
          validation: { options: PPE_OPTIONS },
        },
      ],
    },
    {
      id: 'pre_lift_checklist',
      title: { en: 'Pre-lift checklist' },
      step: 'risk',
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
      step: 'risk',
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
      step: 'sign',
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
        key: 'plan',
        title: { en: 'Plan' },
        assignee: { type: 'expression', expr: '$submitter' },
      },
      {
        key: 'risk',
        title: { en: 'Risk' },
        assignee: { type: 'expression', expr: '$submitter' },
      },
      {
        key: 'sign',
        title: { en: 'Sign-off' },
        assignee: { type: 'expression', expr: '$submitter' },
        signatureRequired: true,
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
