import 'server-only'

// AI generation for the Builder: a natural-language prompt → a validated App
// (FormSchemaV1) or Flow (AutomationGraph). The model returns JSON which we
// validate against the SAME zod schemas the rest of the platform uses, linting
// for dangling references and retrying once with the validation error. The AI
// only ever DRAFTS — the result opens in the visual builder for a human to
// refine; nothing is auto-published.

import { runBuilderPrompt } from '@beaconhs/ai'
import type { AiConfig } from '@beaconhs/ai'
import {
  FIELD_TYPES,
  automationGraphSchema,
  formSchemaV1,
  lintAutomationGraph,
  lintFormSchema,
  type AutomationGraph,
  type FormSchemaV1,
} from '@beaconhs/forms-core'

export type GenResult<T> = { ok: true; value: T; warnings: string[] } | { ok: false; error: string }

// Pull the first JSON object out of a model response (handles ```json fences
// and stray prose around the object).
function extractJson(text: string): unknown {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1]!.trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object found')
  return JSON.parse(t.slice(start, end + 1))
}

function zodIssues(err: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return err.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ')
}

const FIELD_CATALOGUE = Object.values(FIELD_TYPES)
  .map((m) => `- ${m.type}: ${m.label} — ${m.description}`)
  .join('\n')

const APP_SYSTEM = `You design "Apps" (form schemas) for BeaconHS, a construction & industrial health-and-safety platform. Output a SINGLE JSON object matching this TypeScript shape, and NOTHING else (no prose, no markdown fences):

type FormSchemaV1 = {
  schemaVersion: 1
  title: { en: string }
  description?: { en: string }
  sections: Array<{
    id: string                 // unique snake_case, e.g. "general_info"
    title?: { en: string }
    description?: { en: string }
    repeating?: boolean        // true for "add N rows" sections (e.g. a list of loads)
    fields: Array<{
      id: string               // unique snake_case across the WHOLE form
      type: FieldType          // see catalogue below
      label: { en: string }
      helpText?: { en: string }
      required?: boolean
      validation?: {           // for choice fields, supply options:
        options?: Array<{ value: string; label: { en: string } }>
        min?: number; max?: number; minLength?: number; maxLength?: number
      }
      formula?: FormulaExpression  // ONLY for computed fields (type "calc"); see grammar below
    }>
  }>
  workflow: { steps: Array<{ key: string; title: { en: string }; assignee: { type: "expression"; expr: "$submitter" } }> }
}

FieldType catalogue (use the EXACT type strings):
${FIELD_CATALOGUE}

Computed fields — use type "calc" with a \`formula\` (a JSON expression tree). Never mark a computed field required or give it validation. FormulaExpression:
  { kind: "literal", value: number | string }
  { kind: "field_ref", fieldKey: string }                       // another field's id in this form
  { kind: "sum" | "product" | "min" | "max", of: FormulaExpression[] }
  { kind: "subtract" | "divide", left: FormulaExpression, right: FormulaExpression }
  { kind: "power", base: FormulaExpression, exponent: FormulaExpression }
  { kind: "root", of: FormulaExpression, degree: FormulaExpression }   // degree 2 = square root, 3 = cube root
  { kind: "abs" | "floor" | "ceil", of: FormulaExpression }
  { kind: "round", of: FormulaExpression, places?: number }
  { kind: "sum_section" | "avg_section" | "min_section" | "max_section", sectionKey: string, rowFieldKey: string }
  { kind: "count_section", sectionKey: string }
  { kind: "if", condition: LogicRule, then: FormulaExpression, else: FormulaExpression }
  { kind: "concat", of: FormulaExpression[], separator?: string }
Example — a "total" field that adds two number fields a + b:
  { "type":"calc", "id":"total", "label":{"en":"Total"}, "formula":{"kind":"sum","of":[{"kind":"field_ref","fieldKey":"a"},{"kind":"field_ref","fieldKey":"b"}]} }
For a total ACROSS the rows of a repeating section, use sum_section with the section's id and the row field's id.

Rules:
- Every section id and field id must be unique snake_case.
- For a value derived from other fields (totals, conversions, scores), add a type "calc" field with a \`formula\` rather than asking the user to compute it.
- For radio/select/multi_select/checkbox_group fields you MUST include validation.options.
- Use pass_fail_na for inspection checkpoints, signature for sign-offs, person_picker/site_picker for people/sites, photo for evidence.
- Group fields into sensible sections. Keep i18n labels under the "en" key.
- workflow.steps MUST contain at least one step (use key "submit", title {en:"Submit"}, assignee {type:"expression",expr:"$submitter"}).
- Output ONLY the JSON object.`

export async function generateAppFromPrompt(
  config: AiConfig | null | undefined,
  prompt: string,
): Promise<GenResult<FormSchemaV1>> {
  let lastErr = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const userPrompt =
      attempt === 0
        ? `Build an App for: ${prompt}`
        : `Build an App for: ${prompt}\n\nYour previous JSON was invalid (${lastErr}). Return corrected JSON only.`
    const text = await runBuilderPrompt(config, {
      system: APP_SYSTEM,
      prompt: userPrompt,
      tier: 'smart',
    })
    if (!text)
      return {
        ok: false,
        error: 'AI is not configured for this workspace, or the model did not respond.',
      }
    let json: unknown
    try {
      json = extractJson(text)
    } catch {
      lastErr = 'response was not valid JSON'
      continue
    }
    const parsed = formSchemaV1.safeParse(json)
    if (parsed.success) {
      return { ok: true, value: parsed.data, warnings: lintFormSchema(parsed.data) }
    }
    lastErr = zodIssues(parsed.error)
  }
  return { ok: false, error: `The AI returned an invalid app schema: ${lastErr}` }
}

// Edit an EXISTING app: the model receives the current schema + a change
// request and returns the COMPLETE updated schema (preserving field ids where
// it can). Powers the conversational "edit my app" assistant.
export async function generateAppEdit(
  config: AiConfig | null | undefined,
  prompt: string,
  currentSchema: FormSchemaV1,
): Promise<GenResult<FormSchemaV1>> {
  let lastErr = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const base = `Here is the CURRENT app as JSON:\n${JSON.stringify(currentSchema)}\n\nApply this change request: ${prompt}\n\nReturn the COMPLETE updated app as a single JSON object (same shape). Preserve existing section/field ids wherever they still apply; only add/remove/modify what the request needs.`
    const userPrompt =
      attempt === 0
        ? base
        : `${base}\n\nYour previous JSON was invalid (${lastErr}). Return corrected JSON only.`
    const text = await runBuilderPrompt(config, {
      system: APP_SYSTEM,
      prompt: userPrompt,
      tier: 'smart',
    })
    if (!text)
      return {
        ok: false,
        error: 'AI is not configured for this workspace, or the model did not respond.',
      }
    let json: unknown
    try {
      json = extractJson(text)
    } catch {
      lastErr = 'response was not valid JSON'
      continue
    }
    const parsed = formSchemaV1.safeParse(json)
    if (parsed.success) {
      return { ok: true, value: parsed.data, warnings: lintFormSchema(parsed.data) }
    }
    lastErr = zodIssues(parsed.error)
  }
  return { ok: false, error: `The AI returned an invalid app schema: ${lastErr}` }
}

const FLOW_SYSTEM = `You design "Flows" (automation graphs) for BeaconHS forms. A Flow is a node graph: triggers → conditions → gates/actions. Output a SINGLE JSON object matching this shape and NOTHING else:

type AutomationGraph = {
  schemaVersion: 1
  nodes: Array<{
    id: string
    position: { x: number; y: number }   // lay nodes out left→right, ~250px apart
    data:
      | { kind: "trigger"; trigger: { trigger: "on_submit" } | { trigger: "on_field_value"; rule: LogicRule } | { trigger: "status_change"; to: string } }
      | { kind: "condition"; rule: LogicRule; label?: string }
      | { kind: "action"; action: ActionData; label?: string }
      | { kind: "gate"; gate: { title: string; assignee: AssigneeTarget; signatureRequired?: boolean } }
  }>
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: "next" | "then" | "else" | "approve" | "reject" }>
}
type LogicRule = { op: "and"|"or"; rules: LogicRule[] } | { op: "eq"|"ne"|"gt"|"lt"|"gte"|"lte"; field: string; value: unknown } | { op: "isSet"|"isNotSet"; field: string }
type AssigneeTarget = { type: "role"; role: string } | { type: "submitter" } | { type: "field"; field: string }
type ActionData =
  | { action: "send_email"; to: Array<{type:"role";role:string}|{type:"submitter"}|{type:"literal";email:string}>; subject: string; bodyTemplate: string; attachPdf?: boolean }
  | { action: "create_capa"; titleTemplate: string; severity?: "low"|"medium"|"high"|"critical"; dueInDays?: number }
  | { action: "create_incident"; titleTemplate: string }
  | { action: "notify_role"; role: string; message: string }
  | { action: "flag_non_compliant"; reason?: string }

Rules:
- Exactly one trigger node, connected onward by edges.
- Condition nodes branch with sourceHandle "then"/"else"; gate nodes branch with "approve"/"reject"; otherwise use "next".
- For on_field_value triggers and condition rules, "field" must reference one of the form's field ids: {{FIELD_IDS}}.
- bodyTemplate / titleTemplate may interpolate {{field_id}} tokens.
- Output ONLY the JSON object.`

export async function generateFlowFromPrompt(
  config: AiConfig | null | undefined,
  prompt: string,
  fieldIds: string[],
): Promise<GenResult<AutomationGraph>> {
  const system = FLOW_SYSTEM.replace(
    '{{FIELD_IDS}}',
    fieldIds.length ? fieldIds.join(', ') : '(none yet)',
  )
  const fieldIdSet = new Set(fieldIds)
  let lastErr = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const userPrompt =
      attempt === 0
        ? `Build a Flow for: ${prompt}`
        : `Build a Flow for: ${prompt}\n\nYour previous JSON was invalid (${lastErr}). Return corrected JSON only.`
    const text = await runBuilderPrompt(config, { system, prompt: userPrompt, tier: 'smart' })
    if (!text)
      return {
        ok: false,
        error: 'AI is not configured for this workspace, or the model did not respond.',
      }
    let json: unknown
    try {
      json = extractJson(text)
    } catch {
      lastErr = 'response was not valid JSON'
      continue
    }
    const parsed = automationGraphSchema.safeParse(json)
    if (parsed.success) {
      return {
        ok: true,
        value: parsed.data,
        warnings: lintAutomationGraph(parsed.data, fieldIdSet),
      }
    }
    lastErr = zodIssues(parsed.error)
  }
  return { ok: false, error: `The AI returned an invalid flow: ${lastErr}` }
}
