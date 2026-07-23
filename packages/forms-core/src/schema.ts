import { z } from 'zod'
import { isScoringField, storesResponseValue } from './field-types'
import { entityKindForPicker, getEntityAttrDef } from './entity-attrs'

// Runtime-validated form schema. Keep in lockstep with the TS types in
// @beaconhs/db/schema/forms.ts — these are the source of truth at runtime.

export const i18nStringSchema = z.record(z.string(), z.string())

// Re-export the inferred string-map type so callers can reference it directly.
export type I18nString = z.infer<typeof i18nStringSchema>

export const logicRuleSchema: z.ZodType<LogicRule> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({ op: z.enum(['and', 'or']), rules: z.array(logicRuleSchema).max(100) }),
    z.object({ op: z.literal('not'), rule: logicRuleSchema }),
    z.object({
      op: z.enum(['eq', 'ne', 'gt', 'lt', 'gte', 'lte']),
      field: z.string().max(128),
      value: z.unknown(),
    }),
    z.object({
      op: z.enum(['in', 'notIn']),
      field: z.string().max(128),
      value: z.array(z.unknown()).max(100),
    }),
    z.object({ op: z.enum(['isSet', 'isNotSet']), field: z.string().max(128) }),
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
  // `pickerFieldKey` names a top-level person or org-unit picker. `attrKey`
  // must be present in
  // ENTITY_ATTRS[<kind>] (see entity-attrs.ts) or the evaluator returns null.
  // The runtime fetches the row attrs server-side and threads them into
  // EvalContext.entities — see evaluator.ts and the filler RSC loader.
  | { kind: 'entity_attr'; pickerFieldKey: string; attrKey: string }

export const formulaExpressionSchema: z.ZodType<FormulaExpression> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('literal'),
      value: z.union([z.number(), z.string().max(10_000)]),
    }),
    z.object({ kind: z.literal('field_ref'), fieldKey: z.string().max(128) }),
    z.object({ kind: z.literal('sum'), of: z.array(formulaExpressionSchema).max(100) }),
    z.object({ kind: z.literal('product'), of: z.array(formulaExpressionSchema).max(100) }),
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
    z.object({ kind: z.literal('min'), of: z.array(formulaExpressionSchema).max(100) }),
    z.object({ kind: z.literal('max'), of: z.array(formulaExpressionSchema).max(100) }),
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
      places: z.number().int().min(0).max(12).optional(),
    }),
    z.object({ kind: z.literal('floor'), of: formulaExpressionSchema }),
    z.object({ kind: z.literal('ceil'), of: formulaExpressionSchema }),
    z.object({
      kind: z.literal('sum_section'),
      sectionKey: z.string().max(128),
      rowFieldKey: z.string().max(128),
    }),
    z.object({ kind: z.literal('count_section'), sectionKey: z.string().max(128) }),
    z.object({
      kind: z.literal('avg_section'),
      sectionKey: z.string().max(128),
      rowFieldKey: z.string().max(128),
    }),
    z.object({
      kind: z.literal('min_section'),
      sectionKey: z.string().max(128),
      rowFieldKey: z.string().max(128),
    }),
    z.object({
      kind: z.literal('max_section'),
      sectionKey: z.string().max(128),
      rowFieldKey: z.string().max(128),
    }),
    z.object({
      kind: z.literal('concat'),
      of: z.array(formulaExpressionSchema).max(100),
      separator: z.string().max(1_000).optional(),
    }),
    z.object({
      kind: z.literal('if'),
      condition: logicRuleSchema,
      then: formulaExpressionSchema,
      else: formulaExpressionSchema,
    }),
    z.object({
      kind: z.literal('entity_attr'),
      pickerFieldKey: z.string().max(128),
      attrKey: z.string().max(128),
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
  'long_text',
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
  // media
  'photo',
  'file',
  'video',
  'audio',
  'sketch', // freehand diagram / drawing canvas (Excalidraw) → PNG attachment + scene
  // identity
  'signature',
  'typed_attestation',
  // computed
  'formula',
  'risk_matrix',
  // data-bound (read a tenant DATA SOURCE via field.binding)
  'lookup', // data-bound dropdown — pick a row, optionally auto-fill other fields
  'data_table', // show / select rows from a data source
  'metric', // KPI / chart — an aggregate over a data source
  // display
  'heading',
  'paragraph',
  'divider',
])

export type FieldType = z.infer<typeof fieldTypeSchema>

// Builder and native record photos share this non-destructive markup contract.
const photoPointSchema = z.tuple([
  z.number().finite().min(0).max(1_000),
  z.number().finite().min(0).max(1_000),
])
const photoColorSchema = z.string().regex(/^#[0-9a-f]{6}$/iu)
const photoStrokeWidthSchema = z.number().finite().min(1).max(50)
export const MAX_PHOTO_ANNOTATION_POINTS = 5_000

export const photoAnnotationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('arrow'),
      from: photoPointSchema,
      to: photoPointSchema,
      color: photoColorSchema,
      width: photoStrokeWidthSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('circle'),
      cx: z.number().finite().min(0).max(1_000),
      cy: z.number().finite().min(0).max(1_000),
      r: z.number().finite().min(0).max(1_500),
      color: photoColorSchema,
      width: photoStrokeWidthSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('rect'),
      x: z.number().finite().min(0).max(1_000),
      y: z.number().finite().min(0).max(1_000),
      w: z.number().finite().min(0).max(1_000),
      h: z.number().finite().min(0).max(1_000),
      color: photoColorSchema,
      width: photoStrokeWidthSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('text'),
      x: z.number().finite().min(0).max(1_000),
      y: z.number().finite().min(0).max(1_000),
      text: z.string().max(500),
      color: photoColorSchema,
      size: z.number().finite().min(4).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal('free'),
      points: z.array(photoPointSchema).min(1).max(MAX_PHOTO_ANNOTATION_POINTS),
      color: photoColorSchema,
      width: photoStrokeWidthSchema,
    })
    .strict(),
])
export type PhotoAnnotation = z.infer<typeof photoAnnotationSchema>
// Allows the former 500 numbered markers plus up to 200 freehand edits after
// those records are migrated to the shared annotation contract.
export const MAX_PHOTO_ANNOTATIONS = 700

// Builder photos use one value contract regardless of whether optional AI
// analysis is enabled. Captions and markup live on each response attachment so
// the same uploaded image can be described differently in different records.

export type PhotoAttachmentValue = {
  attachmentId: string
  filename: string
  contentType: string
  url: string
  caption?: string
  annotations?: PhotoAnnotation[]
  width?: number
  height?: number
}

export type PhotoFieldValue = {
  attachments: PhotoAttachmentValue[]
  analysis?: {
    summary: string
    overallRisk: 'none' | 'low' | 'medium' | 'high'
    ppe: Array<{
      item: string
      status: 'present' | 'missing' | 'incorrect'
      detail: string | null
    }>
    hazards: Array<{
      type: string
      severity: 'low' | 'medium' | 'high'
      detail: string
    }>
  }
  analyzedAt?: string
}

export type PhotoFieldConfig = {
  multiple?: boolean
  maxFiles?: number
  aiAnalysis?: boolean
}

export const photoFieldConfigSchema = z
  .object({
    multiple: z.boolean().optional(),
    maxFiles: z.number().int().min(1).max(50).optional(),
    aiAnalysis: z.boolean().optional(),
  })
  .strict()

// --- Table field config -----------------------------------------------------
//
// A `table` field stores its column + row definitions in FormField.config (the
// freeform bag). The runtime value in form_responses.data[fieldId] is an array
// of row objects keyed by column key: [{ <colKey>: value, … }, …].
export type TableColumnType = 'text' | 'number' | 'select' | 'checkbox' | 'date'

export const tableColumnSchema = z.object({
  key: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(500),
  type: z.enum(['text', 'number', 'select', 'checkbox', 'date']),
  // Options for `select` columns.
  options: z
    .array(
      z.object({
        value: z.string().trim().min(1).max(500),
        label: z.string().trim().min(1).max(500),
      }),
    )
    .max(100)
    .optional(),
})
export type TableColumn = z.infer<typeof tableColumnSchema>

export const tableConfigSchema = z.object({
  columns: z.array(tableColumnSchema).min(1).max(50),
  // 'addable' → the filler adds/removes rows (bounded by min/max). 'fixed' →
  // predefined rows the filler fills in; each `rows[i].label` shows in a
  // read-only lead column.
  rowMode: z.enum(['addable', 'fixed']).default('addable'),
  minRows: z.number().int().nonnegative().max(500).optional(),
  maxRows: z.number().int().positive().max(500).optional(),
  rows: z
    .array(z.object({ label: z.string().trim().min(1).max(500) }))
    .max(500)
    .optional(),
})
export type TableConfig = z.infer<typeof tableConfigSchema>

export const matrixConfigSchema = z.object({
  rows: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(128),
        label: z.string().trim().min(1).max(500),
      }),
    )
    .min(1)
    .max(50),
  scale: z
    .array(
      z.object({
        value: z.string().trim().min(1).max(128),
        label: z.string().trim().min(1).max(500),
      }),
    )
    .min(2)
    .max(20),
})
export type MatrixConfig = z.infer<typeof matrixConfigSchema>

export const fieldValidationSchema = z
  .object({
    // Optional `required` on the validation block mirrors FormField.required.
    // The filler treats `field.required || field.validation?.required` as the
    // effective check, so designers can edit it from the Validation tab.
    required: z.boolean().optional(),
    min: z.number().min(-1_000_000_000).max(1_000_000_000).optional(),
    max: z.number().min(-1_000_000_000).max(1_000_000_000).optional(),
    minLength: z.number().int().nonnegative().max(100_000).optional(),
    maxLength: z.number().int().nonnegative().max(100_000).optional(),
    pattern: z.string().max(256).optional(),
    message: z.string().max(2_000).optional(),
    options: z
      .array(z.object({ value: z.string().max(500), label: i18nStringSchema }))
      .max(100)
      .optional(),
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
export const dataDisplaySchema = z.enum(['number', 'bar', 'pie'])
export type DataDisplay = z.infer<typeof dataDisplaySchema>

export const dataBindingSchema = z.object({
  // data_sources.key of the bound source.
  sourceKey: z.string().trim().min(1).max(128),
  // lookup/select: which source column is the STORED value (default = row id)
  // and which is the visible label.
  valueColumn: z.string().trim().min(1).max(128).optional(),
  labelColumn: z.string().trim().min(1).max(128).optional(),
  // Cascading: narrow this list by another FIELD's current value.
  // `filterByField` is the parent field id; `filterColumn` is the column IN THIS
  // source matched against the parent field's selected value.
  filterByField: z.string().max(128).optional(),
  filterColumn: z.string().trim().min(1).max(128).optional(),
  // Lookup auto-fill: when a row is selected, copy these source columns into the
  // named target fields of the same response.
  autofill: z
    .array(
      z.object({
        column: z.string().trim().min(1).max(128),
        targetFieldId: z.string().max(128),
      }),
    )
    .max(50)
    .optional(),
  // Static equality filters applied to every query (column === value).
  where: z
    .array(z.object({ column: z.string().trim().min(1).max(128), value: z.unknown() }))
    .max(50)
    .optional(),
  // data_table: which columns to show (default = all source columns) + whether
  // rows are selectable (selection stores row ids in the response value).
  columns: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
  selectable: z.enum(['none', 'single', 'multi']).optional(),
  // metric (KPI/chart): the aggregate + how to display it.
  aggregate: z
    .object({
      fn: dataAggregateFnSchema,
      // Required for sum/avg/min/max; ignored for count.
      column: z.string().trim().min(1).max(128).optional(),
      // Group rows by this column to produce a series (for charts / breakdowns).
      groupBy: z.string().trim().min(1).max(128).optional(),
    })
    .optional(),
  display: dataDisplaySchema.optional(),
  // Display bound only: lookup results per remote search, data-table rows per
  // page, or metric groups returned for a chart. It never limits the source
  // rows included in filters, exact counts, or aggregate calculations.
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
  config: z.record(z.string(), z.unknown()).optional(),
  // Data-source binding for data-bound elements (lookup / data_table / metric).
  binding: dataBindingSchema.optional(),
  // Typed JSON formula tree. Formula fields are computed and read-only in the
  // filler; this tree is their sole persisted expression format.
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
})

export type FormWorkflowStep = z.infer<typeof formWorkflowStepSchema>

// --- Score-based routing ---------------------------------------------------
//
// Carried on FormSchemaV1.workflow.scoreRouting. The submit-side score-router
// helper consumes this to compute a compliance score and decide whether to
// auto-flag a response as non_compliant + suggest spawning CAPAs.
//
// When scoreFormula is absent, the score router derives its default from
// pass_fail_na / yes_no_comment fields.
export const hardFailRuleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('any_field_eq'),
    fieldKeys: z.array(z.string().max(128)).min(1).max(100),
    value: z.string().max(500),
  }),
  z.object({
    kind: z.literal('any_field_in'),
    fieldKeys: z.array(z.string().max(128)).min(1).max(100),
    values: z.array(z.string().max(500)).min(1).max(100),
  }),
])

export type HardFailRule = z.infer<typeof hardFailRuleSchema>

export const scoreRoutingSchema = z.object({
  scoreFormula: formulaExpressionSchema.optional(),
  thresholdScore: z.number().min(0).max(100).optional(),
  hardFailRules: z.array(hardFailRuleSchema).max(100).optional(),
})

export type ScoreRouting = z.infer<typeof scoreRoutingSchema>

const formSchemaV1Base = z.object({
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
  pdf: z
    .object({
      css: z.string().optional(),
      header: z.string().optional(),
      footer: z.string().optional(),
      pageSize: z.enum(['A4', 'Letter']).optional(),
    })
    .optional(),
})

type SchemaInvariantIssue = {
  path: Array<string | number>
  message: string
}

const MAX_NUMERIC_FIELD_CONFIG = 1_000_000_000
const MAX_VALIDATION_PATTERN_LENGTH = 256
const MAX_FORM_IDENTIFIER_LENGTH = 128
const FORM_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]+$/
const RESERVED_FORM_IDENTIFIERS = new Set(Object.getOwnPropertyNames(Object.prototype))
const CHOICE_FIELD_TYPES = new Set<FieldType>([
  'select',
  'radio',
  'multi_select',
  'checkbox_group',
  'ranking',
])
const NUMERIC_VALIDATION_FIELD_TYPES = new Set<FieldType>(['number', 'slider', 'rating'])
const TEXT_VALIDATION_FIELD_TYPES = new Set<FieldType>([
  'text',
  'long_text',
  'rich_text',
  'email',
  'phone',
  'url',
  'date',
  'datetime',
  'time',
  'qr_scanner',
])
const ALLOW_OTHER_FIELD_TYPES = new Set<FieldType>([
  'select',
  'radio',
  'multi_select',
  'checkbox_group',
])

function textValidationHardLimit(type: FieldType): number | null {
  switch (type) {
    case 'long_text':
    case 'rich_text':
      return 100_000
    case 'email':
      return 320
    case 'url':
      return 2_048
    case 'phone':
      return 100
    case 'date':
    case 'datetime':
    case 'time':
      return 50
    case 'text':
    case 'qr_scanner':
      return 10_000
    default:
      return null
  }
}

/**
 * Return why a designer-authored regular expression is unsafe, or null when
 * it is safe to execute against a bounded response string.
 *
 * JavaScript RegExp has no execution timeout. Quantified groups, lookarounds,
 * and backreferences can introduce catastrophic backtracking, so form
 * patterns deliberately support a conservative regular subset: an anchored
 * expression made from literals, character classes, and exact `{n}`
 * repetition. Variable repetition and alternation are excluded because even
 * individually simple overlapping branches can create polynomial or
 * exponential ReDoS. This
 * still covers practical fixed-format masks such as employee numbers and
 * postal codes without making submission validation a DoS primitive.
 */
export function validationPatternError(pattern: string): string | null {
  if (pattern.length === 0) return null
  if (pattern.length > MAX_VALIDATION_PATTERN_LENGTH) {
    return `must be no longer than ${MAX_VALIDATION_PATTERN_LENGTH} characters`
  }
  try {
    new RegExp(pattern)
  } catch {
    return 'is not a valid regular expression'
  }

  let trailingBackslashes = 0
  for (let index = pattern.length - 2; index >= 0 && pattern[index] === '\\'; index -= 1) {
    trailingBackslashes += 1
  }
  if (!pattern.startsWith('^') || !pattern.endsWith('$') || trailingBackslashes % 2 === 1) {
    return 'must be anchored with ^ and $'
  }

  if (/\\(?:[1-9]|k<)/.test(pattern)) return 'must not contain backreferences'
  if (/\(\?(?:[=!]|<[=!])/.test(pattern)) return 'must not contain lookaround assertions'

  let escaped = false
  let inCharacterClass = false
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '[') {
      inCharacterClass = true
      continue
    }
    if (char === ']' && inCharacterClass) {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass) continue
    if (char === '|') return 'must not contain alternation'
    if (char === '*' || char === '+') return 'must not contain variable repetition'
    if (char === '?') {
      if (pattern[index - 1] === '(' && pattern[index + 1] === ':') continue
      return 'must not contain variable repetition'
    }
    if (char === '{') {
      if (pattern[index - 1] === ')') return 'must not quantify groups'
      const close = pattern.indexOf('}', index + 1)
      const count = close === -1 ? '' : pattern.slice(index + 1, close)
      if (!/^\d{1,4}$/.test(count) || Number(count) > 1_000) {
        return 'may only use exact {n} repetition up to 1000'
      }
      index = close
    }
  }

  return null
}

function appendConfigParseIssues(
  issues: SchemaInvariantIssue[],
  error: z.ZodError,
  path: Array<string | number>,
  label: string,
): void {
  for (const zodIssue of error.issues) {
    issues.push({
      path: [
        ...path,
        ...zodIssue.path.filter(
          (part): part is string | number => typeof part === 'string' || typeof part === 'number',
        ),
      ],
      message: `Invalid ${label}: ${zodIssue.message}`,
    })
  }
}

function pathLabel(path: Array<string | number>): string {
  return path
    .map((part, index) =>
      typeof part === 'number' ? `[${part}]` : `${index === 0 ? '' : '.'}${part}`,
    )
    .join('')
}

function identifierIssue(value: string): string | null {
  if (value.length > MAX_FORM_IDENTIFIER_LENGTH) {
    return `must be no longer than ${MAX_FORM_IDENTIFIER_LENGTH} characters`
  }
  if (!FORM_IDENTIFIER_PATTERN.test(value)) {
    return 'may contain only letters, numbers, underscores, and hyphens'
  }
  if (RESERVED_FORM_IDENTIFIERS.has(value)) return `uses reserved key "${value}"`
  return null
}

/**
 * Collect cross-field invariants that a single nested Zod node cannot express.
 * This implementation powers both canonical parsing and designer lint output
 * so the two boundaries cannot drift.
 */
function schemaInvariantIssues(schema: z.infer<typeof formSchemaV1Base>): SchemaInvariantIssue[] {
  const issues: SchemaInvariantIssue[] = []

  function recordDuplicate(
    seen: Map<string, Array<string | number>>,
    value: string,
    path: Array<string | number>,
    label: string,
  ) {
    const firstPath = seen.get(value)
    if (firstPath) {
      issues.push({
        path,
        message: `Duplicate ${label} "${value}"; first declared at ${pathLabel(firstPath)}`,
      })
    } else {
      seen.set(value, path)
    }
  }

  const sectionIds = new Map<string, Array<string | number>>()
  const repeatingSectionIds = new Map<string, Array<string | number>>()
  schema.sections.forEach((section, sectionIndex) => {
    if (section.repeating && !repeatingSectionIds.has(section.id)) {
      repeatingSectionIds.set(section.id, ['sections', sectionIndex, 'id'])
    }
  })
  const fieldIds = new Map<string, Array<string | number>>()
  schema.sections.forEach((section, sectionIndex) => {
    const sectionIdPath: Array<string | number> = ['sections', sectionIndex, 'id']
    recordDuplicate(sectionIds, section.id, sectionIdPath, 'section id')
    const invalidSectionId = identifierIssue(section.id)
    if (invalidSectionId) {
      issues.push({ path: sectionIdPath, message: `Section id ${invalidSectionId}` })
    }
    if (
      section.repeating &&
      section.minRows !== undefined &&
      section.maxRows !== undefined &&
      section.minRows > section.maxRows
    ) {
      issues.push({
        path: ['sections', sectionIndex, 'maxRows'],
        message: `Repeating section maxRows (${section.maxRows}) must be greater than or equal to minRows (${section.minRows})`,
      })
    }
    section.fields.forEach((field, fieldIndex) => {
      const fieldBasePath: Array<string | number> = ['sections', sectionIndex, 'fields', fieldIndex]
      const fieldPath: Array<string | number> = [...fieldBasePath, 'id']
      recordDuplicate(fieldIds, field.id, fieldPath, 'field id')
      const invalidFieldId = identifierIssue(field.id)
      if (invalidFieldId) {
        issues.push({ path: fieldPath, message: `Field id ${invalidFieldId}` })
      }
      if (field.id.startsWith('__section_')) {
        issues.push({
          path: fieldPath,
          message: `Field id "${field.id}" uses reserved prefix "__section_"`,
        })
      }
      const repeatingSectionPath = !section.repeating
        ? repeatingSectionIds.get(field.id)
        : undefined
      if (repeatingSectionPath) {
        issues.push({
          path: fieldPath,
          message: `Top-level field id "${field.id}" collides with repeating section response key declared at ${pathLabel(repeatingSectionPath)}`,
        })
      }
      const tableMinRows = field.type === 'table' ? field.config?.minRows : undefined
      const tableMaxRows = field.type === 'table' ? field.config?.maxRows : undefined
      if (
        typeof tableMinRows === 'number' &&
        typeof tableMaxRows === 'number' &&
        tableMinRows > tableMaxRows
      ) {
        issues.push({
          path: ['sections', sectionIndex, 'fields', fieldIndex, 'config', 'maxRows'],
          message: `Table maxRows (${tableMaxRows}) must be greater than or equal to minRows (${tableMinRows})`,
        })
      }
      if (field.type === 'photo') {
        const photoConfig = photoFieldConfigSchema.safeParse(field.config ?? {})
        if (!photoConfig.success) {
          issues.push({
            path: [...fieldBasePath, 'config'],
            message: 'Photo configuration is invalid',
          })
        } else if (photoConfig.data.multiple === false && photoConfig.data.maxFiles !== undefined) {
          if (photoConfig.data.maxFiles !== 1) {
            issues.push({
              path: [...fieldBasePath, 'config', 'maxFiles'],
              message: 'Single-photo fields must have a maximum of 1 photo',
            })
          }
        }
      }

      if (
        field.validation?.min !== undefined &&
        field.validation.max !== undefined &&
        field.validation.min > field.validation.max
      ) {
        issues.push({
          path: [...fieldBasePath, 'validation', 'max'],
          message: `Validation max (${field.validation.max}) must be greater than or equal to min (${field.validation.min})`,
        })
      }
      if (
        field.validation?.minLength !== undefined &&
        field.validation.maxLength !== undefined &&
        field.validation.minLength > field.validation.maxLength
      ) {
        issues.push({
          path: [...fieldBasePath, 'validation', 'maxLength'],
          message: `Validation maxLength (${field.validation.maxLength}) must be greater than or equal to minLength (${field.validation.minLength})`,
        })
      }

      const validation = field.validation
      if (validation) {
        if (
          !NUMERIC_VALIDATION_FIELD_TYPES.has(field.type) &&
          (validation.min !== undefined || validation.max !== undefined)
        ) {
          issues.push({
            path: [...fieldBasePath, 'validation'],
            message: `${field.type} fields cannot define numeric min or max validation`,
          })
        }
        if (
          !TEXT_VALIDATION_FIELD_TYPES.has(field.type) &&
          (validation.minLength !== undefined ||
            validation.maxLength !== undefined ||
            validation.pattern !== undefined)
        ) {
          issues.push({
            path: [...fieldBasePath, 'validation'],
            message: `${field.type} fields cannot define text-length or pattern validation`,
          })
        }
        if (!CHOICE_FIELD_TYPES.has(field.type) && validation.options !== undefined) {
          issues.push({
            path: [...fieldBasePath, 'validation', 'options'],
            message: `${field.type} fields cannot define choice options`,
          })
        }
        if (!ALLOW_OTHER_FIELD_TYPES.has(field.type) && validation.allowOther !== undefined) {
          issues.push({
            path: [...fieldBasePath, 'validation', 'allowOther'],
            message: `${field.type} fields do not support custom choice values`,
          })
        }

        const hardTextLimit = textValidationHardLimit(field.type)
        if (hardTextLimit !== null) {
          if (validation.minLength !== undefined && validation.minLength > hardTextLimit) {
            issues.push({
              path: [...fieldBasePath, 'validation', 'minLength'],
              message: `${field.type} minLength cannot exceed its ${hardTextLimit}-character response limit`,
            })
          }
          if (validation.maxLength !== undefined && validation.maxLength > hardTextLimit) {
            issues.push({
              path: [...fieldBasePath, 'validation', 'maxLength'],
              message: `${field.type} maxLength cannot exceed its ${hardTextLimit}-character response limit`,
            })
          }
        }
      }
      if (field.validation?.pattern) {
        const patternError = validationPatternError(field.validation.pattern)
        if (patternError) {
          issues.push({
            path: [...fieldBasePath, 'validation', 'pattern'],
            message: `Validation pattern ${patternError}`,
          })
        }
      }

      if (!storesResponseValue(field)) {
        if (field.required || field.validation?.required) {
          issues.push({
            path: [...fieldBasePath, 'required'],
            message: `${field.type} does not store a response value and cannot be required`,
          })
        }
        if (
          field.validation &&
          Object.entries(field.validation).some(
            ([key, value]) => key !== 'required' && value !== undefined,
          )
        ) {
          issues.push({
            path: [...fieldBasePath, 'validation'],
            message: `${field.type} does not store a response value and cannot define validation rules`,
          })
        }
        if (field.defaultValue !== undefined) {
          issues.push({
            path: [...fieldBasePath, 'defaultValue'],
            message: `${field.type} does not store a response value and cannot define a default value`,
          })
        }
      }

      if (isScoringField(field.type) && field.config?.weight !== undefined) {
        const weight = field.config.weight
        if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 1 || weight > 100) {
          issues.push({
            path: [...fieldBasePath, 'config', 'weight'],
            message: 'Scoring weight must be an integer from 1 to 100',
          })
        }
      }

      if (CHOICE_FIELD_TYPES.has(field.type)) {
        const options = field.validation?.options
        if (!options || options.length === 0) {
          issues.push({
            path: [...fieldBasePath, 'validation', 'options'],
            message: `${field.type} fields require at least one choice option`,
          })
        } else {
          if (options.length > 100) {
            issues.push({
              path: [...fieldBasePath, 'validation', 'options'],
              message: `${field.type} fields support no more than 100 choice options`,
            })
          }
          const optionValues = new Map<string, number>()
          options.forEach((option, optionIndex) => {
            if (!option.value.trim() || option.value.length > 500) {
              issues.push({
                path: [...fieldBasePath, 'validation', 'options', optionIndex, 'value'],
                message: 'Choice option values must contain 1 to 500 characters',
              })
            }
            const first = optionValues.get(option.value)
            if (first !== undefined) {
              issues.push({
                path: [...fieldBasePath, 'validation', 'options', optionIndex, 'value'],
                message: `Duplicate choice option value "${option.value}"; first declared at validation.options[${first}].value`,
              })
            } else {
              optionValues.set(option.value, optionIndex)
            }
          })
        }
      }

      if (field.type === 'matrix') {
        const parsed = matrixConfigSchema.safeParse(field.config)
        if (!parsed.success) {
          appendConfigParseIssues(
            issues,
            parsed.error,
            [...fieldBasePath, 'config'],
            'matrix config',
          )
        } else {
          const rowKeys = new Map<string, number>()
          parsed.data.rows.forEach((row, rowIndex) => {
            const first = rowKeys.get(row.key)
            if (first !== undefined) {
              issues.push({
                path: [...fieldBasePath, 'config', 'rows', rowIndex, 'key'],
                message: `Duplicate matrix row key "${row.key}"; first declared at config.rows[${first}].key`,
              })
            } else {
              rowKeys.set(row.key, rowIndex)
            }
          })
          const scaleValues = new Map<string, number>()
          parsed.data.scale.forEach((point, pointIndex) => {
            const first = scaleValues.get(point.value)
            if (first !== undefined) {
              issues.push({
                path: [...fieldBasePath, 'config', 'scale', pointIndex, 'value'],
                message: `Duplicate matrix scale value "${point.value}"; first declared at config.scale[${first}].value`,
              })
            } else {
              scaleValues.set(point.value, pointIndex)
            }
          })
        }
      }

      if (field.type === 'table') {
        const parsed = tableConfigSchema.safeParse(field.config)
        if (!parsed.success) {
          appendConfigParseIssues(
            issues,
            parsed.error,
            [...fieldBasePath, 'config'],
            'table config',
          )
        } else {
          const columnKeys = new Map<string, number>()
          parsed.data.columns.forEach((column, columnIndex) => {
            const first = columnKeys.get(column.key)
            if (first !== undefined) {
              issues.push({
                path: [...fieldBasePath, 'config', 'columns', columnIndex, 'key'],
                message: `Duplicate table column key "${column.key}"; first declared at config.columns[${first}].key`,
              })
            } else {
              columnKeys.set(column.key, columnIndex)
            }
            if (column.type === 'select') {
              if (!column.options?.length) {
                issues.push({
                  path: [...fieldBasePath, 'config', 'columns', columnIndex, 'options'],
                  message: 'Select table columns require at least one option',
                })
              } else {
                const values = new Map<string, number>()
                column.options.forEach((option, optionIndex) => {
                  const optionFirst = values.get(option.value)
                  if (optionFirst !== undefined) {
                    issues.push({
                      path: [
                        ...fieldBasePath,
                        'config',
                        'columns',
                        columnIndex,
                        'options',
                        optionIndex,
                        'value',
                      ],
                      message: `Duplicate table option value "${option.value}"; first declared at options[${optionFirst}].value`,
                    })
                  } else {
                    values.set(option.value, optionIndex)
                  }
                })
              }
            } else if (column.options !== undefined) {
              issues.push({
                path: [...fieldBasePath, 'config', 'columns', columnIndex, 'options'],
                message: 'Only select table columns may define options',
              })
            }
          })
          if (parsed.data.rowMode === 'fixed' && !parsed.data.rows?.length) {
            issues.push({
              path: [...fieldBasePath, 'config', 'rows'],
              message: 'Fixed tables require at least one predefined row',
            })
          }
          if (
            parsed.data.rowMode === 'fixed' &&
            (parsed.data.minRows !== undefined || parsed.data.maxRows !== undefined)
          ) {
            issues.push({
              path: [...fieldBasePath, 'config'],
              message: 'Fixed tables cannot define addable-row limits',
            })
          }
          if (parsed.data.rowMode === 'addable' && parsed.data.rows !== undefined) {
            issues.push({
              path: [...fieldBasePath, 'config', 'rows'],
              message: 'Addable tables cannot define predefined rows',
            })
          }
        }
      }

      if (field.type === 'number' || field.type === 'slider') {
        const config = field.config ?? {}
        for (const key of ['min', 'max', 'step'] as const) {
          const value = config[key]
          if (
            value !== undefined &&
            (typeof value !== 'number' ||
              !Number.isFinite(value) ||
              Math.abs(value) > MAX_NUMERIC_FIELD_CONFIG)
          ) {
            issues.push({
              path: [...fieldBasePath, 'config', key],
              message: `${field.type} ${key} must be a finite number between -${MAX_NUMERIC_FIELD_CONFIG} and ${MAX_NUMERIC_FIELD_CONFIG}`,
            })
          }
        }
        if (typeof config.step === 'number' && config.step <= 0) {
          issues.push({
            path: [...fieldBasePath, 'config', 'step'],
            message: `${field.type} step must be greater than zero`,
          })
        }
        const effectiveMin =
          typeof config.min === 'number' ? config.min : field.type === 'slider' ? 0 : undefined
        const effectiveMax =
          typeof config.max === 'number' ? config.max : field.type === 'slider' ? 10 : undefined
        if (
          effectiveMin !== undefined &&
          effectiveMax !== undefined &&
          effectiveMin >= effectiveMax
        ) {
          issues.push({
            path: [...fieldBasePath, 'config', 'max'],
            message: `${field.type} max (${effectiveMax}) must be greater than min (${effectiveMin})`,
          })
        }
        if (
          config.unit !== undefined &&
          (typeof config.unit !== 'string' || config.unit.length > 50)
        ) {
          issues.push({
            path: [...fieldBasePath, 'config', 'unit'],
            message: `${field.type} unit must be text no longer than 50 characters`,
          })
        }

        if (
          typeof effectiveMin === 'number' &&
          field.validation?.min !== undefined &&
          field.validation.min < effectiveMin
        ) {
          issues.push({
            path: [...fieldBasePath, 'validation', 'min'],
            message: `Validation min (${field.validation.min}) cannot be below configured min (${effectiveMin})`,
          })
        }
        if (
          typeof effectiveMax === 'number' &&
          field.validation?.max !== undefined &&
          field.validation.max > effectiveMax
        ) {
          issues.push({
            path: [...fieldBasePath, 'validation', 'max'],
            message: `Validation max (${field.validation.max}) cannot exceed configured max (${effectiveMax})`,
          })
        }

        const finiteEffectiveMin =
          typeof effectiveMin === 'number' && Number.isFinite(effectiveMin)
            ? effectiveMin
            : undefined
        const finiteEffectiveMax =
          typeof effectiveMax === 'number' && Number.isFinite(effectiveMax)
            ? effectiveMax
            : undefined
        const rangeMin = Math.max(
          -MAX_NUMERIC_FIELD_CONFIG,
          finiteEffectiveMin ?? -MAX_NUMERIC_FIELD_CONFIG,
          field.validation?.min ?? -MAX_NUMERIC_FIELD_CONFIG,
        )
        const rangeMax = Math.min(
          MAX_NUMERIC_FIELD_CONFIG,
          finiteEffectiveMax ?? MAX_NUMERIC_FIELD_CONFIG,
          field.validation?.max ?? MAX_NUMERIC_FIELD_CONFIG,
        )
        if (rangeMin > rangeMax) {
          issues.push({
            path: [...fieldBasePath, 'validation'],
            message: `Validation range does not overlap the configured ${field.type} range`,
          })
        } else {
          const step =
            typeof config.step === 'number' && Number.isFinite(config.step) && config.step > 0
              ? config.step
              : field.type === 'slider'
                ? 1
                : undefined
          if (step !== undefined) {
            const base = finiteEffectiveMin ?? 0
            const quotient = (rangeMin - base) / step
            const firstIndex = Math.ceil(
              quotient - Number.EPSILON * Math.max(16, Math.abs(quotient)),
            )
            const firstValue = base + firstIndex * step
            const tolerance =
              Number.EPSILON * Math.max(16, Math.abs(firstValue), Math.abs(rangeMax))
            if (firstValue > rangeMax + tolerance) {
              issues.push({
                path: [...fieldBasePath, 'validation'],
                message: `Validation range contains no value aligned to the ${field.type} step (${step})`,
              })
            }
          }
        }
      }

      if (field.type === 'rating') {
        const configuredMax = field.config?.max
        if (
          configuredMax !== undefined &&
          (typeof configuredMax !== 'number' ||
            !Number.isInteger(configuredMax) ||
            configuredMax < 1 ||
            configuredMax > 10)
        ) {
          issues.push({
            path: [...fieldBasePath, 'config', 'max'],
            message: 'Rating max must be an integer from 1 to 10',
          })
        }
        const max =
          typeof configuredMax === 'number' && Number.isInteger(configuredMax) ? configuredMax : 5
        for (const key of ['min', 'max'] as const) {
          const value = field.validation?.[key]
          if (value !== undefined && !Number.isInteger(value)) {
            issues.push({
              path: [...fieldBasePath, 'validation', key],
              message: `Rating validation ${key} must be a whole number`,
            })
          }
        }
        if (field.validation?.min !== undefined && field.validation.min < 1) {
          issues.push({
            path: [...fieldBasePath, 'validation', 'min'],
            message: 'Rating validation min cannot be below 1',
          })
        }
        if (field.validation?.min !== undefined && field.validation.min > max) {
          issues.push({
            path: [...fieldBasePath, 'validation', 'min'],
            message: `Rating validation min cannot exceed the ${max}-point scale`,
          })
        }
        if (field.validation?.max !== undefined && field.validation.max < 1) {
          issues.push({
            path: [...fieldBasePath, 'validation', 'max'],
            message: 'Rating validation max cannot be below 1',
          })
        }
        if (field.validation?.max !== undefined && field.validation.max > max) {
          issues.push({
            path: [...fieldBasePath, 'validation', 'max'],
            message: `Rating validation max cannot exceed the ${max}-point scale`,
          })
        }
      }

      if (
        field.type === 'typed_attestation' &&
        field.config?.statement !== undefined &&
        (typeof field.config.statement !== 'string' || field.config.statement.length > 2_000)
      ) {
        issues.push({
          path: [...fieldBasePath, 'config', 'statement'],
          message: 'Typed attestation statement must be text no longer than 2,000 characters',
        })
      }

      if (field.type === 'formula') {
        if (!field.formula) {
          issues.push({
            path: [...fieldBasePath, 'formula'],
            message: 'Formula fields require a formula expression',
          })
        }
        if (
          field.config?.defaultDisplay !== undefined &&
          (typeof field.config.defaultDisplay !== 'string' ||
            field.config.defaultDisplay.length > 500)
        ) {
          issues.push({
            path: [...fieldBasePath, 'config', 'defaultDisplay'],
            message: 'Formula defaultDisplay must be text no longer than 500 characters',
          })
        }
      } else if (field.formula !== undefined) {
        issues.push({
          path: [...fieldBasePath, 'formula'],
          message: `Only formula fields may define a formula expression`,
        })
      }

      if (['lookup', 'data_table', 'metric'].includes(field.type) && !field.binding) {
        issues.push({
          path: [...fieldBasePath, 'binding'],
          message: `${field.type} fields require a data-source binding`,
        })
      } else if (!['lookup', 'data_table', 'metric'].includes(field.type) && field.binding) {
        issues.push({
          path: [...fieldBasePath, 'binding'],
          message: `Only lookup, data_table, and metric fields may define a data-source binding`,
        })
      }

      if (field.config?.expr !== undefined) {
        issues.push({
          path: [...fieldBasePath, 'config', 'expr'],
          message: 'Legacy string formulas are not supported; use the typed formula expression',
        })
      }
    })
  })

  const topLevelValueIds = new Set<string>()
  for (const section of schema.sections) {
    if (section.repeating) continue
    for (const field of section.fields) {
      if (storesResponseValue(field)) topLevelValueIds.add(field.id)
    }
  }
  const allValueIds = new Set(topLevelValueIds)
  const sectionDefinitions = new Map<string, { section: FormSection; sectionIndex: number }>()
  const fieldDefinitions = new Map<
    string,
    { field: FormField; section: FormSection; sectionIndex: number; fieldIndex: number }
  >()
  schema.sections.forEach((section, sectionIndex) => {
    if (!sectionDefinitions.has(section.id)) {
      sectionDefinitions.set(section.id, { section, sectionIndex })
    }
    section.fields.forEach((field, fieldIndex) => {
      if (!fieldDefinitions.has(field.id)) {
        fieldDefinitions.set(field.id, { field, section, sectionIndex, fieldIndex })
      }
      if (storesResponseValue(field)) allValueIds.add(field.id)
    })
  })

  const validateRuleReferences = (
    rule: LogicRule,
    allowed: ReadonlySet<string>,
    path: Array<string | number>,
    ownerFieldId?: string,
    contextLabel = 'showIf',
  ) => {
    const stack: Array<{ rule: LogicRule; depth: number }> = [{ rule, depth: 1 }]
    let nodeCount = 0
    while (stack.length > 0) {
      const current = stack.pop()!
      nodeCount += 1
      if (nodeCount > 500) {
        issues.push({ path, message: `${contextLabel} supports no more than 500 rule nodes` })
        return
      }
      if (current.depth > 32) {
        issues.push({ path, message: `${contextLabel} may not be nested more than 32 levels` })
        continue
      }
      if ('rules' in current.rule) {
        for (const child of current.rule.rules) {
          stack.push({ rule: child, depth: current.depth + 1 })
        }
        continue
      }
      if ('rule' in current.rule) {
        stack.push({ rule: current.rule.rule, depth: current.depth + 1 })
        continue
      }
      const referencedId = current.rule.field
      const referencedPath = fieldIds.get(referencedId)
      if (!referencedPath) {
        issues.push({ path, message: `${contextLabel} references unknown field "${referencedId}"` })
      } else if (!allowed.has(referencedId)) {
        issues.push({
          path,
          message: `${contextLabel} references field "${referencedId}" outside its evaluation context`,
        })
      } else if (referencedId === ownerFieldId) {
        issues.push({
          path,
          message:
            contextLabel === 'showIf'
              ? `Field "${referencedId}" showIf cannot reference itself`
              : `${contextLabel} cannot reference its own field "${referencedId}"`,
        })
      }
    }
  }

  const directValueIdsForSection = (section: FormSection): Set<string> => {
    const allowed = new Set(topLevelValueIds)
    if (section.repeating) {
      for (const field of section.fields) {
        if (storesResponseValue(field)) allowed.add(field.id)
      }
    }
    return allowed
  }

  const validateFormulaReferences = (
    formula: FormulaExpression,
    allowedDirectFields: ReadonlySet<string>,
    path: Array<string | number>,
    options: { contextLabel: string; ownerFieldId?: string; allowComputedRollups: boolean },
  ) => {
    const stack: Array<{
      expression: FormulaExpression
      path: Array<string | number>
      depth: number
    }> = [{ expression: formula, path, depth: 1 }]
    let nodeCount = 0

    const push = (
      expression: FormulaExpression,
      childPath: Array<string | number>,
      depth: number,
    ) => stack.push({ expression, path: childPath, depth })

    while (stack.length > 0) {
      const current = stack.pop()!
      nodeCount += 1
      if (nodeCount > 500) {
        issues.push({ path, message: `${options.contextLabel} supports no more than 500 nodes` })
        return
      }
      if (current.depth > 32) {
        issues.push({
          path: current.path,
          message: `${options.contextLabel} may not be nested more than 32 levels`,
        })
        continue
      }

      const expression = current.expression
      const nextDepth = current.depth + 1
      switch (expression.kind) {
        case 'literal':
          break
        case 'field_ref': {
          if (!fieldIds.has(expression.fieldKey)) {
            issues.push({
              path: [...current.path, 'fieldKey'],
              message: `${options.contextLabel} references unknown field "${expression.fieldKey}"`,
            })
          } else if (!allowedDirectFields.has(expression.fieldKey)) {
            issues.push({
              path: [...current.path, 'fieldKey'],
              message: `${options.contextLabel} references field "${expression.fieldKey}" outside its evaluation context`,
            })
          } else if (expression.fieldKey === options.ownerFieldId) {
            issues.push({
              path: [...current.path, 'fieldKey'],
              message: `${options.contextLabel} cannot reference its own field "${expression.fieldKey}"`,
            })
          }
          break
        }
        case 'sum':
        case 'product':
        case 'min':
        case 'max':
        case 'concat':
          expression.of.forEach((child, index) =>
            push(child, [...current.path, 'of', index], nextDepth),
          )
          break
        case 'subtract':
        case 'divide':
          push(expression.left, [...current.path, 'left'], nextDepth)
          push(expression.right, [...current.path, 'right'], nextDepth)
          break
        case 'power':
          push(expression.base, [...current.path, 'base'], nextDepth)
          push(expression.exponent, [...current.path, 'exponent'], nextDepth)
          break
        case 'root':
          push(expression.of, [...current.path, 'of'], nextDepth)
          push(expression.degree, [...current.path, 'degree'], nextDepth)
          break
        case 'abs':
        case 'round':
        case 'floor':
        case 'ceil':
          push(expression.of, [...current.path, 'of'], nextDepth)
          break
        case 'if':
          validateRuleReferences(
            expression.condition,
            allowedDirectFields,
            [...current.path, 'condition'],
            options.ownerFieldId,
            `${options.contextLabel} condition`,
          )
          push(expression.then, [...current.path, 'then'], nextDepth)
          push(expression.else, [...current.path, 'else'], nextDepth)
          break
        case 'count_section': {
          const sectionDefinition = sectionDefinitions.get(expression.sectionKey)
          if (!sectionDefinition) {
            issues.push({
              path: [...current.path, 'sectionKey'],
              message: `${options.contextLabel} references unknown section "${expression.sectionKey}"`,
            })
          } else if (!sectionDefinition.section.repeating) {
            issues.push({
              path: [...current.path, 'sectionKey'],
              message: `${options.contextLabel} section "${expression.sectionKey}" is not repeating`,
            })
          }
          break
        }
        case 'sum_section':
        case 'avg_section':
        case 'min_section':
        case 'max_section': {
          const sectionDefinition = sectionDefinitions.get(expression.sectionKey)
          if (!sectionDefinition) {
            issues.push({
              path: [...current.path, 'sectionKey'],
              message: `${options.contextLabel} references unknown section "${expression.sectionKey}"`,
            })
            break
          }
          if (!sectionDefinition.section.repeating) {
            issues.push({
              path: [...current.path, 'sectionKey'],
              message: `${options.contextLabel} section "${expression.sectionKey}" is not repeating`,
            })
            break
          }
          const rowField = sectionDefinition.section.fields.find(
            (field) => field.id === expression.rowFieldKey,
          )
          if (!rowField) {
            issues.push({
              path: [...current.path, 'rowFieldKey'],
              message: `${options.contextLabel} references unknown row field "${expression.rowFieldKey}" in section "${expression.sectionKey}"`,
            })
          } else if (
            !storesResponseValue(rowField) &&
            !(
              options.allowComputedRollups &&
              rowField.type === 'formula' &&
              rowField.formula !== undefined
            )
          ) {
            issues.push({
              path: [...current.path, 'rowFieldKey'],
              message: `${options.contextLabel} cannot aggregate non-value field "${expression.rowFieldKey}"`,
            })
          }
          break
        }
        case 'entity_attr': {
          const pickerDefinition = fieldDefinitions.get(expression.pickerFieldKey)
          const pickerKind =
            pickerDefinition && !pickerDefinition.section.repeating
              ? entityKindForPicker(pickerDefinition.field.type)
              : null
          if (!pickerDefinition) {
            issues.push({
              path: [...current.path, 'pickerFieldKey'],
              message: `${options.contextLabel} references unknown picker field "${expression.pickerFieldKey}"`,
            })
          } else if (!pickerKind) {
            issues.push({
              path: [...current.path, 'pickerFieldKey'],
              message: `${options.contextLabel} field "${expression.pickerFieldKey}" is not a compatible top-level picker`,
            })
          } else if (!getEntityAttrDef(pickerKind, expression.attrKey)) {
            issues.push({
              path: [...current.path, 'attrKey'],
              message: `${options.contextLabel} attribute "${expression.attrKey}" is not allowed for ${pickerKind} pickers`,
            })
          }
          break
        }
      }
    }
  }

  schema.sections.forEach((section, sectionIndex) => {
    if (section.showIf) {
      validateRuleReferences(section.showIf, topLevelValueIds, ['sections', sectionIndex, 'showIf'])
    }
    const fieldRuleIds = new Set(topLevelValueIds)
    if (section.repeating) {
      for (const field of section.fields) {
        if (storesResponseValue(field)) fieldRuleIds.add(field.id)
      }
    }
    section.fields.forEach((field, fieldIndex) => {
      if (!field.showIf) return
      validateRuleReferences(
        field.showIf,
        fieldRuleIds,
        ['sections', sectionIndex, 'fields', fieldIndex, 'showIf'],
        field.id,
      )
    })
  })

  const bindingCommonKeys = new Set([
    'sourceKey',
    'filterByField',
    'filterColumn',
    'where',
    'limit',
  ])
  const bindingKeysByType: Partial<Record<FieldType, ReadonlySet<string>>> = {
    lookup: new Set([...bindingCommonKeys, 'valueColumn', 'labelColumn', 'autofill']),
    data_table: new Set([...bindingCommonKeys, 'columns', 'selectable']),
    metric: new Set([...bindingCommonKeys, 'aggregate', 'display']),
  }

  schema.sections.forEach((section, sectionIndex) => {
    const directValueIds = directValueIdsForSection(section)
    section.fields.forEach((field, fieldIndex) => {
      const fieldBasePath: Array<string | number> = ['sections', sectionIndex, 'fields', fieldIndex]
      if (field.formula) {
        validateFormulaReferences(field.formula, directValueIds, [...fieldBasePath, 'formula'], {
          contextLabel: `Formula field "${field.id}"`,
          ownerFieldId: field.id,
          allowComputedRollups: !section.repeating,
        })
      }
      if (field.defaultValue?.kind === 'expression') {
        validateFormulaReferences(
          field.defaultValue.expr,
          topLevelValueIds,
          [...fieldBasePath, 'defaultValue', 'expr'],
          {
            contextLabel: `Default for field "${field.id}"`,
            ownerFieldId: field.id,
            allowComputedRollups: true,
          },
        )
      }

      const binding = field.binding
      if (!binding) return
      const allowedBindingKeys = bindingKeysByType[field.type]
      if (allowedBindingKeys) {
        for (const key of Object.keys(binding)) {
          if (!allowedBindingKeys.has(key)) {
            issues.push({
              path: [...fieldBasePath, 'binding', key],
              message: `${field.type} bindings do not support "${key}"`,
            })
          }
        }
      }

      const hasFilterField = binding.filterByField !== undefined
      const hasFilterColumn = binding.filterColumn !== undefined
      if (hasFilterField !== hasFilterColumn) {
        issues.push({
          path: [...fieldBasePath, 'binding'],
          message: 'Cascading data bindings require both filterByField and filterColumn',
        })
      }
      if (binding.filterByField) {
        if (!fieldIds.has(binding.filterByField)) {
          issues.push({
            path: [...fieldBasePath, 'binding', 'filterByField'],
            message: `Data binding references unknown field "${binding.filterByField}"`,
          })
        } else if (!directValueIds.has(binding.filterByField)) {
          issues.push({
            path: [...fieldBasePath, 'binding', 'filterByField'],
            message: `Data binding field "${binding.filterByField}" is outside its evaluation context`,
          })
        } else if (binding.filterByField === field.id) {
          issues.push({
            path: [...fieldBasePath, 'binding', 'filterByField'],
            message: 'A data binding cannot filter itself',
          })
        }
      }

      const whereColumns = new Map<string, number>()
      binding.where?.forEach((clause, clauseIndex) => {
        const first = whereColumns.get(clause.column)
        if (first !== undefined) {
          issues.push({
            path: [...fieldBasePath, 'binding', 'where', clauseIndex, 'column'],
            message: `Duplicate static filter column "${clause.column}"; first declared at binding.where[${first}].column`,
          })
        } else {
          whereColumns.set(clause.column, clauseIndex)
        }
      })

      if (field.type === 'lookup' && binding.autofill) {
        const allowedTargets = section.repeating
          ? new Set(section.fields.filter(storesResponseValue).map((candidate) => candidate.id))
          : topLevelValueIds
        const targetIds = new Map<string, number>()
        binding.autofill.forEach((mapping, mappingIndex) => {
          const targetPath = [
            ...fieldBasePath,
            'binding',
            'autofill',
            mappingIndex,
            'targetFieldId',
          ]
          if (!fieldIds.has(mapping.targetFieldId)) {
            issues.push({
              path: targetPath,
              message: `Auto-fill references unknown field "${mapping.targetFieldId}"`,
            })
          } else if (!allowedTargets.has(mapping.targetFieldId)) {
            issues.push({
              path: targetPath,
              message: `Auto-fill target "${mapping.targetFieldId}" is outside its writable response context`,
            })
          } else if (mapping.targetFieldId === field.id) {
            issues.push({ path: targetPath, message: 'A lookup cannot auto-fill itself' })
          }
          const first = targetIds.get(mapping.targetFieldId)
          if (first !== undefined) {
            issues.push({
              path: targetPath,
              message: `Duplicate auto-fill target "${mapping.targetFieldId}"; first declared at binding.autofill[${first}].targetFieldId`,
            })
          } else {
            targetIds.set(mapping.targetFieldId, mappingIndex)
          }
        })
      }

      if (field.type === 'data_table' && binding.columns) {
        const columnKeys = new Map<string, number>()
        binding.columns.forEach((column, columnIndex) => {
          const first = columnKeys.get(column)
          if (first !== undefined) {
            issues.push({
              path: [...fieldBasePath, 'binding', 'columns', columnIndex],
              message: `Duplicate displayed data column "${column}"; first declared at binding.columns[${first}]`,
            })
          } else {
            columnKeys.set(column, columnIndex)
          }
        })
      }

      if (field.type === 'metric') {
        const aggregate = binding.aggregate
        if (aggregate?.fn !== undefined && aggregate.fn !== 'count' && !aggregate.column) {
          issues.push({
            path: [...fieldBasePath, 'binding', 'aggregate', 'column'],
            message: `${aggregate.fn} metrics require an aggregate column`,
          })
        }
        if (aggregate?.fn === 'count' && aggregate.column !== undefined) {
          issues.push({
            path: [...fieldBasePath, 'binding', 'aggregate', 'column'],
            message: 'Count metrics cannot define an unused aggregate column',
          })
        }
        if (aggregate?.groupBy) {
          if (binding.display === 'number') {
            issues.push({
              path: [...fieldBasePath, 'binding', 'display'],
              message: 'Grouped metrics must use a bar or pie display',
            })
          }
        } else if (binding.display !== undefined && binding.display !== 'number') {
          issues.push({
            path: [...fieldBasePath, 'binding', 'display'],
            message: 'Ungrouped metrics must use the number display',
          })
        }
      }
    })
  })

  const scoreRouting = schema.workflow.scoreRouting
  if (scoreRouting?.scoreFormula) {
    validateFormulaReferences(
      scoreRouting.scoreFormula,
      topLevelValueIds,
      ['workflow', 'scoreRouting', 'scoreFormula'],
      {
        contextLabel: 'Score formula',
        allowComputedRollups: false,
      },
    )
  }
  scoreRouting?.hardFailRules?.forEach((rule, ruleIndex) => {
    const seenFieldKeys = new Map<string, number>()
    rule.fieldKeys.forEach((fieldKey, fieldKeyIndex) => {
      const path = [
        'workflow',
        'scoreRouting',
        'hardFailRules',
        ruleIndex,
        'fieldKeys',
        fieldKeyIndex,
      ]
      if (!fieldIds.has(fieldKey)) {
        issues.push({ path, message: `Hard-fail rule references unknown field "${fieldKey}"` })
      } else if (!allValueIds.has(fieldKey)) {
        issues.push({
          path,
          message: `Hard-fail rule field "${fieldKey}" does not store a response value`,
        })
      }
      const first = seenFieldKeys.get(fieldKey)
      if (first !== undefined) {
        issues.push({
          path,
          message: `Duplicate hard-fail field "${fieldKey}"; first declared at fieldKeys[${first}]`,
        })
      } else {
        seenFieldKeys.set(fieldKey, fieldKeyIndex)
      }
    })
    if (rule.kind === 'any_field_in') {
      const seenValues = new Map<string, number>()
      rule.values.forEach((value, valueIndex) => {
        const first = seenValues.get(value)
        if (first !== undefined) {
          issues.push({
            path: ['workflow', 'scoreRouting', 'hardFailRules', ruleIndex, 'values', valueIndex],
            message: `Duplicate hard-fail value "${value}"; first declared at values[${first}]`,
          })
        } else {
          seenValues.set(value, valueIndex)
        }
      })
    }
  })

  const tabIds = new Map<string, Array<string | number>>()
  schema.tabs?.forEach((tab, tabIndex) => {
    const tabIdPath: Array<string | number> = ['tabs', tabIndex, 'id']
    recordDuplicate(tabIds, tab.id, tabIdPath, 'tab id')
    const invalidTabId = identifierIssue(tab.id)
    if (invalidTabId) issues.push({ path: tabIdPath, message: `Tab id ${invalidTabId}` })
  })
  schema.sections.forEach((section, sectionIndex) => {
    if (section.tabId && !tabIds.has(section.tabId)) {
      issues.push({
        path: ['sections', sectionIndex, 'tabId'],
        message: `Section tabId "${section.tabId}" does not reference a declared tab`,
      })
    }
  })

  const stepKeys = new Map<string, Array<string | number>>()
  schema.workflow.steps.forEach((step, stepIndex) => {
    const stepKeyPath: Array<string | number> = ['workflow', 'steps', stepIndex, 'key']
    recordDuplicate(stepKeys, step.key, stepKeyPath, 'workflow step key')
    const invalidStepKey = identifierIssue(step.key)
    if (invalidStepKey) {
      issues.push({ path: stepKeyPath, message: `Workflow step key ${invalidStepKey}` })
    }
  })
  schema.sections.forEach((section, sectionIndex) => {
    if (section.step && !stepKeys.has(section.step)) {
      issues.push({
        path: ['sections', sectionIndex, 'step'],
        message: `Section step "${section.step}" does not reference a declared workflow step`,
      })
    }
  })

  return issues
}

export const formSchemaV1 = formSchemaV1Base.superRefine((schema, ctx) => {
  for (const issue of schemaInvariantIssues(schema)) {
    ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  }
})

export type FormSchemaV1 = z.infer<typeof formSchemaV1>

export function validateFormSchema(input: unknown): FormSchemaV1 {
  return formSchemaV1.parse(input)
}

// Lightweight check: identifiers are unambiguous, every showIf rule references
// a real field id, and every designer-authored validation pattern is safe.
export function lintFormSchema(schema: FormSchemaV1): string[] {
  return schemaInvariantIssues(schema).map((issue) => `${pathLabel(issue.path)}: ${issue.message}`)
}
