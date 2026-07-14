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
import type { FlowSubjectProfile } from './flow-subjects'

// --- Targets (who / where) --------------------------------------------------

export const emailTargetSchema = z.discriminatedUnion('type', [
  // `email` may hold ONE address or a comma/semicolon/space-separated list.
  z.object({ type: z.literal('literal'), email: z.string() }),
  z.object({ type: z.literal('role'), role: z.string() }), // everyone in a role
  z.object({ type: z.literal('field'), field: z.string() }), // field holding an email / person id
  z.object({ type: z.literal('submitter') }), // the user who submitted/owns the record
  z.object({ type: z.literal('person'), personId: z.string() }), // a specific person
  z.object({ type: z.literal('submitter_manager') }), // the submitter's reporting manager
  // every reporting manager of the chosen department's people
  z.object({ type: z.literal('department_manager'), departmentId: z.string() }),
  // a reusable, composable notification group (/admin/notifications → Groups)
  z.object({ type: z.literal('group'), groupId: z.string() }),
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
  // Fires when a monitored session misses a check-in past its grace period.
  // Dispatched by the overdue scan (apps/worker) via planAutomation(..., 'session_overdue').
  z.object({ trigger: z.literal('session_overdue') }),
  // Generic native-module lifecycle triggers. Modules without a status enum
  // (journals, hazard assessments) map their lifecycle moments onto these; the
  // engine dispatches them by literal exactly like on_submit. A subject's
  // FlowSubjectProfile decides which of these are offered in the canvas.
  z.object({ trigger: z.literal('on_create') }),
  z.object({ trigger: z.literal('on_sign') }),
  z.object({ trigger: z.literal('on_lock') }),
  z.object({ trigger: z.literal('on_unlock') }),
  z.object({ trigger: z.literal('on_delete') }),
  // A user-clickable button rendered on a record that runs THIS flow on demand
  // (vs. firing automatically on a lifecycle event). Multiple manual triggers
  // can coexist on one graph — each is a distinct button keyed by `buttonId`,
  // and `planAutomation(graph, 'manual', ctx, { buttonId })` plans just that
  // button's branch. `inputs` collects ad-hoc values from the user at click
  // time; `showIf` / `requirePermission` gate the button's visibility/use.
  z.object({
    trigger: z.literal('manual'),
    buttonId: z.string(),
    label: z.string(),
    icon: z.string().optional(),
    variant: z.enum(['default', 'outline', 'destructive', 'secondary']).optional(),
    confirm: z.string().optional(),
    showIf: logicRuleSchema.optional(),
    requirePermission: z.string().optional(),
    inputs: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          type: z.enum(['text', 'textarea', 'number', 'date', 'select', 'person']),
          required: z.boolean().optional(),
          options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
        }),
      )
      .optional(),
    order: z.number().int().optional(),
  }),
])
export type TriggerData = z.infer<typeof triggerDataSchema>

// --- Actions (system side-effects; sinks or chain) --------------------------

export const actionDataSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('send_email'),
    to: z.array(emailTargetSchema),
    // Delivery channel. Absent ⇒ 'email' (back-compat). 'sms' texts the resolved
    // recipients' phones (critical-style, truncated); 'in_app' posts an inbox
    // notification. Each is gated at send-time by whether that transport is set
    // up for the tenant.
    channel: z.enum(['email', 'sms', 'in_app']).optional(),
    // How the body is composed. Absent ⇒ legacy 'inline' (back-compat: every
    // stored graph still validates because subject/bodyTemplate stay optional).
    mode: z.enum(['inline', 'template', 'design']).optional(),
    // mode 'inline' — write the email here.
    subject: z.string().optional(),
    bodyTemplate: z.string().optional(), // supports {{fieldKey}} interpolation
    // mode 'template' — reference a library template (resolved at SEND time so
    // edits to the template propagate to every flow that uses it).
    templateId: z.string().optional(),
    subjectOverride: z.string().optional(),
    // mode 'design' — sanitized editable HTML is the single authoring source;
    // compiledHtml is the delivery artifact. GrapesJS project JSON is not stored
    // because it can retain unsafe/obsolete component state outside that source.
    sourceHtml: z.string().max(512_000).optional(),
    compiledHtml: z.string().optional(),
    subjectTemplate: z.string().optional(),
    // Attach a PDF of the record. `pdfTemplateId` pins a specific tenant PDF
    // DOCUMENT template (paper-size builder, /admin/pdf-templates). Otherwise
    // the record's assigned default template is used, falling back to the
    // generic field-summary table. pdfFormat 'summary' forces the field
    // summary; 'full' is accepted for stored plans and behaves like absent
    // (the assigned template with summary fallback).
    attachPdf: z.boolean().optional(),
    pdfTemplateId: z.string().optional(),
    pdfFormat: z.enum(['full', 'summary']).optional(),
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
    channel: z.enum(['in_app', 'email', 'sms']).optional(),
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
  }),
  z.object({
    action: z.literal('create_response'),
    templateId: z.string(),
    prefill: z.record(z.string(), defaultValueExpressionSchema).optional(),
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
  // Turn the submitted response into a LIVE monitored session: a recurring
  // check-in timer that escalates (via the `session_overdue` trigger) if a
  // check-in is missed past the grace period. Pair it with an `on_submit`
  // trigger. Interval/grace/duration can be fixed or bound to a submitted
  // number field.
  z.object({
    action: z.literal('start_monitored_session'),
    intervalMinutes: z.number().int().positive(),
    graceMinutes: z.number().int().nonnegative(),
    durationMinutes: z.number().int().nonnegative().optional(),
    requireGeo: z.boolean().optional(),
    intervalFieldKey: z.string().optional(),
    graceFieldKey: z.string().optional(),
    durationFieldKey: z.string().optional(),
  }),
  // Move the record to a new status. `lock` additionally locks the record
  // (read-only) once moved. Pair with a `manual` button or a lifecycle trigger.
  z.object({ action: z.literal('change_status'), to: z.string(), lock: z.boolean().optional() }),
  // Clone the current record into a fresh draft.
  z.object({ action: z.literal('duplicate_record') }),
  // Render a PDF of the record: the record's assigned PDF document template,
  // falling back to the generic field-summary table.
  z.object({ action: z.literal('export_pdf'), pdfFormat: z.enum(['full', 'summary']).optional() }),
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

export function lintAutomationGraph(
  graph: AutomationGraph,
  fieldIds: Set<string>,
  profile?: FlowSubjectProfile,
): string[] {
  const errors: string[] = []
  const ids = new Set(graph.nodes.map((n) => n.id))

  for (const e of graph.edges) {
    if (!ids.has(e.source)) errors.push(`Edge ${e.id}: unknown source node`)
    if (!ids.has(e.target)) errors.push(`Edge ${e.id}: unknown target node`)
  }
  if (!graph.nodes.some((n) => n.data.kind === 'trigger')) {
    errors.push('Flow has no trigger — add a trigger node to start it.')
  }

  // When a subject profile is supplied, reject triggers/actions the subject does
  // not support (e.g. a journal flow using `start_monitored_session`).
  if (profile) {
    const okTriggers = new Set<string>(profile.triggers)
    const okActions = new Set<string>(profile.actions)
    const okStatuses = new Set(profile.statusValues ?? [])
    for (const n of graph.nodes) {
      if (n.data.kind === 'trigger' && !okTriggers.has(n.data.trigger.trigger)) {
        errors.push(
          `Trigger ${n.id}: "${n.data.trigger.trigger}" is not available for ${profile.label}.`,
        )
      }
      if (n.data.kind === 'trigger' && n.data.trigger.trigger === 'status_change') {
        if (!okStatuses.has(n.data.trigger.to)) {
          errors.push(`Trigger ${n.id}: unknown destination status "${n.data.trigger.to}".`)
        }
        if (n.data.trigger.from && !okStatuses.has(n.data.trigger.from)) {
          errors.push(`Trigger ${n.id}: unknown source status "${n.data.trigger.from}".`)
        }
      }
      if (n.data.kind === 'action' && !okActions.has(n.data.action.action)) {
        errors.push(
          `Action ${n.id}: "${n.data.action.action}" is not available for ${profile.label}.`,
        )
      }
      if (
        n.data.kind === 'action' &&
        n.data.action.action === 'change_status' &&
        !okStatuses.has(n.data.action.to)
      ) {
        errors.push(`Action ${n.id}: unknown destination status "${n.data.action.to}".`)
      }
    }
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
  errors.push(...lintWorkerTriggerCompatibility(graph))
  return errors
}

const WORKER_ONLY_TRIGGERS = new Set<TriggerData['trigger']>(['scheduled', 'session_overdue'])
const WORKER_TRIGGER_ACTIONS = new Set<ActionData['action']>(['send_email', 'notify_role'])

/**
 * Scheduled and session-overdue triggers execute in the worker, not in a web
 * request. The worker only has a narrow, side-effect-safe executor; reject
 * branches that would otherwise save successfully and then silently no-op.
 */
export function lintWorkerTriggerCompatibility(graph: AutomationGraph): string[] {
  const errors: string[] = []
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const outbound = (id: string) => graph.edges.filter((e) => e.source === id)

  for (const trigger of graph.nodes) {
    if (
      trigger.data.kind !== 'trigger' ||
      !WORKER_ONLY_TRIGGERS.has(trigger.data.trigger.trigger)
    ) {
      continue
    }
    const triggerName = trigger.data.trigger.trigger
    const seen = new Set<string>()
    const walk = (nodeId: string) => {
      if (seen.has(nodeId)) return
      seen.add(nodeId)
      const node = byId.get(nodeId)
      if (!node) return
      if (node.id !== trigger.id && node.data.kind === 'trigger') return

      if (node.data.kind === 'gate') {
        errors.push(
          `Trigger ${trigger.id}: "${triggerName}" runs in the worker and cannot pause for approval gates.`,
        )
        return
      }

      if (node.data.kind === 'action') {
        const action = node.data.action
        if (!WORKER_TRIGGER_ACTIONS.has(action.action)) {
          errors.push(
            `Trigger ${trigger.id}: "${triggerName}" runs in the worker and cannot execute "${action.action}".`,
          )
        } else if (
          action.action === 'send_email' &&
          ((action.mode ?? 'inline') !== 'inline' ||
            action.attachPdf ||
            action.templateId ||
            action.pdfTemplateId ||
            action.sourceHtml ||
            action.compiledHtml)
        ) {
          errors.push(
            `Trigger ${trigger.id}: "${triggerName}" can only send inline worker emails without PDF attachments.`,
          )
        }
      }

      for (const edge of outbound(nodeId)) walk(edge.target)
    }

    for (const edge of outbound(trigger.id)) walk(edge.target)
  }

  return Array.from(new Set(errors))
}

// --- Engine: plan which actions/gates fire for a trigger -------------------

// A reached gate carries its node id so the runtime can persist an approval
// step keyed back to the exact node and RESUME the correct branch on a human
// decision.
export type PlannedGate = { nodeId: string; gate: GateData }
export type PlannedAction = { nodeId: string; action: ActionData }
export type AutomationPlan = {
  actions: ActionData[]
  actionNodes: PlannedAction[]
  gates: PlannedGate[]
}

// Shared traversal: from each start node, collect ordered Actions and pause at
// Gates. Conditions branch then/else; gates pause (their approve/reject branch
// is resumed later via `planFromGate`).
function collect(graph: AutomationGraph, evalCtx: EvalContext, startIds: string[]): AutomationPlan {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const out = (id: string) => graph.edges.filter((e) => e.source === id)
  const actions: ActionData[] = []
  const actionNodes: PlannedAction[] = []
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
      actionNodes.push({ nodeId: id, action: d.action })
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
  return { actions, actionNodes, gates }
}

/**
 * Plan the Actions + Gates reached from EVERY trigger node matching `trigger`.
 * Pure: the caller performs the side effects server-side.
 *
 * A graph may legitimately carry several triggers of the same type (multiple
 * manual buttons, several `on_field_value` branches with different rules, or
 * distinct `status_change` transitions). Each satisfied trigger contributes its
 * downstream branch; the branches are collected together so a shared `seen` set
 * dedupes any actions two triggers converge on. Planning only the first
 * matching node would silently drop the rest.
 *
 * Trigger-specific selection:
 *   • `manual` — when `opts.buttonId` is supplied, plan just that button;
 *     otherwise plan every manual button (rare, but well-defined).
 *   • `on_field_value` — a node fires only when its own rule passes.
 *   • `status_change` — when `opts.toStatus` is supplied the engine enforces
 *     the node's `to` (and optional `from`) filter so a `from: X → to: Y`
 *     transition does not fire on `Z → Y`. When `opts.toStatus` is absent the
 *     match is by trigger name only (the caller is expected to have already
 *     narrowed by target status).
 */
export function planAutomation(
  graph: AutomationGraph,
  trigger: TriggerData['trigger'],
  evalCtx: EvalContext,
  opts?: {
    buttonId?: string
    fromStatus?: string | null
    toStatus?: string
    /** Restrict same-kind planning to these exact trigger node ids. */
    triggerNodeIds?: string[]
  },
): AutomationPlan {
  const startIds: string[] = []
  for (const node of graph.nodes) {
    if (node.data.kind !== 'trigger' || node.data.trigger.trigger !== trigger) continue
    if (opts?.triggerNodeIds && !opts.triggerNodeIds.includes(node.id)) continue
    const td = node.data.trigger

    if (td.trigger === 'manual' && opts?.buttonId !== undefined) {
      if (td.buttonId !== opts.buttonId) continue
    }
    if (td.trigger === 'on_field_value' && !evaluateLogicRule(td.rule, evalCtx)) continue
    if (td.trigger === 'status_change' && opts?.toStatus !== undefined) {
      if (td.to !== opts.toStatus) continue
      if (td.from && td.from !== (opts.fromStatus ?? undefined)) continue
    }

    startIds.push(node.id)
  }
  if (startIds.length === 0) return { actions: [], actionNodes: [], gates: [] }
  return collect(graph, evalCtx, startIds)
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
