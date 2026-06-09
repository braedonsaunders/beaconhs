import { z } from 'zod'

// Runtime-validated form schema. Keep in lockstep with the TS types in
// @beaconhs/db/schema/forms.ts — these are the source of truth at runtime.

export const i18nStringSchema = z.record(z.string(), z.string())

// Re-export the inferred string-map type so callers can reference it directly.
export type I18nString = z.infer<typeof i18nStringSchema>

export const logicRuleSchema: z.ZodType<LogicRule> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({ op: z.enum(['and', 'or']), rules: z.array(logicRuleSchema) }),
    z.object({ op: z.literal('not'), rule: logicRuleSchema }),
    z.object({
      op: z.enum(['eq', 'ne', 'gt', 'lt', 'gte', 'lte']),
      field: z.string(),
      value: z.unknown(),
    }),
    z.object({
      op: z.enum(['in', 'notIn']),
      field: z.string(),
      value: z.array(z.unknown()),
    }),
    z.object({ op: z.enum(['isSet', 'isNotSet']), field: z.string() }),
  ]),
)

export type LogicRule =
  | { op: 'and' | 'or'; rules: LogicRule[] }
  | { op: 'not'; rule: LogicRule }
  | { op: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte'; field: string; value: unknown }
  | { op: 'in' | 'notIn'; field: string; value: unknown[] }
  | { op: 'isSet' | 'isNotSet'; field: string }

// --- Formula expression tree -------------------------------------------------
//
// Stored on FormField.formula as a small JSON expression. Evaluated by
// `evaluateFormulaTree()` in `./evaluator.ts`. Lives alongside the existing
// string-based `evaluateFormula()` because designer-built calc fields need a
// typed tree, while legacy `field.config.expr` strings keep working.
export type FormulaExpression =
  | { kind: 'literal'; value: number | string }
  | { kind: 'field_ref'; fieldKey: string }
  | { kind: 'sum'; of: FormulaExpression[] }
  | { kind: 'product'; of: FormulaExpression[] }
  | { kind: 'subtract'; left: FormulaExpression; right: FormulaExpression }
  | { kind: 'divide'; left: FormulaExpression; right: FormulaExpression }
  | { kind: 'min'; of: FormulaExpression[] }
  | { kind: 'max'; of: FormulaExpression[] }
  // sum / count fields across all rows of a repeating section.
  | { kind: 'sum_section'; sectionKey: string; rowFieldKey: string }
  | { kind: 'count_section'; sectionKey: string }
  | { kind: 'concat'; of: FormulaExpression[]; separator?: string }
  | { kind: 'if'; condition: LogicRule; then: FormulaExpression; else: FormulaExpression }
  // Read an allowlisted attribute off the entity selected by a picker field.
  // `pickerFieldKey` names the picker field (top-level field id of an
  // equipment_picker / person_picker / site_picker / ppe_picker /
  // document_picker / course_picker). `attrKey` must be present in
  // ENTITY_ATTRS[<kind>] (see entity-attrs.ts) or the evaluator returns null.
  // The runtime fetches the row attrs server-side and threads them into
  // EvalContext.entities — see evaluator.ts and the filler RSC loader.
  | { kind: 'entity_attr'; pickerFieldKey: string; attrKey: string }

export const formulaExpressionSchema: z.ZodType<FormulaExpression> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('literal'), value: z.union([z.number(), z.string()]) }),
    z.object({ kind: z.literal('field_ref'), fieldKey: z.string() }),
    z.object({ kind: z.literal('sum'), of: z.array(formulaExpressionSchema) }),
    z.object({ kind: z.literal('product'), of: z.array(formulaExpressionSchema) }),
    z.object({
      kind: z.literal('subtract'),
      left: formulaExpressionSchema,
      right: formulaExpressionSchema,
    }),
    z.object({
      kind: z.literal('divide'),
      left: formulaExpressionSchema,
      right: formulaExpressionSchema,
    }),
    z.object({ kind: z.literal('min'), of: z.array(formulaExpressionSchema) }),
    z.object({ kind: z.literal('max'), of: z.array(formulaExpressionSchema) }),
    z.object({
      kind: z.literal('sum_section'),
      sectionKey: z.string(),
      rowFieldKey: z.string(),
    }),
    z.object({ kind: z.literal('count_section'), sectionKey: z.string() }),
    z.object({
      kind: z.literal('concat'),
      of: z.array(formulaExpressionSchema),
      separator: z.string().optional(),
    }),
    z.object({
      kind: z.literal('if'),
      condition: logicRuleSchema,
      then: formulaExpressionSchema,
      else: formulaExpressionSchema,
    }),
    z.object({
      kind: z.literal('entity_attr'),
      pickerFieldKey: z.string(),
      attrKey: z.string(),
    }),
  ]),
)

// --- Default-value expression -----------------------------------------------
//
// Applied on first render of a field (filler) when the response value is empty.
// Resolved against the request context (user / now) by `resolveDefaultValue()`
// in `./evaluator.ts`.
export type DefaultValueExpression =
  | { kind: 'literal'; value: unknown }
  | { kind: 'today' }
  | { kind: 'now' }
  | { kind: 'current_user_person_id' }
  | { kind: 'current_user_name' }
  | { kind: 'expression'; expr: FormulaExpression }

export const defaultValueExpressionSchema: z.ZodType<DefaultValueExpression> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('literal'), value: z.unknown() }),
    z.object({ kind: z.literal('today') }),
    z.object({ kind: z.literal('now') }),
    z.object({ kind: z.literal('current_user_person_id') }),
    z.object({ kind: z.literal('current_user_name') }),
    z.object({ kind: z.literal('expression'), expr: formulaExpressionSchema }),
  ]),
)

export const fieldTypeSchema = z.enum([
  // standard
  'text',
  'textarea',
  'long_text', // alias of textarea — preferred name for multi-line in canonical templates
  'number',
  'date',
  'datetime',
  'time',
  'email',
  'phone',
  'url',
  'table', // grid of cells — addable or predefined rows
  // choice
  'radio',
  'checkbox_group',
  'select',
  'multi_select',
  // scoring
  'pass_fail_na',
  'rating',
  'yes_no_comment',
  'traffic_light',
  // pickers
  'person_picker',
  'multi_person_picker', // person_picker with multiple selection
  'site_picker',
  'equipment_picker',
  'ppe_picker',
  'document_picker',
  'course_picker',
  // media
  'photo',
  'photo_upload', // alias of photo — preferred name for camera-first capture
  'file',
  'video',
  'audio',
  // identity
  'signature',
  'typed_attestation',
  // computed
  'formula',
  'calc', // alias of formula — preferred name for computed cells
  'risk_matrix',
  // display
  'heading',
  'paragraph',
  'image',
  'divider',
])

export type FieldType = z.infer<typeof fieldTypeSchema>

// --- Table field config -----------------------------------------------------
//
// A `table` field stores its column + row definitions in FormField.config (the
// freeform bag). The runtime value in form_responses.data[fieldId] is an array
// of row objects keyed by column key: [{ <colKey>: value, … }, …].
export type TableColumnType = 'text' | 'number' | 'select' | 'checkbox' | 'date'

export const tableColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  type: z.enum(['text', 'number', 'select', 'checkbox', 'date']),
  // Options for `select` columns.
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
})
export type TableColumn = z.infer<typeof tableColumnSchema>

export const tableConfigSchema = z.object({
  columns: z.array(tableColumnSchema),
  // 'addable' → the filler adds/removes rows (bounded by min/max). 'fixed' →
  // predefined rows the filler fills in; each `rows[i].label` shows in a
  // read-only lead column.
  rowMode: z.enum(['addable', 'fixed']).default('addable'),
  minRows: z.number().int().nonnegative().optional(),
  maxRows: z.number().int().positive().optional(),
  rows: z.array(z.object({ label: z.string() })).optional(),
})
export type TableConfig = z.infer<typeof tableConfigSchema>

export const fieldValidationSchema = z
  .object({
    // Optional `required` on the validation block mirrors FormField.required.
    // The filler treats `field.required || field.validation?.required` as the
    // effective check, so designers can edit it from the Validation tab.
    required: z.boolean().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    pattern: z.string().optional(),
    message: z.string().optional(),
    options: z
      .array(z.object({ value: z.string(), label: i18nStringSchema }))
      .optional(),
    allowOther: z.boolean().optional(),
  })
  .partial()

export type FieldValidation = z.infer<typeof fieldValidationSchema>

export const formFieldSchema = z.object({
  id: z.string().min(1),
  type: fieldTypeSchema,
  label: i18nStringSchema,
  helpText: i18nStringSchema.optional(),
  required: z.boolean().optional(),
  showIf: logicRuleSchema.optional(),
  validation: fieldValidationSchema.optional(),
  permissions: z.object({ visibleToRoles: z.array(z.string()).optional() }).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  // Typed JSON formula tree. When present, the field is computed and read-only
  // in the filler. Independent of the legacy `field.config.expr` string-based
  // formula — both are supported.
  formula: formulaExpressionSchema.optional(),
  // Default value applied to first render of a step when the response value is
  // empty. Resolved against request context (user, now) by `resolveDefaultValue`.
  defaultValue: defaultValueExpressionSchema.optional(),
  // Width within the section's column grid (1 = one cell). Absent ⇒ full row.
  // Capped to the section's column count at render. Back-compatible.
  colSpan: z.number().int().min(1).max(12).optional(),
})

export type FormField = z.infer<typeof formFieldSchema>

// --- Free-form canvas layout ------------------------------------------------
//
// When a section has a `canvas`, its fields are positioned on a 12-ish column
// grid (Appsmith / WordPress-style). Each item references a field by id and
// carries its grid box {x,y,w,h} in grid units. The DESIGNER edits this with
// react-grid-layout; the END PRODUCT renders it mobile-first: a single stacked
// column on phones (in y,x reading order) and the positioned grid on ≥640px.
export const canvasItemSchema = z.object({
  i: z.string().min(1), // field id
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
})
export type CanvasItem = z.infer<typeof canvasItemSchema>

export const canvasLayoutSchema = z.object({
  cols: z.number().int().min(1).max(24).default(12),
  rowHeight: z.number().int().min(8).max(400).default(40),
  items: z.array(canvasItemSchema),
})
export type CanvasLayout = z.infer<typeof canvasLayoutSchema>

export const formSectionSchema = z.object({
  id: z.string().min(1),
  title: i18nStringSchema.optional(),
  description: i18nStringSchema.optional(),
  showIf: logicRuleSchema.optional(),
  repeating: z.boolean().optional(),
  // Bounds on a repeating section. `minRows` blocks step navigation /
  // submission until satisfied; `maxRows` disables the "Add row" button.
  minRows: z.number().int().nonnegative().optional(),
  maxRows: z.number().int().positive().optional(),
  // Template for each row's header label, e.g. "Load #{index+1}". Supports
  // `{index}`, `{index+1}`, and `{<fieldKey>}` interpolation from the row's
  // own values.
  rowLabelTemplate: z.string().optional(),
  // Section grid layout. Absent ⇒ single-column stack (today's behavior).
  layout: z
    .object({
      columns: z.number().int().min(1).max(4),
      gap: z.enum(['sm', 'md', 'lg']).optional(),
    })
    .optional(),
  // Free-form positioned layout. Absent ⇒ stacked / column layout (above).
  // Takes precedence over `layout` when present.
  canvas: canvasLayoutSchema.optional(),
  step: z.string().optional(),
  fields: z.array(formFieldSchema),
})

export type FormSection = z.infer<typeof formSectionSchema>

export const formWorkflowStepSchema = z.object({
  key: z.string().min(1),
  title: i18nStringSchema,
  assignee: z.discriminatedUnion('type', [
    z.object({ type: z.literal('literal'), userId: z.string() }),
    z.object({ type: z.literal('role'), role: z.string() }),
    z.object({ type: z.literal('expression'), expr: z.string() }),
  ]),
  signatureRequired: z.boolean().optional(),
  visibleSections: z.array(z.string()).optional(),
  visibleFields: z.array(z.string()).optional(),
})

export type FormWorkflowStep = z.infer<typeof formWorkflowStepSchema>

// --- Score-based routing ---------------------------------------------------
//
// Carried on FormSchemaV1.workflow.scoreRouting. The submit-side score-router
// helper consumes this to compute a compliance score and decide whether to
// auto-flag a response as non_compliant + suggest spawning CAPAs.
//
// Designer-UI wiring for `scoreFormula` is reserved for a later pass; for now
// callers either omit it (we derive a default from pass_fail_na / yes_no_comment
// fields) or set it programmatically in a seed.
export const hardFailRuleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('any_field_eq'),
    fieldKeys: z.array(z.string()).min(1),
    value: z.string(),
  }),
  z.object({
    kind: z.literal('any_field_in'),
    fieldKeys: z.array(z.string()).min(1),
    values: z.array(z.string()).min(1),
  }),
])

export type HardFailRule = z.infer<typeof hardFailRuleSchema>

export const scoreRoutingSchema = z.object({
  scoreFormula: formulaExpressionSchema.optional(),
  thresholdScore: z.number().optional(),
  hardFailRules: z.array(hardFailRuleSchema).optional(),
})

export type ScoreRouting = z.infer<typeof scoreRoutingSchema>

export const formSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  title: i18nStringSchema,
  description: i18nStringSchema.optional(),
  sections: z.array(formSectionSchema).min(1),
  workflow: z.object({
    steps: z.array(formWorkflowStepSchema).min(1),
    scoreRouting: scoreRoutingSchema.optional(),
  }),
  permissions: z
    .object({
      fieldVisibility: z.record(z.string(), z.array(z.string())).optional(),
    })
    .optional(),
  pdf: z
    .object({
      css: z.string().optional(),
      header: z.string().optional(),
      footer: z.string().optional(),
      pageSize: z.enum(['A4', 'Letter']).optional(),
    })
    .optional(),
  metadata: z.object({ riskMatrixKey: z.string().optional() }).optional(),
})

export type FormSchemaV1 = z.infer<typeof formSchemaV1>

export function validateFormSchema(input: unknown): FormSchemaV1 {
  return formSchemaV1.parse(input)
}

// Lightweight check: every showIf rule references a real field id.
export function lintFormSchema(schema: FormSchemaV1): string[] {
  const errors: string[] = []
  const fieldIds = new Set<string>()
  for (const sec of schema.sections) for (const f of sec.fields) fieldIds.add(f.id)

  const walk = (rule: LogicRule, where: string) => {
    if ('rules' in rule) rule.rules.forEach((r) => walk(r, where))
    else if ('rule' in rule) walk(rule.rule, where)
    else if ('field' in rule && !fieldIds.has(rule.field)) {
      errors.push(`${where}: showIf references unknown field "${rule.field}"`)
    }
  }
  for (const sec of schema.sections) {
    if (sec.showIf) walk(sec.showIf, `section:${sec.id}`)
    for (const f of sec.fields) if (f.showIf) walk(f.showIf, `field:${f.id}`)
  }
  return errors
}
