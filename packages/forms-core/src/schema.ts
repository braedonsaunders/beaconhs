import { z } from 'zod'

// Runtime-validated form schema. Keep in lockstep with the TS types in
// @beaconhs/db/schema/forms.ts — these are the source of truth at runtime.

export const i18nStringSchema = z.record(z.string(), z.string())

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

export const fieldValidationSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    pattern: z.string().optional(),
    options: z
      .array(z.object({ value: z.string(), label: i18nStringSchema }))
      .optional(),
    allowOther: z.boolean().optional(),
  })
  .partial()

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
})

export type FormField = z.infer<typeof formFieldSchema>

export const formSectionSchema = z.object({
  id: z.string().min(1),
  title: i18nStringSchema.optional(),
  description: i18nStringSchema.optional(),
  showIf: logicRuleSchema.optional(),
  repeating: z.boolean().optional(),
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

export const formSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  title: i18nStringSchema,
  description: i18nStringSchema.optional(),
  sections: z.array(formSectionSchema).min(1),
  workflow: z.object({ steps: z.array(formWorkflowStepSchema).min(1) }),
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
