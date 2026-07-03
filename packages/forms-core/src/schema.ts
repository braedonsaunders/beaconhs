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
// `evaluateFormulaTree()` in `./evaluator.ts` — the only formula runtime;
// designer-built calc fields always persist a typed tree.
export type FormulaExpression =
  | { kind: 'literal'; value: number | string }
  | { kind: 'field_ref'; fieldKey: string }
  | { kind: 'sum'; of: FormulaExpression[] }
  | { kind: 'product'; of: FormulaExpression[] }
  | { kind: 'subtract'; left: FormulaExpression; right: FormulaExpression }
  | { kind: 'divide'; left: FormulaExpression; right: FormulaExpression }
  | { kind: 'min'; of: FormulaExpression[] }
  | { kind: 'max'; of: FormulaExpression[] }
  // Scientific math. `power` = base^exponent; `root` = of^(1/degree) with sign
  // preserved for odd roots (cube root of a negative stays negative); `round`
  // rounds to `places` decimals (default 0). All guard against NaN/∞ → 0.
  | { kind: 'power'; base: FormulaExpression; exponent: FormulaExpression }
  | { kind: 'root'; of: FormulaExpression; degree: FormulaExpression }
  | { kind: 'abs'; of: FormulaExpression }
  | { kind: 'round'; of: FormulaExpression; places?: number }
  | { kind: 'floor'; of: FormulaExpression }
  | { kind: 'ceil'; of: FormulaExpression }
  // sum / count / avg / min / max a field across all rows of a repeating
  // section ("rollups").
  | { kind: 'sum_section'; sectionKey: string; rowFieldKey: string }
  | { kind: 'count_section'; sectionKey: string }
  | { kind: 'avg_section'; sectionKey: string; rowFieldKey: string }
  | { kind: 'min_section'; sectionKey: string; rowFieldKey: string }
  | { kind: 'max_section'; sectionKey: string; rowFieldKey: string }
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
      kind: z.literal('power'),
      base: formulaExpressionSchema,
      exponent: formulaExpressionSchema,
    }),
    z.object({
      kind: z.literal('root'),
      of: formulaExpressionSchema,
      degree: formulaExpressionSchema,
    }),
    z.object({ kind: z.literal('abs'), of: formulaExpressionSchema }),
    z.object({
      kind: z.literal('round'),
      of: formulaExpressionSchema,
      places: z.number().int().optional(),
    }),
    z.object({ kind: z.literal('floor'), of: formulaExpressionSchema }),
    z.object({ kind: z.literal('ceil'), of: formulaExpressionSchema }),
    z.object({
      kind: z.literal('sum_section'),
      sectionKey: z.string(),
      rowFieldKey: z.string(),
    }),
    z.object({ kind: z.literal('count_section'), sectionKey: z.string() }),
    z.object({ kind: z.literal('avg_section'), sectionKey: z.string(), rowFieldKey: z.string() }),
    z.object({ kind: z.literal('min_section'), sectionKey: z.string(), rowFieldKey: z.string() }),
    z.object({ kind: z.literal('max_section'), sectionKey: z.string(), rowFieldKey: z.string() }),
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
  'slider', // numeric value picked on a min–max range slider
  'date',
  'datetime',
  'time',
  'gps', // captures the device's location (lat/lng/accuracy)
  'email',
  'phone',
  'url',
  'rich_text', // formatted text (sanitized HTML)
  'address', // structured postal address + optional geocode (autocomplete)
  'qr_scanner', // scan a QR / barcode via the device camera → decoded string
  'table', // grid of cells — addable or predefined rows
  // choice
  'radio',
  'checkbox_group',
  'select',
  'multi_select',
  'ranking', // drag a set of options into a ranked order
  // scoring
  'pass_fail_na',
  'rating',
  'yes_no_comment',
  'traffic_light',
  'matrix', // Likert grid — rate each row on a shared scale
  // pickers
  'person_picker',
  'multi_person_picker', // person_picker with multiple selection
  // Org-unit pickers — one per level of the org_units hierarchy
  // (customer → project → site → area). All store an org_unit id.
  'customer_picker', // org_units at level='customer'
  'project_picker', // org_units at level='project' (e.g. legacy "Job Number")
  'site_picker', // org_units at level='site'
  'area_picker', // org_units at level='area'
  'equipment_picker',
  'ppe_picker',
  'document_picker',
  'course_picker',
  // media
  'photo',
  'photo_upload', // alias of photo — preferred name for camera-first capture
  'photo_ai', // photo capture + AI safety analysis (missing PPE / hazards)
  'photo_annotated', // photo + tap-to-drop numbered hazard markers
  'file',
  'video',
  'audio',
  'sketch', // freehand diagram / drawing canvas (Excalidraw) → PNG attachment + scene
  // identity
  'signature',
  'typed_attestation',
  // computed
  'formula',
  'calc', // alias of formula — preferred name for computed cells
  'risk_matrix',
  // data-bound (read a tenant DATA SOURCE via field.binding)
  'lookup', // data-bound dropdown — pick a row, optionally auto-fill other fields
  'data_table', // show / select rows from a data source
  'metric', // KPI / chart — an aggregate over a data source
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
    options: z.array(z.object({ value: z.string(), label: i18nStringSchema })).optional(),
    allowOther: z.boolean().optional(),
  })
  .partial()

export type FieldValidation = z.infer<typeof fieldValidationSchema>

// --- Data binding (data-bound elements) -------------------------------------
//
// Attached to `FormField.binding` on data-bound elements (`lookup`,
// `data_table`, `metric`). Names a tenant DATA SOURCE (data_sources.key) plus
// how to read it. The query/aggregate layer (apps/web forms/_lib/data-sources)
// resolves these server-side, RLS-bound; the browser only AUTHORS them — it
// never queries across tenants.
export const dataAggregateFnSchema = z.enum(['count', 'sum', 'avg', 'min', 'max'])
export type DataAggregateFn = z.infer<typeof dataAggregateFnSchema>

// How a `metric` element renders its aggregate result.
export const dataDisplaySchema = z.enum(['number', 'bar', 'line', 'pie', 'table'])
export type DataDisplay = z.infer<typeof dataDisplaySchema>

export const dataBindingSchema = z.object({
  // data_sources.key of the bound source.
  sourceKey: z.string().min(1),
  // lookup/select: which source column is the STORED value (default = row id)
  // and which is the visible label.
  valueColumn: z.string().optional(),
  labelColumn: z.string().optional(),
  // Cascading: narrow this list by another FIELD's current value.
  // `filterByField` is the parent field id; `filterColumn` is the column IN THIS
  // source matched against the parent field's selected value.
  filterByField: z.string().optional(),
  filterColumn: z.string().optional(),
  // Lookup auto-fill: when a row is selected, copy these source columns into the
  // named target fields of the same response.
  autofill: z.array(z.object({ column: z.string(), targetFieldId: z.string() })).optional(),
  // Static equality filters applied to every query (column === value).
  where: z.array(z.object({ column: z.string(), value: z.unknown() })).optional(),
  // data_table: which columns to show (default = all source columns) + whether
  // rows are selectable (selection stores row ids in the response value).
  columns: z.array(z.string()).optional(),
  selectable: z.enum(['none', 'single', 'multi']).optional(),
  // metric (KPI/chart): the aggregate + how to display it.
  aggregate: z
    .object({
      fn: dataAggregateFnSchema,
      // Required for sum/avg/min/max; ignored for count.
      column: z.string().optional(),
      // Group rows by this column to produce a series (for charts / breakdowns).
      groupBy: z.string().optional(),
    })
    .optional(),
  display: dataDisplaySchema.optional(),
  // Hard cap on rows fetched (safety bound; also limits data_table length).
  limit: z.number().int().positive().max(1000).optional(),
})
export type DataBinding = z.infer<typeof dataBindingSchema>

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
  // Data-source binding for data-bound elements (lookup / data_table / metric).
  binding: dataBindingSchema.optional(),
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
  // Presentational TAB this section belongs to (see FormSchemaV1.tabs). Absent ⇒
  // the first tab. Independent of `step` (the sign-off/wizard page).
  tabId: z.string().optional(),
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

// --- Monitored-session config ----------------------------------------------
//
// When present (+ enabled), submitting this app starts a live MONITORED SESSION:
// the response gets a recurring check-in timer and is escalated if a check-in is
// missed past the grace period. Powers Lone Worker, permit timers, periodic
// checks, etc. Interval / grace / duration are literals OR bound to a fill field
// (so the worker picks them at start). Escalation is configured in Flows via the
// `session_overdue` trigger. See docs/monitored-sessions-design.md.
export const monitorConfigSchema = z.object({
  enabled: z.literal(true),
  intervalMinutes: z.number().int().positive(),
  intervalFieldKey: z.string().optional(),
  graceMinutes: z.number().int().nonnegative(),
  graceFieldKey: z.string().optional(),
  durationMinutes: z.number().int().positive().optional(),
  durationFieldKey: z.string().optional(),
  requireGeo: z.boolean().optional(),
})
export type MonitorConfig = z.infer<typeof monitorConfigSchema>

export const formSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  title: i18nStringSchema,
  description: i18nStringSchema.optional(),
  sections: z.array(formSectionSchema).min(1),
  // Presentational tabs for the FILL experience (purely navigation — NOT
  // sign-off, unlike workflow.steps). When ≥2 tabs exist on a single-step app,
  // the filler shows a tab bar and each section appears under section.tabId.
  tabs: z.array(z.object({ id: z.string().min(1), title: i18nStringSchema })).optional(),
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
  // Optional monitored-session config — turns this app into a live timed session.
  monitor: monitorConfigSchema.optional(),
})

export type FormSchemaV1 = z.infer<typeof formSchemaV1>

export function validateFormSchema(input: unknown): FormSchemaV1 {
  return formSchemaV1.parse(input)
}

// Lightweight check: every showIf rule references a real field id, and every
// designer-authored validation pattern compiles as a regular expression.
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
    for (const f of sec.fields) {
      if (f.showIf) walk(f.showIf, `field:${f.id}`)
      if (f.validation?.pattern) {
        try {
          new RegExp(f.validation.pattern)
        } catch {
          errors.push(`field:${f.id}: validation pattern is not a valid regular expression`)
        }
      }
    }
  }
  return errors
}
