// Per-tenant seeder for the built-in Lift Plan form template.
//
// This is a faithful recreation of the legacy Laravel "Lift Plan" form
// (rassaun/beaconhs: LiftPlanController + resources/views/pages/liftplan).
// It is a single-page form (no multi-step wizard, no sign-off) with six
// sections, mirroring the original field-for-field:
//
//   1. Lift details   — job number, date, personnel, loads & weights
//   2. Description of Lift
//   3. Rigging / Hardware (repeating table)
//   4. Pre-Lift Checklist (+ wind conditions)
//   5. Crane Data
//   6. Diagram / Sketch (freehand drawing canvas)
//
// The legacy "Job Number" was a dropdown of active Projects; the new platform
// models projects as org_units at level='project', surfaced via the new
// `project_picker` element. The freehand "Diagram / Sketch" uses the new
// `sketch` element (Excalidraw).
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
// (To force the latest schema onto an existing tenant, use the dedicated
// reseed script, which publishes a new version instead of inserting.)

import { and, eq } from 'drizzle-orm'
import { formTemplates, formTemplateVersions } from '../schema'
import type { FormSchemaV1 } from '../schema/forms'

export const LIFT_PLAN_TEMPLATE_KEY = 'lift-plan'
export const LIFT_PLAN_TEMPLATE_CATEGORY = 'lift_plan'
export const LIFT_PLAN_TEMPLATE_MODULE_BINDING = 'lift_plan'
export const LIFT_PLAN_TEMPLATE_NAME = 'Lift Plan'

// Pre-lift checklist items — value keys match the legacy checklist_json keys.
const PRE_LIFT_CHECKLIST_OPTIONS = [
  { value: 'rigging_inspected', label: { en: 'Rigging Inspected' } },
  { value: 'jha_completed', label: { en: 'JSA Completed' } },
  { value: 'swing_check', label: { en: 'Swing Check / Clearance' } },
  { value: 'load_chart_on_crane', label: { en: 'Load Chart on Crane' } },
  { value: 'tag_lines', label: { en: 'Tag Lines' } },
  { value: 'outriggers_pads', label: { en: 'Outriggers / Pads' } },
  { value: 'site_control', label: { en: 'Site Control / Barriers' } },
  { value: 'certified_operator', label: { en: 'Certified Operator' } },
  { value: 'crane_inspected', label: { en: 'Crane Inspected' } },
]

// Free-text unit for the load / rigging weights (legacy placeholder kg/lb/ton).
const WEIGHT_UNIT_OPTIONS = [
  { value: 'kg', label: { en: 'kg' } },
  { value: 'lb', label: { en: 'lb' } },
  { value: 'ton', label: { en: 'ton' } },
]

/**
 * The lift-plan form template schema, stored verbatim into
 * form_template_versions.schema as v1. Single workflow step ('complete') →
 * the filler renders it as one page (matches the legacy autosaving form).
 */
export const LIFT_PLAN_TEMPLATE_SCHEMA: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'Lift Plan' },
  description: {
    en: 'Crane lift plan: job, personnel, loads & weights, description, rigging/hardware, pre-lift checklist, crane data, and a lift diagram.',
  },
  sections: [
    // 1. Lift details (legacy meta grid) ------------------------------------
    {
      id: 'lift_details',
      title: { en: 'Lift details' },
      step: 'complete',
      layout: { columns: 2 },
      fields: [
        {
          id: 'job_number',
          type: 'project_picker',
          label: { en: 'Job Number' },
          required: true,
        },
        {
          id: 'lift_date',
          type: 'date',
          label: { en: 'Date' },
          defaultValue: { kind: 'today' },
        },
        { id: 'created_by', type: 'text', label: { en: 'Created By' } },
        { id: 'crane_operator', type: 'text', label: { en: 'Crane Operator' } },
        { id: 'qualified_rigger', type: 'text', label: { en: 'Qualified Rigger' } },
        { id: 'signal_person', type: 'text', label: { en: 'Signal Person' } },
        { id: 'other_person_1', type: 'text', label: { en: 'Other Person 1' } },
        { id: 'other_person_2', type: 'text', label: { en: 'Other Person 2' } },
        { id: 'load_to_be_lifted', type: 'text', label: { en: 'Load to be lifted' } },
        { id: 'load_dimensions', type: 'text', label: { en: 'Load Dimensions' } },
        { id: 'load_weight_value', type: 'number', label: { en: 'Load Weight' } },
        {
          id: 'load_weight_unit',
          type: 'select',
          label: { en: 'Load Weight — unit' },
          validation: { options: WEIGHT_UNIT_OPTIONS },
        },
        { id: 'rigging_weight_value', type: 'number', label: { en: 'Rigging Weight' } },
        {
          id: 'rigging_weight_unit',
          type: 'select',
          label: { en: 'Rigging Weight — unit' },
          validation: { options: WEIGHT_UNIT_OPTIONS },
        },
      ],
    },
    // 2. Description of Lift -------------------------------------------------
    {
      id: 'description',
      title: { en: 'Description of Lift' },
      step: 'complete',
      fields: [
        {
          id: 'description_of_lift',
          type: 'rich_text',
          label: { en: 'Description of Lift' },
        },
      ],
    },
    // 3. Rigging / Hardware (repeating) -------------------------------------
    {
      id: 'rigging_hardware',
      title: { en: 'Rigging / Hardware' },
      description: { en: 'One row per rigging item or piece of hardware.' },
      step: 'complete',
      fields: [
        {
          id: 'rigging_items',
          type: 'table',
          label: { en: 'Rigging / Hardware' },
          config: {
            rowMode: 'addable',
            minRows: 0,
            columns: [
              { key: 'rigging_hardware', label: 'Rigging / Hardware', type: 'text' },
              { key: 'quantity', label: 'Quantity', type: 'number' },
              { key: 'hitch_type', label: 'Hitch Type', type: 'text' },
              { key: 'wll', label: 'Working Load Limit (WLL)', type: 'text' },
            ],
          },
        },
      ],
    },
    // 4. Pre-Lift Checklist -------------------------------------------------
    {
      id: 'pre_lift_checklist',
      title: { en: 'Pre-Lift Checklist' },
      step: 'complete',
      fields: [
        {
          id: 'pre_lift_checklist',
          type: 'checkbox_group',
          label: { en: 'Confirm each item before the lift begins' },
          validation: { options: PRE_LIFT_CHECKLIST_OPTIONS },
        },
        {
          id: 'wind_conditions',
          type: 'text',
          label: { en: 'Wind Conditions' },
          helpText: { en: 'e.g., 12 km/h NW' },
        },
      ],
    },
    // 5. Crane Data ---------------------------------------------------------
    {
      id: 'crane_data',
      title: { en: 'Crane Data' },
      step: 'complete',
      layout: { columns: 2 },
      fields: [
        { id: 'crane_model', type: 'text', label: { en: 'Crane Model' } },
        { id: 'boom_length_ft', type: 'number', label: { en: 'Boom Length (ft)' } },
        { id: 'radius_ft', type: 'number', label: { en: 'Radius (ft)' } },
        {
          id: 'configuration',
          type: 'text',
          label: { en: 'Configuration' },
          helpText: { en: 'sling angle, etc.' },
        },
        { id: 'crane_capacity_tons', type: 'text', label: { en: 'Crane Capacity (tons)' } },
        { id: 'crane_boom_angle', type: 'text', label: { en: 'Crane Boom Angle' } },
        { id: 'crane_notes', type: 'text', label: { en: 'Notes' }, colSpan: 2 },
      ],
    },
    // 6. Diagram / Sketch ---------------------------------------------------
    {
      id: 'diagram',
      title: { en: 'Diagram / Sketch' },
      step: 'complete',
      fields: [
        {
          id: 'diagram',
          type: 'sketch',
          label: { en: 'Diagram / Sketch' },
          helpText: { en: 'Draw the lift: crane, load, rigging, clearances, and exclusion zone.' },
        },
      ],
    },
  ],
  workflow: {
    steps: [
      {
        key: 'complete',
        title: { en: 'Complete' },
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
    .where(and(eq(formTemplates.tenantId, tenantId), eq(formTemplates.key, LIFT_PLAN_TEMPLATE_KEY)))
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
        'Crane lift plan: job, personnel, loads & weights, description, rigging/hardware, pre-lift checklist, crane data, and a lift diagram.',
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
