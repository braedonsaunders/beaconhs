'use client'

// Flows canvas — the n8n-style visual automation builder for an App.
// Node graph: Trigger → Condition / Gate / Action. Conditions branch then/else;
// Gates (human approve/reject) branch approve/reject. Persists the graph to
// form_automations. Nodes are real React components, so the Condition inspector
// reuses the existing LogicBuilder. Authoring only — execution is server-side.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { Editor } from 'grapesjs'
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ArrowLeft,
  GitBranch,
  Mail,
  Pencil,
  Plus,
  Rocket,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Workflow,
  X,
  Zap,
} from 'lucide-react'
import { Button, Drawer, Input, Label, Select, SearchSelect, Textarea } from '@beaconhs/ui'
import type {
  ActionData,
  AutomationGraph,
  AutomationNode,
  EmailTarget,
  FlowSubjectProfile,
  TriggerData,
} from '@beaconhs/forms-core'
import { emptyAutomationGraph } from '@beaconhs/forms-core'
import { LogicBuilder } from '../designer/logic-builder'
import { toast } from '@/lib/toast'
import {
  createFlow,
  deleteFlow,
  renameFlow,
  saveFlow,
  setFlowEnabled,
  type FlowSubjectRef,
} from '@/lib/flows/flow-crud'
import { generateFlowDraft } from '../../../_ai-actions'
import { compileEmailDesign } from '@/lib/flows/email-design-actions'

export type EmailTemplateOption = { id: string; name: string }
export type PdfTemplateOption = { id: string; name: string }

// Pickable people / roles / departments for the send_email recipient editor.
export type RecipientOptions = {
  people: { id: string; name: string }[]
  roles: { key: string; name: string }[]
  departments: { id: string; name: string }[]
}
const EMPTY_RECIPIENT_OPTIONS: RecipientOptions = { people: [], roles: [], departments: [] }

const RECIPIENT_LABEL: Record<EmailTarget['type'], string> = {
  submitter: 'The submitter',
  submitter_manager: "The submitter's manager",
  person: 'A specific person',
  role: 'Everyone in a role',
  department_manager: "A department's managers",
  literal: 'Specific email address(es)',
  field: 'A record field',
}

function defaultTarget(type: EmailTarget['type'], firstField: string): EmailTarget {
  switch (type) {
    case 'role':
      return { type: 'role', role: '' }
    case 'literal':
      return { type: 'literal', email: '' }
    case 'person':
      return { type: 'person', personId: '' }
    case 'department_manager':
      return { type: 'department_manager', departmentId: '' }
    case 'field':
      return { type: 'field', field: firstField }
    case 'submitter_manager':
      return { type: 'submitter_manager' }
    default:
      return { type: 'submitter' }
  }
}

// Multi-recipient editor: any mix of submitter / person / manager / role /
// department managers / CSV emails / record field. Add + remove rows freely.
function RecipientsEditor({
  to,
  onChange,
  readOnly,
  fieldIds,
  options,
}: {
  to: EmailTarget[]
  onChange: (to: EmailTarget[]) => void
  readOnly: boolean
  fieldIds: string[]
  options: RecipientOptions
}) {
  const rows = to.length > 0 ? to : [{ type: 'submitter' } as EmailTarget]
  const update = (i: number, t: EmailTarget) => onChange(rows.map((x, j) => (j === i ? t : x)))
  const peopleOpts = options.people.map((p) => ({ value: p.id, label: p.name }))
  const deptOpts = options.departments.map((d) => ({ value: d.id, label: d.name }))
  return (
    <Field label="Recipients">
      <div className="space-y-2">
        {rows.map((t, i) => (
          <div
            key={i}
            className="space-y-1.5 rounded-md border border-slate-200 p-2 dark:border-slate-700"
          >
            <div className="flex items-center gap-1.5">
              <Select
                value={t.type}
                disabled={readOnly}
                onChange={(e) =>
                  update(i, defaultTarget(e.target.value as EmailTarget['type'], fieldIds[0] ?? ''))
                }
              >
                {(Object.keys(RECIPIENT_LABEL) as EmailTarget['type'][]).map((k) => (
                  <option key={k} value={k}>
                    {RECIPIENT_LABEL[k]}
                  </option>
                ))}
              </Select>
              {!readOnly && rows.length > 1 ? (
                <button
                  type="button"
                  title="Remove recipient"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  className="shrink-0 rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
            {t.type === 'person' ? (
              <SearchSelect
                value={t.personId}
                disabled={readOnly}
                options={peopleOpts}
                placeholder="Choose a person"
                onChange={(v) => update(i, { type: 'person', personId: v })}
              />
            ) : null}
            {t.type === 'department_manager' ? (
              <SearchSelect
                value={t.departmentId}
                disabled={readOnly}
                options={deptOpts}
                placeholder="Choose a department"
                onChange={(v) => update(i, { type: 'department_manager', departmentId: v })}
              />
            ) : null}
            {t.type === 'role' ? (
              options.roles.length > 0 ? (
                <Select
                  value={t.role}
                  disabled={readOnly}
                  onChange={(e) => update(i, { type: 'role', role: e.target.value })}
                >
                  <option value="">— choose a role —</option>
                  {options.roles.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={t.role}
                  disabled={readOnly}
                  placeholder="role key"
                  onChange={(e) => update(i, { type: 'role', role: e.target.value })}
                />
              )
            ) : null}
            {t.type === 'literal' ? (
              <Input
                value={t.email}
                disabled={readOnly}
                placeholder="a@x.com, b@y.com"
                onChange={(e) => update(i, { type: 'literal', email: e.target.value })}
              />
            ) : null}
            {t.type === 'field' ? (
              <Select
                value={t.field}
                disabled={readOnly}
                onChange={(e) => update(i, { type: 'field', field: e.target.value })}
              >
                {fieldIds.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
        ))}
        {!readOnly ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange([...rows, { type: 'submitter' }])}
          >
            <Plus size={13} /> Add recipient
          </Button>
        ) : null}
      </div>
    </Field>
  )
}

// The drag-and-drop email builder, reused for the send_email "design" (one-off)
// mode. Client-only (GrapesJS touches window) → dynamic, ssr:false.
const EmailDesignBuilder = dynamic(
  () => import('@/app/(app)/admin/email-templates/_builder.client'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Loading editor…
      </div>
    ),
  },
)

export type FlowSummary = { id: string; name: string; enabled: boolean; graph: AutomationGraph }
type FlowMeta = { id: string; name: string; enabled: boolean }

type NData = AutomationNode['data']
type FlowNode = Node<NData>

let _seq = 0
const newId = (p: string) => `${p}_${(_seq += 1)}_${Math.random().toString(36).slice(2, 6)}`

function toFlow(graph: AutomationGraph): { nodes: FlowNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: n.data.kind,
      position: n.position,
      data: n.data,
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      label: e.sourceHandle && e.sourceHandle !== 'next' ? e.sourceHandle : undefined,
    })),
  }
}

function fromFlow(nodes: FlowNode[], edges: Edge[]): AutomationGraph {
  return {
    schemaVersion: 1,
    nodes: nodes.map((n) => ({
      id: n.id,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      data: n.data,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: (e.sourceHandle as AutomationGraph['edges'][number]['sourceHandle']) ?? 'next',
    })),
  }
}

// --- Node summaries + components -------------------------------------------

function triggerSummary(t: TriggerData): string {
  switch (t.trigger) {
    case 'on_submit':
      return 'On submit'
    case 'on_field_value':
      return 'When a field matches…'
    case 'status_change':
      return `Status → ${t.to}`
    case 'scheduled':
      return `Scheduled (${t.cron})`
    case 'session_overdue':
      return 'Session check-in overdue'
    case 'on_create':
      return 'On create'
    case 'on_sign':
      return 'On sign'
    case 'on_lock':
      return 'On lock / close'
    case 'on_unlock':
      return 'On unlock / reopen'
    case 'on_delete':
      return 'On delete'
    case 'manual':
      return `Button: ${t.label || 'Run flow'}`
  }
}

const ACTION_LABEL: Record<ActionData['action'], string> = {
  send_email: 'Send email',
  create_capa: 'Create CAPA',
  create_incident: 'Create incident',
  notify_role: 'Notify role',
  set_field: 'Set field',
  flag_non_compliant: 'Flag non-compliant',
  webhook: 'Webhook',
  create_response: 'Start another form',
  analyze_photos: 'Analyze photos (AI)',
  start_monitored_session: 'Start monitored session',
  change_status: 'Change status',
  duplicate_record: 'Duplicate record',
  export_pdf: 'Export PDF',
}

const TRIGGER_LABEL: Record<TriggerData['trigger'], string> = {
  on_submit: 'A record is submitted',
  on_field_value: 'A field matches a condition',
  status_change: 'Status changes',
  scheduled: 'On a schedule',
  session_overdue: 'A monitored session goes overdue',
  on_create: 'A record is created',
  on_sign: 'A record is signed',
  on_lock: 'A record is locked / closed',
  on_unlock: 'A record is unlocked / reopened',
  on_delete: 'A record is deleted',
  manual: 'A user clicks a button',
}

// Build a fresh TriggerData from a trigger kind (used by the picker + defaults).
function buildTrigger(
  v: TriggerData['trigger'],
  firstField: string,
  firstStatus: string,
): TriggerData {
  if (v === 'on_field_value')
    return { trigger: 'on_field_value', rule: { op: 'isSet', field: firstField } }
  if (v === 'status_change') return { trigger: 'status_change', to: firstStatus }
  if (v === 'scheduled') return { trigger: 'scheduled', cron: '0 8 * * 1' }
  if (v === 'manual')
    return {
      trigger: 'manual',
      buttonId: `btn_${Math.random().toString(36).slice(2, 10)}`,
      label: 'Run flow',
    }
  return { trigger: v } as TriggerData
}

const CARD = 'rounded-lg border bg-white px-3 py-2 text-xs shadow-sm w-48 dark:bg-slate-900'
const HANDLE = { width: 9, height: 9 }

function TriggerNode({ data, selected }: NodeProps) {
  const d = data as Extract<NData, { kind: 'trigger' }>
  return (
    <div
      className={`${CARD} ${selected ? 'border-teal-500 ring-1 ring-teal-500' : 'border-emerald-300 dark:border-emerald-700'}`}
    >
      <div className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
        <Zap size={13} /> Trigger
      </div>
      <div className="mt-0.5 truncate text-slate-600 dark:text-slate-400">
        {triggerSummary(d.trigger)}
      </div>
      <Handle type="source" position={Position.Right} id="next" style={HANDLE} />
    </div>
  )
}

function ConditionNode({ data, selected }: NodeProps) {
  const d = data as Extract<NData, { kind: 'condition' }>
  return (
    <div
      className={`${CARD} ${selected ? 'border-teal-500 ring-1 ring-teal-500' : 'border-amber-300 dark:border-amber-700'}`}
    >
      <Handle type="target" position={Position.Left} style={HANDLE} />
      <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
        <GitBranch size={13} /> Condition
      </div>
      <div className="mt-0.5 truncate text-slate-600 dark:text-slate-400">{d.label || 'If…'}</div>
      <Handle type="source" position={Position.Right} id="then" style={{ ...HANDLE, top: '38%' }} />
      <Handle type="source" position={Position.Right} id="else" style={{ ...HANDLE, top: '70%' }} />
    </div>
  )
}

function GateNode({ data, selected }: NodeProps) {
  const d = data as Extract<NData, { kind: 'gate' }>
  return (
    <div
      className={`${CARD} ${selected ? 'border-teal-500 ring-1 ring-teal-500' : 'border-violet-300 dark:border-violet-700'}`}
    >
      <Handle type="target" position={Position.Left} style={HANDLE} />
      <div className="flex items-center gap-1.5 font-semibold text-violet-700 dark:text-violet-400">
        <ShieldCheck size={13} /> Approval
      </div>
      <div className="mt-0.5 truncate text-slate-600 dark:text-slate-400">
        {d.gate.title || 'Approve / reject'}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="approve"
        style={{ ...HANDLE, top: '38%' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="reject"
        style={{ ...HANDLE, top: '70%' }}
      />
    </div>
  )
}

function ActionNode({ data, selected }: NodeProps) {
  const d = data as Extract<NData, { kind: 'action' }>
  return (
    <div
      className={`${CARD} ${selected ? 'border-teal-500 ring-1 ring-teal-500' : 'border-sky-300 dark:border-sky-700'}`}
    >
      <Handle type="target" position={Position.Left} style={HANDLE} />
      <div className="flex items-center gap-1.5 font-semibold text-sky-700 dark:text-sky-400">
        <Mail size={13} /> Action
      </div>
      <div className="mt-0.5 truncate text-slate-600 dark:text-slate-400">
        {ACTION_LABEL[d.action.action]}
      </div>
      <Handle type="source" position={Position.Right} id="next" style={HANDLE} />
    </div>
  )
}

// --- Default node data ------------------------------------------------------

function defaultData(kind: NData['kind'], firstField: string, profile: FlowSubjectProfile): NData {
  switch (kind) {
    case 'trigger':
      return {
        kind: 'trigger',
        trigger: buildTrigger(
          profile.triggers[0] ?? 'on_submit',
          firstField,
          profile.statusValues?.[0] ?? 'submitted',
        ),
      }
    case 'condition':
      return { kind: 'condition', rule: { op: 'isSet', field: firstField }, label: 'If…' }
    case 'gate':
      return {
        kind: 'gate',
        gate: { title: 'Supervisor approval', assignee: { type: 'submitter' } },
      }
    case 'action':
      return {
        kind: 'action',
        action: defaultAction(profile.actions[0] ?? 'send_email', firstField ? [firstField] : []),
      }
  }
}

// ---------------------------------------------------------------------------

function MiniToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={checked ? 'Enabled — click to disable' : 'Disabled — click to enable'}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition ${
        checked ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-600'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-3.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

// Quick-start flows for common automations. Each builds a ready-to-tweak graph;
// the user fills in blanks (role/url) and hits Save.
type FlowTemplate = {
  key: string
  label: string
  description: string
  build: () => AutomationGraph
}

const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    key: 'email_submitter',
    label: 'Email the submitter',
    description: 'On submit, send a confirmation email to whoever filled it out.',
    build: () => ({
      schemaVersion: 1,
      nodes: [
        {
          id: 'trg',
          position: { x: 60, y: 140 },
          data: { kind: 'trigger', trigger: { trigger: 'on_submit' } },
        },
        {
          id: 'act',
          position: { x: 380, y: 140 },
          data: {
            kind: 'action',
            action: {
              action: 'send_email',
              to: [{ type: 'submitter' }],
              subject: 'Submission received',
              bodyTemplate: 'Thanks — your submission has been received.',
            },
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trg', target: 'act', sourceHandle: 'next' }],
    }),
  },
  {
    key: 'notify_role',
    label: 'Notify a team',
    description: 'On submit, send an in-app notification to a role you choose.',
    build: () => ({
      schemaVersion: 1,
      nodes: [
        {
          id: 'trg',
          position: { x: 60, y: 140 },
          data: { kind: 'trigger', trigger: { trigger: 'on_submit' } },
        },
        {
          id: 'act',
          position: { x: 380, y: 140 },
          data: {
            kind: 'action',
            action: { action: 'notify_role', role: '', message: 'A new submission needs review.' },
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trg', target: 'act', sourceHandle: 'next' }],
    }),
  },
  {
    key: 'capa_noncompliant',
    label: 'CAPA when non-compliant',
    description: 'If the compliance score is below 80, open a corrective action.',
    build: () => ({
      schemaVersion: 1,
      nodes: [
        {
          id: 'trg',
          position: { x: 40, y: 160 },
          data: { kind: 'trigger', trigger: { trigger: 'on_submit' } },
        },
        {
          id: 'cnd',
          position: { x: 320, y: 160 },
          data: {
            kind: 'condition',
            rule: { op: 'lt', field: 'compliance_score', value: 80 },
            label: 'Score below 80',
          },
        },
        {
          id: 'act',
          position: { x: 620, y: 100 },
          data: {
            kind: 'action',
            action: {
              action: 'create_capa',
              titleTemplate: 'Follow-up corrective action',
              severity: 'high',
            },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trg', target: 'cnd', sourceHandle: 'next' },
        { id: 'e2', source: 'cnd', target: 'act', sourceHandle: 'then' },
      ],
    }),
  },
  {
    key: 'approval',
    label: 'Require approval',
    description: 'On submit, pause for a supervisor to approve or reject.',
    build: () => ({
      schemaVersion: 1,
      nodes: [
        {
          id: 'trg',
          position: { x: 60, y: 140 },
          data: { kind: 'trigger', trigger: { trigger: 'on_submit' } },
        },
        {
          id: 'gat',
          position: { x: 380, y: 140 },
          data: {
            kind: 'gate',
            gate: { title: 'Supervisor approval', assignee: { type: 'role', role: '' } },
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trg', target: 'gat', sourceHandle: 'next' }],
    }),
  },
  {
    key: 'webhook',
    label: 'Send to a webhook',
    description: 'On submit, POST the response to an external URL (Zapier, Make, your API).',
    build: () => ({
      schemaVersion: 1,
      nodes: [
        {
          id: 'trg',
          position: { x: 60, y: 140 },
          data: { kind: 'trigger', trigger: { trigger: 'on_submit' } },
        },
        {
          id: 'act',
          position: { x: 380, y: 140 },
          data: { kind: 'action', action: { action: 'webhook', url: '', method: 'POST' } },
        },
      ],
      edges: [{ id: 'e1', source: 'trg', target: 'act', sourceHandle: 'next' }],
    }),
  },
  {
    key: 'monitored_session',
    label: 'Monitored session (lone worker)',
    description:
      'On submit, start a recurring check-in timer; if a check-in is missed past the grace period, notify a role.',
    build: () => ({
      schemaVersion: 1,
      nodes: [
        {
          id: 'trg',
          position: { x: 60, y: 80 },
          data: { kind: 'trigger', trigger: { trigger: 'on_submit' } },
        },
        {
          id: 'mon',
          position: { x: 380, y: 80 },
          data: {
            kind: 'action',
            action: {
              action: 'start_monitored_session',
              intervalMinutes: 30,
              graceMinutes: 10,
              durationMinutes: 120,
              requireGeo: true,
            },
          },
        },
        {
          id: 'ovd',
          position: { x: 60, y: 260 },
          data: { kind: 'trigger', trigger: { trigger: 'session_overdue' } },
        },
        {
          id: 'esc',
          position: { x: 380, y: 260 },
          data: {
            kind: 'action',
            action: {
              action: 'notify_role',
              role: '',
              message: 'A monitored session check-in is overdue — follow up now.',
              channel: 'in_app',
            },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trg', target: 'mon', sourceHandle: 'next' },
        { id: 'e2', source: 'ovd', target: 'esc', sourceHandle: 'next' },
      ],
    }),
  },
]

export function FlowsCanvas({
  profile,
  emailTemplates,
  pdfTemplates = [],
  recipientOptions = EMPTY_RECIPIENT_OPTIONS,
  flows,
  canEdit,
  canGenerate,
  embedded = false,
  backHref,
}: {
  profile: FlowSubjectProfile
  emailTemplates: EmailTemplateOption[]
  pdfTemplates?: PdfTemplateOption[]
  recipientOptions?: RecipientOptions
  flows: FlowSummary[]
  canEdit: boolean
  canGenerate: boolean
  // When rendered inside the unified App editor, hide the standalone back link
  // + the redundant subject-name prefix (the editor header already has it).
  embedded?: boolean
  backHref?: string
}) {
  // Subject-driven: triggers/actions/status/fields all come from the profile, so
  // the same canvas renders for a form template OR a native module.
  const subject: FlowSubjectRef = { type: profile.subjectType, key: profile.subjectKey }
  const subjectLabel = profile.label
  const fieldIds = useMemo(() => profile.fields.map((f) => f.key), [profile])
  // Working graphs live in a ref keyed by flow id; switching flows captures the
  // current canvas into the ref and loads the target's graph. Save persists the
  // selected flow only (n8n-style). The sidebar list holds name/enabled.
  const graphs = useRef<Map<string, AutomationGraph>>(new Map(flows.map((f) => [f.id, f.graph])))
  const [flowList, setFlowList] = useState<FlowMeta[]>(
    flows.map((f) => ({ id: f.id, name: f.name, enabled: f.enabled })),
  )
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(flows[0]?.id ?? null)
  const initial = useMemo(() => toFlow(flows[0]?.graph ?? emptyAutomationGraph()), [flows])
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [pending, start] = useTransition()
  const [showAi, setShowAi] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)

  // Follow the app's dark theme so React Flow's canvas / controls / minimap /
  // edges render dark too (the `.dark` class is toggled by the theme switcher).
  const [isDark, setIsDark] = useState(false)
  useEffect(() => {
    const el = document.documentElement
    const sync = () => setIsDark(el.classList.contains('dark'))
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  const nodeTypes = useMemo(
    () => ({ trigger: TriggerNode, condition: ConditionNode, gate: GateNode, action: ActionNode }),
    [],
  )

  const availableFields = useMemo(
    () => profile.fields.map((f) => ({ id: f.key, label: f.label })),
    [profile],
  )
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null
  const selectedFlow = flowList.find((f) => f.id === selectedFlowId) ?? null

  const captureCurrent = useCallback(() => {
    if (selectedFlowId) graphs.current.set(selectedFlowId, fromFlow(nodes, edges))
  }, [selectedFlowId, nodes, edges])

  const loadFlow = useCallback(
    (id: string | null) => {
      const g = id ? (graphs.current.get(id) ?? emptyAutomationGraph()) : emptyAutomationGraph()
      const f = toFlow(g)
      setNodes(id ? f.nodes : [])
      setEdges(id ? f.edges : [])
      setSelectedNodeId(null)
      setSelectedFlowId(id)
    },
    [setNodes, setEdges],
  )

  const selectFlow = (id: string) => {
    if (id === selectedFlowId) return
    captureCurrent()
    loadFlow(id)
  }

  const addFlow = () => {
    start(async () => {
      const res = await createFlow(subject, 'New flow')
      if (!res.ok || !res.id) {
        toast.error(res.error ?? 'Could not create the flow')
        return
      }
      captureCurrent()
      graphs.current.set(res.id, emptyAutomationGraph())
      setFlowList((l) => [...l, { id: res.id!, name: 'New flow', enabled: true }])
      loadFlow(res.id)
      toast.success('Flow created')
    })
  }

  const toggleEnabled = (id: string, enabled: boolean) => {
    setFlowList((l) => l.map((f) => (f.id === id ? { ...f, enabled } : f)))
    start(async () => {
      await setFlowEnabled(id, enabled)
    })
  }

  const commitRename = (id: string) => {
    const nm = editName.trim() || 'Flow'
    setFlowList((l) => l.map((f) => (f.id === id ? { ...f, name: nm } : f)))
    setEditingId(null)
    start(async () => {
      await renameFlow(id, nm)
    })
  }

  const removeFlow = (id: string) => {
    start(async () => {
      await deleteFlow(id)
      graphs.current.delete(id)
      const next = flowList.filter((f) => f.id !== id)
      setFlowList(next)
      if (id === selectedFlowId) loadFlow(next[0]?.id ?? null)
      toast.success('Flow deleted')
    })
  }

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, id: newId('e') }, eds)),
    [setEdges],
  )

  const addNode = (kind: NData['kind']) => {
    if (!selectedFlowId) return
    const id = newId(kind)
    const node: FlowNode = {
      id,
      type: kind,
      position: { x: 80 + Math.random() * 240, y: 80 + Math.random() * 240 },
      data: defaultData(kind, fieldIds[0] ?? '', profile),
    }
    setNodes((ns) => [...ns, node])
    setSelectedNodeId(id)
  }

  const patchData = (id: string, data: NData) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data } : n)))

  const removeNode = (id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id))
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id))
    setSelectedNodeId(null)
  }

  const save = () => {
    if (!selectedFlowId) return
    const graph = fromFlow(nodes, edges)
    graphs.current.set(selectedFlowId, graph)
    start(async () => {
      const res = await saveFlow(selectedFlowId, graph)
      if (!res.ok) {
        toast.error(res.error ?? 'Could not save the flow')
        return
      }
      toast.success('Flow saved')
    })
  }

  const runAi = () => {
    if (!selectedFlowId) {
      toast.error('Create or select a flow first')
      return
    }
    start(async () => {
      const res = await generateFlowDraft(selectedFlowId, aiPrompt)
      if (!res.ok || !res.graph) {
        toast.error(res.error ?? 'Could not generate the flow')
        return
      }
      graphs.current.set(selectedFlowId, res.graph)
      const f = toFlow(res.graph)
      setNodes(f.nodes)
      setEdges(f.edges)
      setSelectedNodeId(null)
      setShowAi(false)
      toast.success('Flow drafted — review and save')
    })
  }

  const applyTemplate = (t: FlowTemplate) => {
    if (!selectedFlowId) {
      toast.error('Create or select a flow first')
      return
    }
    const graph = t.build()
    graphs.current.set(selectedFlowId, graph)
    const f = toFlow(graph)
    setNodes(f.nodes)
    setEdges(f.edges)
    setSelectedNodeId(null)
    setShowTemplates(false)
    toast.success('Template loaded — fill in the blanks, then Save')
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Left rail — flows list */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
          <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
            <Workflow size={13} /> Flows
          </span>
          {canEdit ? (
            <button
              type="button"
              onClick={addFlow}
              disabled={pending}
              title="New flow"
              className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <Plus size={15} />
            </button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {flowList.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-slate-400">
              No flows.
              {canEdit ? (
                <button
                  onClick={addFlow}
                  className="mt-2 block w-full text-teal-600 hover:underline"
                >
                  + New flow
                </button>
              ) : null}
            </div>
          ) : (
            flowList.map((f) => {
              const active = f.id === selectedFlowId
              return (
                <div
                  key={f.id}
                  onClick={() => selectFlow(f.id)}
                  className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                    active
                      ? 'bg-white shadow-sm ring-1 ring-teal-300 dark:bg-slate-800 dark:ring-teal-700'
                      : 'hover:bg-white/70 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <MiniToggle
                    checked={f.enabled}
                    disabled={!canEdit}
                    onChange={(v) => toggleEnabled(f.id, v)}
                  />
                  {editingId === f.id ? (
                    <input
                      autoFocus
                      value={editName}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => commitRename(f.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(f.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="min-w-0 flex-1 rounded border border-slate-300 px-1 py-0.5 text-sm outline-none focus:border-teal-400"
                    />
                  ) : (
                    <span
                      className={`min-w-0 flex-1 truncate ${
                        f.enabled
                          ? 'text-slate-700 dark:text-slate-300'
                          : 'text-slate-400 line-through dark:text-slate-500'
                      }`}
                    >
                      {f.name}
                    </span>
                  )}
                  {canEdit && editingId !== f.id ? (
                    <>
                      <button
                        type="button"
                        title="Rename"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingId(f.id)
                          setEditName(f.name)
                        }}
                        className="opacity-0 transition group-hover:opacity-100"
                      >
                        <Pencil size={12} className="text-slate-400 hover:text-slate-600" />
                      </button>
                      <button
                        type="button"
                        title="Delete flow"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeFlow(f.id)
                        }}
                        className="opacity-0 transition group-hover:opacity-100"
                      >
                        <Trash2 size={12} className="text-slate-400 hover:text-rose-500" />
                      </button>
                    </>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
      </aside>

      {/* Main column — header + canvas */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            {!embedded && backHref ? (
              <>
                <Link
                  href={backHref}
                  title="Back"
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  <ArrowLeft size={15} />
                  <span className="hidden sm:inline">Back</span>
                </Link>
                <span className="h-4 w-px bg-slate-200" />
              </>
            ) : null}
            <span className="min-w-0 truncate">
              {embedded ? null : <span className="font-semibold">{subjectLabel}</span>}{' '}
              <span className={embedded ? 'font-semibold text-slate-700' : 'text-slate-400'}>
                {embedded ? '' : '· '}
                {selectedFlow ? selectedFlow.name : 'Flows'}
              </span>
            </span>
            {selectedFlow && !selectedFlow.enabled ? (
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                Disabled
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {canEdit && selectedFlowId ? (
              <>
                <Button variant="outline" size="sm" onClick={() => addNode('trigger')}>
                  <Plus size={13} /> Trigger
                </Button>
                <Button variant="outline" size="sm" onClick={() => addNode('condition')}>
                  <Plus size={13} /> Condition
                </Button>
                <Button variant="outline" size="sm" onClick={() => addNode('gate')}>
                  <Plus size={13} /> Approval
                </Button>
                <Button variant="outline" size="sm" onClick={() => addNode('action')}>
                  <Plus size={13} /> Action
                </Button>
              </>
            ) : null}
            {canEdit && selectedFlowId ? (
              <Button variant="outline" size="sm" onClick={() => setShowTemplates(true)}>
                <Rocket size={13} /> Templates
              </Button>
            ) : null}
            {canGenerate && selectedFlowId ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAi(true)}
                disabled={pending}
              >
                <Sparkles size={13} /> AI
              </Button>
            ) : null}
            {canEdit && selectedFlowId ? (
              <Button size="sm" onClick={save} disabled={pending}>
                <Save size={13} /> {pending ? 'Saving…' : 'Save'}
              </Button>
            ) : null}
          </div>
        </header>

        <div className="relative min-h-0 flex-1">
          {selectedFlowId ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, n) => setSelectedNodeId(n.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              nodeTypes={nodeTypes}
              nodesConnectable={canEdit}
              colorMode={isDark ? 'dark' : 'light'}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable />
            </ReactFlow>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  No flow selected
                </p>
                <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">
                  Create a flow on the left to start building automations for this App.
                </p>
              </div>
            </div>
          )}

          {selectedFlowId && nodes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
              <div className="pointer-events-auto w-full max-w-lg rounded-xl border border-dashed border-slate-300 bg-white/95 p-5 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900/95">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Start with a template
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Pick a common automation, or build from scratch with the toolbar / AI.
                </p>
                {canEdit ? (
                  <div className="mt-3 grid grid-cols-1 gap-2 text-left sm:grid-cols-2">
                    {FLOW_TEMPLATES.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => applyTemplate(t)}
                        className="rounded-lg border border-slate-200 bg-white p-2.5 transition hover:border-teal-400 hover:bg-teal-50/40 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-teal-600 dark:hover:bg-teal-950/40"
                      >
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          {t.label}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                          {t.description}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <Drawer
        open={selectedNode != null}
        onClose={() => setSelectedNodeId(null)}
        title={selectedNode ? `Edit ${selectedNode.data.kind}` : 'Edit'}
        size="sm"
        footer={
          selectedNode && canEdit ? (
            <Button variant="outline" onClick={() => removeNode(selectedNode.id)}>
              <Trash2 size={14} className="text-rose-500" /> Delete node
            </Button>
          ) : null
        }
      >
        {selectedNode ? (
          <NodeInspector
            data={selectedNode.data}
            fieldIds={fieldIds}
            availableFields={availableFields}
            profile={profile}
            emailTemplates={emailTemplates}
            pdfTemplates={pdfTemplates}
            recipientOptions={recipientOptions}
            readOnly={!canEdit}
            onChange={(d) => patchData(selectedNode.id, d)}
          />
        ) : null}
      </Drawer>

      <Drawer
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        title="Quick-start templates"
        description="Load a common automation into this flow, then fill in the blanks."
        size="sm"
      >
        <div className="space-y-2">
          {FLOW_TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => applyTemplate(t)}
              className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-teal-400 hover:bg-teal-50/40 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-teal-600 dark:hover:bg-teal-950/40"
            >
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {t.label}
              </div>
              <div className="mt-0.5 text-xs leading-snug text-slate-500 dark:text-slate-400">
                {t.description}
              </div>
            </button>
          ))}
          <p className="pt-1 text-[11px] text-slate-400 dark:text-slate-500">
            Loading a template replaces the current flow&apos;s nodes.
          </p>
        </div>
      </Drawer>

      <Drawer
        open={showAi}
        onClose={() => setShowAi(false)}
        title="Generate a Flow with AI"
        description="Describe the automation. The AI drafts the node graph for review."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAi(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={runAi} disabled={pending || aiPrompt.trim().length < 4}>
              <Sparkles size={14} /> {pending ? 'Generating…' : 'Generate'}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Textarea
            rows={4}
            value={aiPrompt}
            placeholder="e.g. When the compliance score is below 80, create a high-severity CAPA and email the safety manager."
            onChange={(e) => setAiPrompt(e.target.value)}
          />
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Replaces the selected flow with the AI draft.
          </p>
        </div>
      </Drawer>
    </div>
  )
}

// --- Inspector (per-kind editing) ------------------------------------------

function NodeInspector({
  data,
  fieldIds,
  availableFields,
  profile,
  emailTemplates,
  pdfTemplates,
  recipientOptions,
  readOnly,
  onChange,
}: {
  data: NData
  fieldIds: string[]
  availableFields: { id: string; label: string }[]
  profile: FlowSubjectProfile
  emailTemplates: EmailTemplateOption[]
  pdfTemplates: PdfTemplateOption[]
  recipientOptions: RecipientOptions
  readOnly: boolean
  onChange: (d: NData) => void
}) {
  if (data.kind === 'trigger') {
    const t = data.trigger
    return (
      <div className="space-y-3">
        <Field label="When">
          <Select
            value={t.trigger}
            disabled={readOnly}
            onChange={(e) => {
              const v = e.target.value as TriggerData['trigger']
              onChange({
                kind: 'trigger',
                trigger: buildTrigger(
                  v,
                  fieldIds[0] ?? '',
                  profile.statusValues?.[0] ?? 'submitted',
                ),
              })
            }}
          >
            {profile.triggers.map((tk) => (
              <option key={tk} value={tk}>
                {TRIGGER_LABEL[tk]}
              </option>
            ))}
          </Select>
        </Field>
        {t.trigger === 'on_field_value' ? (
          <Field label="Field condition">
            <LogicBuilder
              rule={t.rule}
              availableFields={availableFields}
              onChange={(rule) =>
                onChange({
                  kind: 'trigger',
                  trigger: {
                    trigger: 'on_field_value',
                    rule: rule ?? { op: 'isSet', field: fieldIds[0] ?? '' },
                  },
                })
              }
            />
          </Field>
        ) : null}
        {t.trigger === 'status_change' ? (
          <Field label="New status">
            <Select
              value={t.to}
              disabled={readOnly}
              onChange={(e) =>
                onChange({
                  kind: 'trigger',
                  trigger: { trigger: 'status_change', to: e.target.value },
                })
              }
            >
              {(profile.statusValues ?? ['submitted']).map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {t.trigger === 'scheduled' ? (
          <Field label="Cron schedule">
            <Input
              value={t.cron}
              disabled={readOnly}
              onChange={(e) =>
                onChange({
                  kind: 'trigger',
                  trigger: { trigger: 'scheduled', cron: e.target.value },
                })
              }
            />
          </Field>
        ) : null}
        {t.trigger === 'manual' ? (
          <>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              This flow runs when someone clicks a button on a record. The button shows on the
              record action bar.
            </p>
            <Field label="Button label">
              <Input
                value={t.label}
                disabled={readOnly}
                placeholder="e.g. Close out"
                onChange={(e) =>
                  onChange({ kind: 'trigger', trigger: { ...t, label: e.target.value } })
                }
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Style">
                <Select
                  value={t.variant ?? 'default'}
                  disabled={readOnly}
                  onChange={(e) =>
                    onChange({
                      kind: 'trigger',
                      trigger: { ...t, variant: e.target.value as NonNullable<typeof t.variant> },
                    })
                  }
                >
                  <option value="default">Primary</option>
                  <option value="outline">Outline</option>
                  <option value="secondary">Secondary</option>
                  <option value="destructive">Destructive</option>
                </Select>
              </Field>
              <Field label="Icon">
                <Input
                  value={t.icon ?? ''}
                  disabled={readOnly}
                  placeholder="lucide, e.g. check"
                  onChange={(e) =>
                    onChange({
                      kind: 'trigger',
                      trigger: { ...t, icon: e.target.value.trim() ? e.target.value : undefined },
                    })
                  }
                />
              </Field>
            </div>
            <Field label="Confirmation prompt">
              <Input
                value={t.confirm ?? ''}
                disabled={readOnly}
                placeholder="Optional — shown before the action runs"
                onChange={(e) =>
                  onChange({
                    kind: 'trigger',
                    trigger: { ...t, confirm: e.target.value.trim() ? e.target.value : undefined },
                  })
                }
              />
            </Field>
            <Field label="Order">
              <Input
                type="number"
                value={t.order ?? ''}
                disabled={readOnly}
                placeholder="Position in the bar (lower shows first)"
                onChange={(e) => {
                  const raw = e.target.value.trim()
                  const n = raw === '' ? undefined : Number.parseInt(raw, 10)
                  onChange({
                    kind: 'trigger',
                    trigger: {
                      ...t,
                      order: Number.isFinite(n as number) ? (n as number) : undefined,
                    },
                  })
                }}
              />
            </Field>
            <Field label="Show button only when">
              <LogicBuilder
                rule={t.showIf}
                availableFields={availableFields}
                onChange={(rule) =>
                  onChange({ kind: 'trigger', trigger: { ...t, showIf: rule ?? undefined } })
                }
              />
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                Leave empty to always show the button. Internal id:{' '}
                <span className="font-mono">{t.buttonId}</span>
              </p>
            </Field>
          </>
        ) : null}
      </div>
    )
  }

  if (data.kind === 'condition') {
    return (
      <div className="space-y-3">
        <Field label="Label">
          <Input
            value={data.label ?? ''}
            disabled={readOnly}
            onChange={(e) => onChange({ ...data, label: e.target.value })}
          />
        </Field>
        <Field label="Rule (true → then, else → else)">
          <LogicBuilder
            rule={data.rule}
            availableFields={availableFields}
            onChange={(rule) =>
              onChange({ ...data, rule: rule ?? { op: 'isSet', field: fieldIds[0] ?? '' } })
            }
          />
        </Field>
      </div>
    )
  }

  if (data.kind === 'gate') {
    const g = data.gate
    return (
      <div className="space-y-3">
        <Field label="Title">
          <Input
            value={g.title}
            disabled={readOnly}
            onChange={(e) => onChange({ kind: 'gate', gate: { ...g, title: e.target.value } })}
          />
        </Field>
        <Field label="Who approves">
          <Select
            value={g.assignee.type}
            disabled={readOnly}
            onChange={(e) =>
              onChange({
                kind: 'gate',
                gate: {
                  ...g,
                  assignee:
                    e.target.value === 'role' ? { type: 'role', role: '' } : { type: 'submitter' },
                },
              })
            }
          >
            <option value="submitter">The submitter</option>
            <option value="role">A role</option>
          </Select>
        </Field>
        {g.assignee.type === 'role' ? (
          <Field label="Role">
            <Input
              value={g.assignee.role}
              disabled={readOnly}
              onChange={(e) =>
                onChange({
                  kind: 'gate',
                  gate: { ...g, assignee: { type: 'role', role: e.target.value } },
                })
              }
            />
          </Field>
        ) : null}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={!!g.signatureRequired}
            disabled={readOnly}
            onChange={(e) =>
              onChange({ kind: 'gate', gate: { ...g, signatureRequired: e.target.checked } })
            }
          />
          Signature required
        </label>
      </div>
    )
  }

  // action
  return (
    <ActionInspector
      data={data}
      fieldIds={fieldIds}
      actions={profile.actions}
      emailTemplates={emailTemplates}
      pdfTemplates={pdfTemplates}
      recipientOptions={recipientOptions}
      richPdf={profile.richPdf ?? false}
      readOnly={readOnly}
      onChange={onChange}
    />
  )
}

function ActionInspector({
  data,
  fieldIds,
  actions,
  emailTemplates,
  pdfTemplates,
  recipientOptions,
  richPdf,
  readOnly,
  onChange,
}: {
  data: Extract<NData, { kind: 'action' }>
  fieldIds: string[]
  actions: ActionData['action'][]
  emailTemplates: EmailTemplateOption[]
  pdfTemplates: PdfTemplateOption[]
  recipientOptions: RecipientOptions
  richPdf: boolean
  readOnly: boolean
  onChange: (d: NData) => void
}) {
  const a = data.action
  const set = (action: ActionData) => onChange({ kind: 'action', action })
  const actionChoices = actions.length
    ? actions
    : (Object.keys(ACTION_LABEL) as ActionData['action'][])

  // send_email "design" (one-off) mode — a full-screen drag-and-drop builder.
  const [designOpen, setDesignOpen] = useState(false)
  const [designBusy, setDesignBusy] = useState(false)
  const designRef = useRef<Editor | null>(null)
  const saveDesign = async () => {
    const ed = designRef.current
    if (!ed || a.action !== 'send_email') return
    setDesignBusy(true)
    try {
      const design = ed.getProjectData() as Record<string, unknown>
      const mjmlSource = ed.getHtml()
      const res = await compileEmailDesign(mjmlSource)
      if (!res.ok) {
        toast.error(res.error ?? 'Could not compile the design')
        return
      }
      set({ ...a, mode: 'design', design, compiledHtml: res.html ?? '' })
      setDesignOpen(false)
    } finally {
      setDesignBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {designOpen ? (
        <div className="fixed inset-0 z-[60] flex flex-col bg-white dark:bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 dark:border-slate-800">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Email design
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setDesignOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={designBusy} onClick={saveDesign}>
                {designBusy ? 'Saving…' : 'Save design'}
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <EmailDesignBuilder
              initialDesign={a.action === 'send_email' ? (a.design ?? null) : null}
              mergeFields={fieldIds.map((f) => ({ key: f }))}
              onReady={(ed) => {
                designRef.current = ed
              }}
            />
          </div>
        </div>
      ) : null}
      <Field label="Action">
        <Select
          value={a.action}
          disabled={readOnly}
          onChange={(e) => set(defaultAction(e.target.value as ActionData['action'], fieldIds))}
        >
          {actionChoices.map((k) => (
            <option key={k} value={k}>
              {ACTION_LABEL[k]}
            </option>
          ))}
        </Select>
      </Field>

      {a.action === 'send_email' ? (
        <>
          <RecipientsEditor
            to={a.to}
            onChange={(to) => set({ ...a, to })}
            readOnly={readOnly}
            fieldIds={fieldIds}
            options={recipientOptions}
          />
          <Field label="Email content">
            <Select
              value={a.mode ?? 'inline'}
              disabled={readOnly}
              onChange={(e) =>
                set({ ...a, mode: e.target.value as 'inline' | 'template' | 'design' })
              }
            >
              <option value="inline">Write it here</option>
              <option value="template">Use a saved template</option>
              <option value="design">Design one (drag &amp; drop)</option>
            </Select>
          </Field>
          {(a.mode ?? 'inline') === 'design' ? (
            <>
              <Field label="Subject">
                <Input
                  value={a.subjectTemplate ?? ''}
                  disabled={readOnly}
                  onChange={(e) => set({ ...a, subjectTemplate: e.target.value })}
                />
              </Field>
              <Button
                variant="outline"
                size="sm"
                disabled={readOnly}
                onClick={() => setDesignOpen(true)}
              >
                {a.compiledHtml ? 'Edit design' : 'Open visual builder'}
              </Button>
              {a.compiledHtml ? (
                <p className="text-xs text-emerald-600">Design saved — Save the flow to keep it.</p>
              ) : (
                <p className="text-xs text-slate-400">
                  Build a one-off email with the drag-and-drop editor.
                </p>
              )}
            </>
          ) : (a.mode ?? 'inline') === 'template' ? (
            <>
              <Field label="Template">
                <Select
                  value={a.templateId ?? ''}
                  disabled={readOnly}
                  onChange={(e) => set({ ...a, templateId: e.target.value })}
                >
                  <option value="">— choose a template —</option>
                  {emailTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {emailTemplates.length === 0 ? (
                <p className="text-xs text-slate-400">
                  No templates yet — create one in Admin → Email templates.
                </p>
              ) : null}
              <Field label="Subject override (optional)">
                <Input
                  value={a.subjectOverride ?? ''}
                  disabled={readOnly}
                  onChange={(e) => set({ ...a, subjectOverride: e.target.value })}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Subject">
                <Input
                  value={a.subject ?? ''}
                  disabled={readOnly}
                  onChange={(e) => set({ ...a, subject: e.target.value })}
                />
              </Field>
              <Field label="Body (supports {{token}})">
                <Textarea
                  rows={4}
                  value={a.bodyTemplate ?? ''}
                  disabled={readOnly}
                  onChange={(e) => set({ ...a, bodyTemplate: e.target.value })}
                />
              </Field>
            </>
          )}
          <Field label="PDF attachment">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={!!a.attachPdf}
                disabled={readOnly}
                onChange={(e) => set({ ...a, attachPdf: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              Attach a PDF of the record
            </label>
          </Field>
          {a.attachPdf ? (
            <Field label="PDF document">
              <Select
                value={
                  a.pdfTemplateId
                    ? `tpl:${a.pdfTemplateId}`
                    : `builtin:${a.pdfFormat ?? (richPdf ? 'full' : 'summary')}`
                }
                disabled={readOnly}
                onChange={(e) => {
                  const v = e.target.value
                  if (v.startsWith('tpl:')) {
                    set({ ...a, pdfTemplateId: v.slice(4), pdfFormat: undefined })
                  } else {
                    set({
                      ...a,
                      pdfTemplateId: undefined,
                      pdfFormat: v.slice(8) as 'full' | 'summary',
                    })
                  }
                }}
              >
                {pdfTemplates.length > 0 ? (
                  <optgroup label="PDF templates (paper-size documents)">
                    {pdfTemplates.map((t) => (
                      <option key={t.id} value={`tpl:${t.id}`}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <optgroup label="Built-in">
                  {richPdf ? <option value="builtin:full">Full record PDF</option> : null}
                  <option value="builtin:summary">Field summary (key / value table)</option>
                </optgroup>
              </Select>
            </Field>
          ) : null}
        </>
      ) : null}

      {a.action === 'create_capa' ? (
        <>
          <Field label="Title (supports {{field_id}})">
            <Input
              value={a.titleTemplate}
              disabled={readOnly}
              onChange={(e) => set({ ...a, titleTemplate: e.target.value })}
            />
          </Field>
          <Field label="Severity">
            <Select
              value={a.severity ?? 'medium'}
              disabled={readOnly}
              onChange={(e) =>
                set({ ...a, severity: e.target.value as 'low' | 'medium' | 'high' | 'critical' })
              }
            >
              {['low', 'medium', 'high', 'critical'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due in (days)">
            <Input
              type="number"
              value={a.dueInDays ?? ''}
              disabled={readOnly}
              onChange={(e) =>
                set({ ...a, dueInDays: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </Field>
        </>
      ) : null}

      {a.action === 'create_incident' ? (
        <Field label="Title (supports {{field_id}})">
          <Input
            value={a.titleTemplate}
            disabled={readOnly}
            onChange={(e) => set({ ...a, titleTemplate: e.target.value })}
          />
        </Field>
      ) : null}

      {a.action === 'notify_role' ? (
        <>
          <Field label="Role">
            <Input
              value={a.role}
              disabled={readOnly}
              onChange={(e) => set({ ...a, role: e.target.value })}
            />
          </Field>
          <Field label="Message">
            <Input
              value={a.message}
              disabled={readOnly}
              onChange={(e) => set({ ...a, message: e.target.value })}
            />
          </Field>
        </>
      ) : null}

      {a.action === 'set_field' ? (
        <>
          <Field label="Field">
            <Select
              value={a.field}
              disabled={readOnly}
              onChange={(e) => set({ ...a, field: e.target.value })}
            >
              <option value="">— pick a field —</option>
              {fieldIds.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Value">
            <Input
              value={a.value.kind === 'literal' ? String(a.value.value ?? '') : ''}
              disabled={readOnly}
              onChange={(e) => set({ ...a, value: { kind: 'literal', value: e.target.value } })}
            />
          </Field>
        </>
      ) : null}

      {a.action === 'flag_non_compliant' ? (
        <Field label="Reason">
          <Input
            value={a.reason ?? ''}
            disabled={readOnly}
            onChange={(e) => set({ ...a, reason: e.target.value })}
          />
        </Field>
      ) : null}

      {a.action === 'webhook' ? (
        <>
          <Field label="URL">
            <Input
              value={a.url}
              disabled={readOnly}
              onChange={(e) => set({ ...a, url: e.target.value })}
            />
          </Field>
          <Field label="Method">
            <Select
              value={a.method}
              disabled={readOnly}
              onChange={(e) => set({ ...a, method: e.target.value as 'POST' | 'PUT' })}
            >
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
            </Select>
          </Field>
        </>
      ) : null}

      {a.action === 'analyze_photos' ? (
        <>
          <Field label="Photo field">
            <Select
              value={a.fieldId}
              disabled={readOnly}
              onChange={(e) => set({ ...a, fieldId: e.target.value })}
            >
              <option value="">— pick a field —</option>
              {fieldIds.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Write summary to (optional)">
            <Select
              value={a.storeInField ?? ''}
              disabled={readOnly}
              onChange={(e) => set({ ...a, storeInField: e.target.value || undefined })}
            >
              <option value="">— none —</option>
              {fieldIds.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={!!a.createCapaOnHazard}
              disabled={readOnly}
              onChange={(e) => set({ ...a, createCapaOnHazard: e.target.checked })}
            />
            Create a CAPA when hazards are found
          </label>
          {a.createCapaOnHazard ? (
            <Field label="Minimum severity">
              <Select
                value={a.minSeverity ?? 'medium'}
                disabled={readOnly}
                onChange={(e) =>
                  set({ ...a, minSeverity: e.target.value as 'low' | 'medium' | 'high' })
                }
              >
                <option value="low">Low and above</option>
                <option value="medium">Medium and above</option>
                <option value="high">High only</option>
              </Select>
            </Field>
          ) : null}
        </>
      ) : null}

      {a.action === 'start_monitored_session' ? (
        <>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            After submit, this response becomes a live monitored session with a recurring check-in
            timer. Escalation fires through the “A monitored session goes overdue” trigger. Set each
            timing as a fixed value, or bind it to a submitted number field.
          </p>
          <MonitorNum
            label="Check-in interval (min)"
            value={a.intervalMinutes}
            fieldKey={a.intervalFieldKey}
            fieldIds={fieldIds}
            readOnly={readOnly}
            onValue={(v) => set({ ...a, intervalMinutes: Math.max(1, v) })}
            onField={(k) => set({ ...a, intervalFieldKey: k })}
          />
          <MonitorNum
            label="Grace period (min)"
            value={a.graceMinutes}
            fieldKey={a.graceFieldKey}
            fieldIds={fieldIds}
            readOnly={readOnly}
            onValue={(v) => set({ ...a, graceMinutes: Math.max(0, v) })}
            onField={(k) => set({ ...a, graceFieldKey: k })}
          />
          <MonitorNum
            label="Expected duration (min)"
            value={a.durationMinutes ?? 0}
            fieldKey={a.durationFieldKey}
            fieldIds={fieldIds}
            readOnly={readOnly}
            onValue={(v) => set({ ...a, durationMinutes: Math.max(0, v) })}
            onField={(k) => set({ ...a, durationFieldKey: k })}
          />
          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={!!a.requireGeo}
              disabled={readOnly}
              onChange={(e) => set({ ...a, requireGeo: e.target.checked })}
            />
            Require GPS on each check-in
          </label>
        </>
      ) : null}
    </div>
  )
}

// Number input that can be a fixed value OR bound to a submitted number field —
// used by the start_monitored_session inspector for interval/grace/duration.
function MonitorNum({
  label,
  value,
  fieldKey,
  fieldIds,
  readOnly,
  onValue,
  onField,
}: {
  label: string
  value: number
  fieldKey: string | undefined
  fieldIds: string[]
  readOnly: boolean
  onValue: (v: number) => void
  onField: (k: string | undefined) => void
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min="0"
          className="h-8 w-20"
          value={String(value)}
          disabled={readOnly || !!fieldKey}
          onChange={(e) => onValue(Math.floor(Number(e.target.value) || 0))}
        />
        <span className="text-xs text-slate-400 dark:text-slate-500">or</span>
        <Select
          className="h-8 flex-1"
          value={fieldKey ?? ''}
          disabled={readOnly}
          onChange={(e) => onField(e.target.value || undefined)}
        >
          <option value="">— fixed value —</option>
          {fieldIds.map((f) => (
            <option key={f} value={f}>
              bind: {f}
            </option>
          ))}
        </Select>
      </div>
    </Field>
  )
}

function defaultAction(kind: ActionData['action'], fieldIds: string[]): ActionData {
  switch (kind) {
    case 'send_email':
      return { action: 'send_email', to: [{ type: 'submitter' }], subject: '', bodyTemplate: '' }
    case 'create_capa':
      return { action: 'create_capa', titleTemplate: '', severity: 'medium' }
    case 'create_incident':
      return { action: 'create_incident', titleTemplate: '' }
    case 'notify_role':
      return { action: 'notify_role', role: '', message: '' }
    case 'set_field':
      return {
        action: 'set_field',
        field: fieldIds[0] ?? '',
        value: { kind: 'literal', value: '' },
      }
    case 'flag_non_compliant':
      return { action: 'flag_non_compliant' }
    case 'webhook':
      return { action: 'webhook', url: '', method: 'POST' }
    case 'create_response':
      return { action: 'create_response', templateId: '' }
    case 'analyze_photos':
      return { action: 'analyze_photos', fieldId: fieldIds[0] ?? '' }
    case 'start_monitored_session':
      return {
        action: 'start_monitored_session',
        intervalMinutes: 30,
        graceMinutes: 10,
        durationMinutes: 120,
        requireGeo: false,
      }
    case 'change_status':
      return { action: 'change_status', to: '' }
    case 'duplicate_record':
      return { action: 'duplicate_record' }
    case 'export_pdf':
      return { action: 'export_pdf' }
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}
