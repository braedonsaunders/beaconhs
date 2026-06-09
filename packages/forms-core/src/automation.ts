// Form "Flows" — the unified visual automation graph attached to a template.
//
// One graph per template (stored in the form_automations table). It is the
// single canvas that models BOTH:
//   • system automations (fire-and-forget Actions: email, CAPA, webhook, …)
//   • human sign-off (Gate nodes that PAUSE the flow until a person
//     approves/rejects — reusing the form_response_steps machinery).
//
// Authored in the browser with React Flow (@xyflow/react) and serialized via
// `toObject()`; executed SERVER-SIDE only (RLS-bound, auditable) by the engine.
//
// Conditions + on_field_value triggers reuse the same `LogicRule` AST as
// show-if / formulas / hard-fail rules, so there is one condition language and
// one LogicBuilder UI everywhere. `set_field` reuses `DefaultValueExpression`.

import { z } from 'zod'
import {
  defaultValueExpressionSchema,
  logicRuleSchema,
  type DefaultValueExpression,
  type LogicRule,
} from './schema'
import { evaluateLogicRule, type EvalContext } from './evaluator'

// --- Targets (who / where) --------------------------------------------------

export const emailTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('literal'), email: z.string() }),
  z.object({ type: z.literal('role'), role: z.string() }),
  z.object({ type: z.literal('field'), field: z.string() }), // field holding an email / person id
  z.object({ type: z.literal('submitter') }),
])
export type EmailTarget = z.infer<typeof emailTargetSchema>

export const assigneeTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('role'), role: z.string() }),
  z.object({ type: z.literal('field'), field: z.string() }),
  z.object({ type: z.literal('literal'), userId: z.string() }),
  z.object({ type: z.literal('submitter') }),
])
export type AssigneeTarget = z.infer<typeof assigneeTargetSchema>

// --- Triggers (entry points) ------------------------------------------------

export const triggerDataSchema = z.discriminatedUnion('trigger', [
  z.object({ trigger: z.literal('on_submit') }),
  z.object({ trigger: z.literal('on_field_value'), rule: logicRuleSchema }),
  z.object({ trigger: z.literal('status_change'), from: z.string().optional(), to: z.string() }),
  z.object({ trigger: z.literal('scheduled'), cron: z.string(), tz: z.string().optional() }),
])
export type TriggerData = z.infer<typeof triggerDataSchema>

// --- Actions (system side-effects; sinks or chain) --------------------------

export const actionDataSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('send_email'),
    to: z.array(emailTargetSchema),
    subject: z.string(),
    bodyTemplate: z.string(), // supports {{fieldKey}} interpolation
    attachPdf: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('create_capa'),
    titleTemplate: z.string(),
    descriptionTemplate: z.string().optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    dueInDays: z.number().int().optional(),
    assignee: assigneeTargetSchema.optional(),
  }),
  z.object({
    action: z.literal('create_incident'),
    titleTemplate: z.string(),
    incidentType: z.string().optional(),
    severity: z.string().optional(),
  }),
  z.object({
    action: z.literal('notify_role'),
    role: z.string(),
    message: z.string(),
    channel: z.enum(['in_app', 'email']).optional(),
  }),
  z.object({
    action: z.literal('set_field'),
    field: z.string(),
    value: defaultValueExpressionSchema, // reuse the default-value evaluator
  }),
  z.object({ action: z.literal('flag_non_compliant'), reason: z.string().optional() }),
  z.object({
    action: z.literal('webhook'),
    url: z.string(),
    method: z.enum(['POST', 'PUT']).default('POST'),
    headers: z.record(z.string(), z.string()).optional(),
    bodyTemplate: z.string().optional(),
    secretRef: z.string().optional(),
  }),
  z.object({
    action: z.literal('create_response'),
    templateId: z.string(),
    prefill: z.record(z.string(), defaultValueExpressionSchema).optional(),
    assignee: assigneeTargetSchema.optional(),
  }),
  z.object({
    action: z.literal('analyze_photos'),
    // Photo field to analyse (photo / photo_upload / photo_ai).
    fieldId: z.string(),
    // Optional: write the AI summary into this text field on the response.
    storeInField: z.string().optional(),
    // Optional: spawn a CAPA when hazards at/above `minSeverity` are found.
    createCapaOnHazard: z.boolean().optional(),
    minSeverity: z.enum(['low', 'medium', 'high']).optional(),
  }),
])
export type ActionData = z.infer<typeof actionDataSchema>

// --- Gate (human approve / reject — PAUSES the flow) ------------------------

export const gateDataSchema = z.object({
  title: z.string(),
  assignee: assigneeTargetSchema,
  signatureRequired: z.boolean().optional(),
})
export type GateData = z.infer<typeof gateDataSchema>

// --- Nodes (discriminated by data.kind) -------------------------------------

export const automationNodeSchema = z.object({
  id: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('trigger'), trigger: triggerDataSchema }),
    z.object({ kind: z.literal('condition'), rule: logicRuleSchema, label: z.string().optional() }),
    z.object({ kind: z.literal('action'), action: actionDataSchema, label: z.string().optional() }),
    z.object({ kind: z.literal('gate'), gate: gateDataSchema }),
  ]),
})
export type AutomationNode = z.infer<typeof automationNodeSchema>

// Edge branch selector lives on the source handle:
//   condition → 'then' | 'else'
//   gate      → 'approve' | 'reject'
//   otherwise → 'next' (default)
export const automationEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.enum(['next', 'then', 'else', 'approve', 'reject']).optional(),
})
export type AutomationEdge = z.infer<typeof automationEdgeSchema>

export const automationGraphSchema = z.object({
  schemaVersion: z.literal(1),
  nodes: z.array(automationNodeSchema),
  edges: z.array(automationEdgeSchema),
})
export type AutomationGraph = z.infer<typeof automationGraphSchema>

export function emptyAutomationGraph(): AutomationGraph {
  return { schemaVersion: 1, nodes: [], edges: [] }
}

// --- Static lint (best-effort; surfaced in the builder) ---------------------

export function lintAutomationGraph(graph: AutomationGraph, fieldIds: Set<string>): string[] {
  const errors: string[] = []
  const ids = new Set(graph.nodes.map((n) => n.id))

  for (const e of graph.edges) {
    if (!ids.has(e.source)) errors.push(`Edge ${e.id}: unknown source node`)
    if (!ids.has(e.target)) errors.push(`Edge ${e.id}: unknown target node`)
  }
  if (!graph.nodes.some((n) => n.data.kind === 'trigger')) {
    errors.push('Flow has no trigger — add a trigger node to start it.')
  }

  const walkRuleFields = (rule: LogicRule, where: string) => {
    if ('rules' in rule) rule.rules.forEach((r) => walkRuleFields(r, where))
    else if ('rule' in rule) walkRuleFields(rule.rule, where)
    else if ('field' in rule && !fieldIds.has(rule.field)) {
      errors.push(`${where}: references unknown field "${rule.field}"`)
    }
  }
  for (const n of graph.nodes) {
    if (n.data.kind === 'condition') walkRuleFields(n.data.rule, `Condition ${n.id}`)
    if (n.data.kind === 'trigger' && n.data.trigger.trigger === 'on_field_value') {
      walkRuleFields(n.data.trigger.rule, `Trigger ${n.id}`)
    }
    if (
      n.data.kind === 'action' &&
      n.data.action.action === 'set_field' &&
      !fieldIds.has(n.data.action.field)
    ) {
      errors.push(`Action ${n.id}: set_field targets unknown field "${n.data.action.field}"`)
    }
  }
  return errors
}

// --- Engine: plan which actions/gates fire for a trigger -------------------

// A reached gate carries its node id so the runtime can persist an approval
// step keyed back to the exact node and RESUME the correct branch on a human
// decision.
export type PlannedGate = { nodeId: string; gate: GateData }
export type AutomationPlan = { actions: ActionData[]; gates: PlannedGate[] }

// Shared traversal: from each start node, collect ordered Actions and pause at
// Gates. Conditions branch then/else; gates pause (their approve/reject branch
// is resumed later via `planFromGate`).
function collect(
  graph: AutomationGraph,
  evalCtx: EvalContext,
  startIds: string[],
): AutomationPlan {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const out = (id: string) => graph.edges.filter((e) => e.source === id)
  const actions: ActionData[] = []
  const gates: PlannedGate[] = []
  const seen = new Set<string>()

  const walk = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const node = byId.get(id)
    if (!node) return
    const d = node.data
    if (d.kind === 'action') {
      actions.push(d.action)
      for (const e of out(id)) walk(e.target)
      return
    }
    if (d.kind === 'gate') {
      gates.push({ nodeId: id, gate: d.gate })
      return // pause — approve/reject branch resumes on human action
    }
    if (d.kind === 'condition') {
      const pass = evaluateLogicRule(d.rule, evalCtx)
      for (const e of out(id)) {
        const h = e.sourceHandle ?? 'then'
        if ((pass && (h === 'then' || h === 'next')) || (!pass && h === 'else')) walk(e.target)
      }
      return
    }
    // trigger node → follow onward
    for (const e of out(id)) walk(e.target)
  }
  for (const id of startIds) walk(id)
  return { actions, gates }
}

/**
 * Plan the Actions + Gates reached from the trigger matching `trigger`. Pure:
 * the caller performs the side effects server-side.
 */
export function planAutomation(
  graph: AutomationGraph,
  trigger: TriggerData['trigger'],
  evalCtx: EvalContext,
): AutomationPlan {
  const triggerNode = graph.nodes.find(
    (n) => n.data.kind === 'trigger' && n.data.trigger.trigger === trigger,
  )
  if (!triggerNode || triggerNode.data.kind !== 'trigger') return { actions: [], gates: [] }
  const td = triggerNode.data.trigger
  if (td.trigger === 'on_field_value' && !evaluateLogicRule(td.rule, evalCtx)) {
    return { actions: [], gates: [] }
  }
  return collect(graph, evalCtx, [triggerNode.id])
}

/**
 * Resume a paused flow from a Gate's `approve` / `reject` branch after a human
 * decision. Returns the downstream Actions + any further Gates.
 */
export function planFromGate(
  graph: AutomationGraph,
  gateNodeId: string,
  branch: 'approve' | 'reject',
  evalCtx: EvalContext,
): AutomationPlan {
  const targets = graph.edges
    .filter((e) => e.source === gateNodeId && (e.sourceHandle ?? 'approve') === branch)
    .map((e) => e.target)
  return collect(graph, evalCtx, targets)
}

// Re-export the reused condition/value types so flow consumers import from one
// module.
export type { DefaultValueExpression, LogicRule }
