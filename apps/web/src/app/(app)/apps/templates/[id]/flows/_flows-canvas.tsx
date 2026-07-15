'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
import { MAX_FLOW_NAME_LENGTH } from '@/lib/flows/flow-name-policy'
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
import { serializeTemplateEditor } from '@/lib/template-builder-html'

type EmailTemplateOption = { id: string; name: string }
type PdfTemplateOption = { id: string; name: string }
type TargetAppOption = { id: string; name: string }
type ActionFieldOptions = {
  all: string[]
  writable: string[]
  photoSources: string[]
  textOutputs: string[]
  numeric: string[]
}

// Pickable people / roles / departments for the send_email recipient editor.
export type RecipientOptions = {
  people: { id: string; name: string }[]
  roles: { key: string; name: string }[]
  departments: { id: string; name: string }[]
  groups: { id: string; name: string }[]
}
const EMPTY_RECIPIENT_OPTIONS: RecipientOptions = {
  people: [],
  roles: [],
  departments: [],
  groups: [],
}

const RECIPIENT_LABEL: Record<EmailTarget['type'], string> = {
  submitter: 'The submitter',
  submitter_manager: "The submitter's manager",
  person: 'A specific person',
  role: 'Everyone in a role',
  department_manager: "A department's managers",
  group: 'A notification group',
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
    case 'group':
      return { type: 'group', groupId: '' }
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
  const tGenerated = useGeneratedTranslations()
  const rows = to.length > 0 ? to : [{ type: 'submitter' } as EmailTarget]
  const update = (i: number, t: EmailTarget) => onChange(rows.map((x, j) => (j === i ? t : x)))
  const peopleOpts = options.people.map((p) => ({ value: p.id, label: p.name }))
  const deptOpts = options.departments.map((d) => ({ value: d.id, label: d.name }))
  const groupOpts = options.groups.map((g) => ({ value: g.id, label: g.name }))
  return (
    <Field label={tGenerated('m_0d99b2b56f8b5d')}>
      <div className="space-y-2">
        <GeneratedValue
          value={rows.map((t, i) => (
            <div
              key={i}
              className="space-y-1.5 rounded-md border border-slate-200 p-2 dark:border-slate-700"
            >
              <div className="flex items-center gap-1.5">
                <Select
                  value={t.type}
                  disabled={readOnly}
                  onChange={(e) =>
                    update(
                      i,
                      defaultTarget(e.target.value as EmailTarget['type'], fieldIds[0] ?? ''),
                    )
                  }
                >
                  <GeneratedValue
                    value={(Object.keys(RECIPIENT_LABEL) as EmailTarget['type'][]).map((k) => (
                      <option key={k} value={k}>
                        <GeneratedValue value={RECIPIENT_LABEL[k]} />
                      </option>
                    ))}
                  />
                </Select>
                <GeneratedValue
                  value={
                    !readOnly && rows.length > 1 ? (
                      <button
                        type="button"
                        title={tGenerated('m_0d9b2e08c28452')}
                        onClick={() => onChange(rows.filter((_, j) => j !== i))}
                        className="shrink-0 rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                      >
                        <X size={14} />
                      </button>
                    ) : null
                  }
                />
              </div>
              <GeneratedValue
                value={
                  t.type === 'person' ? (
                    <SearchSelect
                      value={t.personId}
                      disabled={readOnly}
                      options={peopleOpts}
                      placeholder={tGenerated('m_0a302f85a5260b')}
                      onChange={(v) => update(i, { type: 'person', personId: v })}
                    />
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  t.type === 'department_manager' ? (
                    <SearchSelect
                      value={t.departmentId}
                      disabled={readOnly}
                      options={deptOpts}
                      placeholder={tGenerated('m_1a73ab43e2b5d2')}
                      onChange={(v) => update(i, { type: 'department_manager', departmentId: v })}
                    />
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  t.type === 'group' ? (
                    <SearchSelect
                      value={t.groupId}
                      disabled={readOnly}
                      options={groupOpts}
                      placeholder={tGenerated('m_0b6591278bf814')}
                      onChange={(v) => update(i, { type: 'group', groupId: v })}
                    />
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  t.type === 'role' ? (
                    options.roles.length > 0 ? (
                      <Select
                        value={t.role}
                        disabled={readOnly}
                        onChange={(e) => update(i, { type: 'role', role: e.target.value })}
                      >
                        <option value="">
                          <GeneratedText id="m_1c317a2811e740" />
                        </option>
                        <GeneratedValue
                          value={options.roles.map((r) => (
                            <option key={r.key} value={r.key}>
                              <GeneratedValue value={r.name} />
                            </option>
                          ))}
                        />
                      </Select>
                    ) : (
                      <Input
                        value={t.role}
                        disabled={readOnly}
                        placeholder={tGenerated('m_1f114a74597cfb')}
                        onChange={(e) => update(i, { type: 'role', role: e.target.value })}
                      />
                    )
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  t.type === 'literal' ? (
                    <Input
                      value={t.email}
                      disabled={readOnly}
                      placeholder={tGenerated('m_05b63ccf241fff')}
                      onChange={(e) => update(i, { type: 'literal', email: e.target.value })}
                    />
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  t.type === 'field' ? (
                    <Select
                      value={t.field}
                      disabled={readOnly}
                      onChange={(e) => update(i, { type: 'field', field: e.target.value })}
                    >
                      <GeneratedValue
                        value={fieldIds.map((f) => (
                          <option key={f} value={f}>
                            <GeneratedValue value={f} />
                          </option>
                        ))}
                      />
                    </Select>
                  ) : null
                }
              />
            </div>
          ))}
        />
        <GeneratedValue
          value={
            !readOnly ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onChange([...rows, { type: 'submitter' }])}
              >
                <Plus size={13} /> <GeneratedText id="m_09417c94b44711" />
              </Button>
            ) : null
          }
        />
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
        <GeneratedText id="m_0743b8515ca318" />
      </div>
    ),
  },
)

export type FlowSummary = { id: string; name: string; enabled: boolean; graph: AutomationGraph }
type FlowMeta = { id: string; name: string; enabled: boolean }

type NData = AutomationNode['data']
type FlowNode = Node<NData>

const newId = (prefix: string) => `${prefix}_${globalThis.crypto.randomUUID()}`

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
      buttonId: newId('btn'),
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
        <Zap size={13} /> <GeneratedText id="m_1db1e5c9ca41ce" />
      </div>
      <div className="mt-0.5 truncate text-slate-600 dark:text-slate-400">
        <GeneratedValue value={triggerSummary(d.trigger)} />
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
        <GitBranch size={13} /> <GeneratedText id="m_0c33471afd0f99" />
      </div>
      <div className="mt-0.5 truncate text-slate-600 dark:text-slate-400">
        <GeneratedValue value={d.label || <GeneratedText id="m_006e893d66b28d" />} />
      </div>
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
        <ShieldCheck size={13} /> <GeneratedText id="m_0f7bb45f90ba7e" />
      </div>
      <div className="mt-0.5 truncate text-slate-600 dark:text-slate-400">
        <GeneratedValue value={d.gate.title || <GeneratedText id="m_0abb67c4c65a36" />} />
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
        <Mail size={13} /> <GeneratedText id="m_0bad495a7046e9" />
      </div>
      <div className="mt-0.5 truncate text-slate-600 dark:text-slate-400">
        <GeneratedValue value={ACTION_LABEL[d.action.action]} />
      </div>
      <Handle type="source" position={Position.Right} id="next" style={HANDLE} />
    </div>
  )
}

// --- Default node data ------------------------------------------------------

function defaultData(
  kind: NData['kind'],
  firstField: string,
  profile: FlowSubjectProfile,
  actionFields: ActionFieldOptions,
): NData {
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
        action: defaultAction(profile.actions[0] ?? 'send_email', actionFields),
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={tGeneratedValue(
        checked ? tGenerated('m_0c0c6c7a4b5bf5') : tGenerated('m_11bf1bf8c148ff'),
      )}
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
  targetApps = [],
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
  targetApps?: TargetAppOption[]
  recipientOptions?: RecipientOptions
  flows: FlowSummary[]
  canEdit: boolean
  canGenerate: boolean
  // When rendered inside the unified App editor, hide the standalone back link
  // + the redundant subject-name prefix (the editor header already has it).
  embedded?: boolean
  backHref?: string
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  // Subject-driven: triggers/actions/status/fields all come from the profile, so
  // the same canvas renders for a form template OR a native module.
  const subject: FlowSubjectRef = { type: profile.subjectType, key: profile.subjectKey }
  const subjectLabel = profile.label
  const fieldIds = useMemo(() => profile.fields.map((f) => f.key), [profile])
  const actionFields = useMemo<ActionFieldOptions>(
    () => ({
      all: profile.fields.map((field) => field.key),
      writable: profile.fields
        .filter((field) => field.writable !== false)
        .map((field) => field.key),
      photoSources: profile.fields.filter((field) => field.photoSource).map((field) => field.key),
      textOutputs: profile.fields.filter((field) => field.textOutput).map((field) => field.key),
      numeric: profile.fields
        .filter((field) => field.kind === 'number' && field.writable !== false)
        .map((field) => field.key),
    }),
    [profile],
  )
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
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_11eec81d216014')))
        return
      }
      captureCurrent()
      graphs.current.set(res.id, emptyAutomationGraph())
      setFlowList((l) => [...l, { id: res.id!, name: 'New flow', enabled: false }])
      loadFlow(res.id)
      toast.success(tGenerated('m_07105e19c7e789'))
    })
  }

  const toggleEnabled = (id: string, enabled: boolean) => {
    setFlowList((l) => l.map((f) => (f.id === id ? { ...f, enabled } : f)))
    start(async () => {
      const result = await setFlowEnabled(id, enabled)
      if (!result.ok) {
        setFlowList((list) =>
          list.map((flow) => (flow.id === id ? { ...flow, enabled: !enabled } : flow)),
        )
        toast.error(
          tGeneratedValue(
            result.error ??
              (enabled ? tGenerated('m_02c65a444f151a') : tGenerated('m_1e6f44ac3a3238')),
          ),
        )
      }
    })
  }

  const commitRename = (id: string) => {
    const nm = editName.trim() || 'Flow'
    if (nm.length > MAX_FLOW_NAME_LENGTH) {
      toast.error(tGenerated('m_1e52dceb23405d', { value0: MAX_FLOW_NAME_LENGTH }))
      return
    }
    const previousName = flowList.find((flow) => flow.id === id)?.name
    setFlowList((l) => l.map((f) => (f.id === id ? { ...f, name: nm } : f)))
    setEditingId(null)
    start(async () => {
      const result = await renameFlow(id, nm)
      if (!result.ok) {
        if (previousName) {
          setFlowList((list) =>
            list.map((flow) => (flow.id === id ? { ...flow, name: previousName } : flow)),
          )
        }
        toast.error(tGeneratedValue(result.error ?? tGenerated('m_0245cf85678788')))
      }
    })
  }

  const removeFlow = (id: string) => {
    start(async () => {
      await deleteFlow(id)
      graphs.current.delete(id)
      const next = flowList.filter((f) => f.id !== id)
      setFlowList(next)
      if (id === selectedFlowId) loadFlow(next[0]?.id ?? null)
      toast.success(tGenerated('m_0ac2f784b6e43b'))
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
      data: defaultData(kind, fieldIds[0] ?? '', profile, actionFields),
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
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_141dec99716e82')))
        return
      }
      toast.success(tGenerated('m_03c918fe3c11b7'))
    })
  }

  const runAi = () => {
    if (!selectedFlowId) {
      toast.error(tGenerated('m_0776dc4696267a'))
      return
    }
    start(async () => {
      const res = await generateFlowDraft(selectedFlowId, aiPrompt)
      if (!res.ok || !res.graph) {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0a2bad9c653946')))
        return
      }
      graphs.current.set(selectedFlowId, res.graph)
      const f = toFlow(res.graph)
      setNodes(f.nodes)
      setEdges(f.edges)
      setSelectedNodeId(null)
      setShowAi(false)
      toast.success(tGenerated('m_162609b68a9ac6'))
    })
  }

  const applyTemplate = (t: FlowTemplate) => {
    if (!selectedFlowId) {
      toast.error(tGenerated('m_0776dc4696267a'))
      return
    }
    const graph = t.build()
    graphs.current.set(selectedFlowId, graph)
    const f = toFlow(graph)
    setNodes(f.nodes)
    setEdges(f.edges)
    setSelectedNodeId(null)
    setShowTemplates(false)
    toast.success(tGenerated('m_0e58c2382f9cda'))
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Left rail — flows list */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
          <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
            <Workflow size={13} /> <GeneratedText id="m_1a4786daa752b1" />
          </span>
          <GeneratedValue
            value={
              canEdit ? (
                <button
                  type="button"
                  onClick={addFlow}
                  disabled={pending}
                  title={tGenerated('m_0c4753241b87b2')}
                  className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <Plus size={15} />
                </button>
              ) : null
            }
          />
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          <GeneratedValue
            value={
              flowList.length === 0 ? (
                <div className="px-2 py-6 text-center text-xs text-slate-400">
                  <GeneratedText id="m_09b3b5bd8c347d" />
                  <GeneratedValue
                    value={
                      canEdit ? (
                        <button
                          onClick={addFlow}
                          className="mt-2 block w-full text-teal-600 hover:underline"
                        >
                          <GeneratedText id="m_19bca60b6c1661" />
                        </button>
                      ) : null
                    }
                  />
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
                      <GeneratedValue
                        value={
                          editingId === f.id ? (
                            <input
                              autoFocus
                              value={editName}
                              maxLength={MAX_FLOW_NAME_LENGTH}
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
                              <GeneratedValue value={f.name} />
                            </span>
                          )
                        }
                      />
                      <GeneratedValue
                        value={
                          canEdit && editingId !== f.id ? (
                            <>
                              <button
                                type="button"
                                title={tGenerated('m_19a03337702a01')}
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
                                title={tGenerated('m_15741a97c1becc')}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removeFlow(f.id)
                                }}
                                className="opacity-0 transition group-hover:opacity-100"
                              >
                                <Trash2 size={12} className="text-slate-400 hover:text-rose-500" />
                              </button>
                            </>
                          ) : null
                        }
                      />
                    </div>
                  )
                })
              )
            }
          />
        </div>
      </aside>

      {/* Main column — header + canvas */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <GeneratedValue
              value={
                !embedded && backHref ? (
                  <>
                    <Link
                      href={backHref}
                      title={tGenerated('m_1a7cefe5a9894e')}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <ArrowLeft size={15} />
                      <span className="hidden sm:inline">
                        <GeneratedText id="m_1a7cefe5a9894e" />
                      </span>
                    </Link>
                    <span className="h-4 w-px bg-slate-200" />
                  </>
                ) : null
              }
            />
            <span className="min-w-0 truncate">
              <GeneratedValue
                value={
                  embedded ? null : (
                    <span className="font-semibold">
                      <GeneratedValue value={subjectLabel} />
                    </span>
                  )
                }
              />
              <GeneratedValue value={' '} />
              <span className={embedded ? 'font-semibold text-slate-700' : 'text-slate-400'}>
                <GeneratedValue value={embedded ? '' : '· '} />
                <GeneratedValue
                  value={selectedFlow ? selectedFlow.name : <GeneratedText id="m_1a4786daa752b1" />}
                />
              </span>
            </span>
            <GeneratedValue
              value={
                selectedFlow && !selectedFlow.enabled ? (
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                    <GeneratedText id="m_0ea7ffe3f671e7" />
                  </span>
                ) : null
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <GeneratedValue
              value={
                canEdit && selectedFlowId ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => addNode('trigger')}>
                      <Plus size={13} /> <GeneratedText id="m_1db1e5c9ca41ce" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => addNode('condition')}>
                      <Plus size={13} /> <GeneratedText id="m_0c33471afd0f99" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => addNode('gate')}>
                      <Plus size={13} /> <GeneratedText id="m_0f7bb45f90ba7e" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => addNode('action')}>
                      <Plus size={13} /> <GeneratedText id="m_0bad495a7046e9" />
                    </Button>
                  </>
                ) : null
              }
            />
            <GeneratedValue
              value={
                canEdit && selectedFlowId ? (
                  <Button variant="outline" size="sm" onClick={() => setShowTemplates(true)}>
                    <Rocket size={13} /> <GeneratedText id="m_0a19e6387037d4" />
                  </Button>
                ) : null
              }
            />
            <GeneratedValue
              value={
                canGenerate && selectedFlowId ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAi(true)}
                    disabled={pending}
                  >
                    <Sparkles size={13} /> <GeneratedText id="m_1e0a86199c09df" />
                  </Button>
                ) : null
              }
            />
            <GeneratedValue
              value={
                canEdit && selectedFlowId ? (
                  <Button size="sm" onClick={save} disabled={pending}>
                    <Save size={13} />{' '}
                    <GeneratedValue
                      value={
                        pending ? (
                          <GeneratedText id="m_106811f2aac664" />
                        ) : (
                          <GeneratedText id="m_19e6bff894c3c7" />
                        )
                      }
                    />
                  </Button>
                ) : null
              }
            />
          </div>
        </header>

        <div className="relative min-h-0 flex-1">
          <GeneratedValue
            value={
              selectedFlowId ? (
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
                  fitViewOptions={{ padding: 0.3, maxZoom: 0.8 }}
                  minZoom={0.2}
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
                      <GeneratedText id="m_1abfbb4f0b4f36" />
                    </p>
                    <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">
                      <GeneratedText id="m_028d6ce274ccaa" />
                    </p>
                  </div>
                </div>
              )
            }
          />

          <GeneratedValue
            value={
              selectedFlowId && nodes.length === 0 ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
                  <div className="pointer-events-auto w-full max-w-lg rounded-xl border border-dashed border-slate-300 bg-white/95 p-5 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900/95">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      <GeneratedText id="m_1df84b29521519" />
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      <GeneratedText id="m_139d4c0c9f7be0" />
                    </p>
                    <GeneratedValue
                      value={
                        canEdit ? (
                          <div className="mt-3 grid grid-cols-1 gap-2 text-left sm:grid-cols-2">
                            <GeneratedValue
                              value={FLOW_TEMPLATES.map((t) => (
                                <button
                                  key={t.key}
                                  type="button"
                                  onClick={() => applyTemplate(t)}
                                  className="rounded-lg border border-slate-200 bg-white p-2.5 transition hover:border-teal-400 hover:bg-teal-50/40 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-teal-600 dark:hover:bg-teal-950/40"
                                >
                                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                    <GeneratedValue value={t.label} />
                                  </div>
                                  <div className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                                    <GeneratedValue value={t.description} />
                                  </div>
                                </button>
                              ))}
                            />
                          </div>
                        ) : null
                      }
                    />
                  </div>
                </div>
              ) : null
            }
          />
        </div>
      </div>

      <Drawer
        open={selectedNode != null}
        onClose={() => setSelectedNodeId(null)}
        title={tGeneratedValue(
          selectedNode
            ? tGenerated('m_0a45a3f047a285', { value0: selectedNode.data.kind })
            : tGenerated('m_03a66f9d34ac7b'),
        )}
        size="sm"
        footer={
          selectedNode && canEdit ? (
            <Button variant="outline" onClick={() => removeNode(selectedNode.id)}>
              <Trash2 size={14} className="text-rose-500" /> <GeneratedText id="m_09838d30eb3121" />
            </Button>
          ) : null
        }
      >
        <GeneratedValue
          value={
            selectedNode ? (
              <NodeInspector
                data={selectedNode.data}
                fieldIds={fieldIds}
                actionFields={actionFields}
                availableFields={availableFields}
                profile={profile}
                emailTemplates={emailTemplates}
                pdfTemplates={pdfTemplates}
                targetApps={targetApps}
                recipientOptions={recipientOptions}
                readOnly={!canEdit}
                onChange={(d) => patchData(selectedNode.id, d)}
              />
            ) : null
          }
        />
      </Drawer>

      <Drawer
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        title={tGenerated('m_01a6df8deac3ad')}
        description={tGenerated('m_127e5a438a4764')}
        size="sm"
      >
        <div className="space-y-2">
          <GeneratedValue
            value={FLOW_TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => applyTemplate(t)}
                className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-teal-400 hover:bg-teal-50/40 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-teal-600 dark:hover:bg-teal-950/40"
              >
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  <GeneratedValue value={t.label} />
                </div>
                <div className="mt-0.5 text-xs leading-snug text-slate-500 dark:text-slate-400">
                  <GeneratedValue value={t.description} />
                </div>
              </button>
            ))}
          />
          <p className="pt-1 text-[11px] text-slate-400 dark:text-slate-500">
            <GeneratedText id="m_0be1be4daf3028" />
          </p>
        </div>
      </Drawer>

      <Drawer
        open={showAi}
        onClose={() => setShowAi(false)}
        title={tGenerated('m_0c24b0e0c8e0fa')}
        description={tGenerated('m_0d4729dfb8d8fa')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAi(false)} disabled={pending}>
              <GeneratedText id="m_112e2e8ecda428" />
            </Button>
            <Button onClick={runAi} disabled={pending || aiPrompt.trim().length < 4}>
              <Sparkles size={14} />{' '}
              <GeneratedValue
                value={
                  pending ? (
                    <GeneratedText id="m_11beb293de9d2d" />
                  ) : (
                    <GeneratedText id="m_1dbb9f90b1c6f2" />
                  )
                }
              />
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Textarea
            rows={4}
            value={aiPrompt}
            placeholder={tGenerated('m_01e855ecae74db')}
            onChange={(e) => setAiPrompt(e.target.value)}
          />
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            <GeneratedText id="m_06e04a2aa58e1f" />
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
  actionFields,
  availableFields,
  profile,
  emailTemplates,
  pdfTemplates,
  targetApps,
  recipientOptions,
  readOnly,
  onChange,
}: {
  data: NData
  fieldIds: string[]
  actionFields: ActionFieldOptions
  availableFields: { id: string; label: string }[]
  profile: FlowSubjectProfile
  emailTemplates: EmailTemplateOption[]
  pdfTemplates: PdfTemplateOption[]
  targetApps: TargetAppOption[]
  recipientOptions: RecipientOptions
  readOnly: boolean
  onChange: (d: NData) => void
}) {
  const tGenerated = useGeneratedTranslations()
  if (data.kind === 'trigger') {
    const t = data.trigger
    return (
      <div className="space-y-3">
        <Field label={tGenerated('m_13cc128f69897c')}>
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
            <GeneratedValue
              value={profile.triggers.map((tk) => (
                <option key={tk} value={tk}>
                  <GeneratedValue value={TRIGGER_LABEL[tk]} />
                </option>
              ))}
            />
          </Select>
        </Field>
        <GeneratedValue
          value={
            t.trigger === 'on_field_value' ? (
              <Field label={tGenerated('m_19a82ebc42ebe3')}>
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
            ) : null
          }
        />
        <GeneratedValue
          value={
            t.trigger === 'status_change' ? (
              <Field label={tGenerated('m_0b5f0bfe110fb9')}>
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
                  <GeneratedValue
                    value={(profile.statusValues ?? ['submitted']).map((s) => (
                      <option key={s} value={s}>
                        <GeneratedValue value={s.replace(/_/g, ' ')} />
                      </option>
                    ))}
                  />
                </Select>
              </Field>
            ) : null
          }
        />
        <GeneratedValue
          value={
            t.trigger === 'scheduled' ? (
              <Field label={tGenerated('m_18651428376053')}>
                <Input
                  value={t.cron}
                  disabled={readOnly}
                  onChange={(e) =>
                    onChange({
                      kind: 'trigger',
                      trigger: { ...t, cron: e.target.value },
                    })
                  }
                />
              </Field>
            ) : null
          }
        />
        <GeneratedValue
          value={
            t.trigger === 'manual' ? (
              <>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  <GeneratedText id="m_0acdcecd1c4f9c" />
                </p>
                <Field label={tGenerated('m_18b7c648c39e28')}>
                  <Input
                    value={t.label}
                    disabled={readOnly}
                    placeholder={tGenerated('m_120d9d75eb5980')}
                    onChange={(e) =>
                      onChange({ kind: 'trigger', trigger: { ...t, label: e.target.value } })
                    }
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label={tGenerated('m_03cf3a97d03fef')}>
                    <Select
                      value={t.variant ?? 'default'}
                      disabled={readOnly}
                      onChange={(e) =>
                        onChange({
                          kind: 'trigger',
                          trigger: {
                            ...t,
                            variant: e.target.value as NonNullable<typeof t.variant>,
                          },
                        })
                      }
                    >
                      <option value="default">
                        <GeneratedText id="m_18aec830eeb5e0" />
                      </option>
                      <option value="outline">
                        <GeneratedText id="m_1d2c6011d3c6c5" />
                      </option>
                      <option value="secondary">
                        <GeneratedText id="m_03ddba55e48f99" />
                      </option>
                      <option value="destructive">
                        <GeneratedText id="m_1d429c73b00a17" />
                      </option>
                    </Select>
                  </Field>
                  <Field label={tGenerated('m_158279b74f9a6e')}>
                    <Input
                      value={t.icon ?? ''}
                      disabled={readOnly}
                      placeholder={tGenerated('m_1498caf65a85c4')}
                      onChange={(e) =>
                        onChange({
                          kind: 'trigger',
                          trigger: {
                            ...t,
                            icon: e.target.value.trim() ? e.target.value : undefined,
                          },
                        })
                      }
                    />
                  </Field>
                </div>
                <Field label={tGenerated('m_01066829ab2176')}>
                  <Input
                    value={t.confirm ?? ''}
                    disabled={readOnly}
                    placeholder={tGenerated('m_1c97926a04b9c7')}
                    onChange={(e) =>
                      onChange({
                        kind: 'trigger',
                        trigger: {
                          ...t,
                          confirm: e.target.value.trim() ? e.target.value : undefined,
                        },
                      })
                    }
                  />
                </Field>
                <Field label={tGenerated('m_126e942baf656b')}>
                  <Input
                    type="number"
                    value={t.order ?? ''}
                    disabled={readOnly}
                    placeholder={tGenerated('m_0f137cab523375')}
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
                <Field label={tGenerated('m_0ef7e5f0c544da')}>
                  <LogicBuilder
                    rule={t.showIf}
                    availableFields={availableFields}
                    onChange={(rule) =>
                      onChange({ kind: 'trigger', trigger: { ...t, showIf: rule ?? undefined } })
                    }
                  />
                  <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                    <GeneratedText id="m_01a3b7ba2ed936" />
                    <GeneratedValue value={' '} />
                    <span className="font-mono">
                      <GeneratedValue value={t.buttonId} />
                    </span>
                  </p>
                </Field>
              </>
            ) : null
          }
        />
      </div>
    )
  }

  if (data.kind === 'condition') {
    return (
      <div className="space-y-3">
        <Field label={tGenerated('m_1d088977412efb')}>
          <Input
            value={data.label ?? ''}
            disabled={readOnly}
            onChange={(e) => onChange({ ...data, label: e.target.value })}
          />
        </Field>
        <Field label={tGenerated('m_16a46bc46302d1')}>
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
        <Field label={tGenerated('m_0decefd558c355')}>
          <Input
            value={g.title}
            disabled={readOnly}
            onChange={(e) => onChange({ kind: 'gate', gate: { ...g, title: e.target.value } })}
          />
        </Field>
        <Field label={tGenerated('m_1f4ba956f2ba0f')}>
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
            <option value="submitter">
              <GeneratedText id="m_0843afdac467b3" />
            </option>
            <option value="role">
              <GeneratedText id="m_129ae26b80600c" />
            </option>
          </Select>
        </Field>
        <GeneratedValue
          value={
            g.assignee.type === 'role' ? (
              <Field label={tGenerated('m_1099c1fe8b6614')}>
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
            ) : null
          }
        />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={!!g.signatureRequired}
            disabled={readOnly}
            onChange={(e) =>
              onChange({ kind: 'gate', gate: { ...g, signatureRequired: e.target.checked } })
            }
          />
          <GeneratedText id="m_02ffe91f500dc8" />
        </label>
      </div>
    )
  }

  // action
  return (
    <ActionInspector
      data={data}
      fieldIds={fieldIds}
      actionFields={actionFields}
      actions={profile.actions}
      emailTemplates={emailTemplates}
      pdfTemplates={pdfTemplates}
      targetApps={targetApps}
      recipientOptions={recipientOptions}
      readOnly={readOnly}
      onChange={onChange}
    />
  )
}

function ActionInspector({
  data,
  fieldIds,
  actionFields,
  actions,
  emailTemplates,
  pdfTemplates,
  targetApps,
  recipientOptions,
  readOnly,
  onChange,
}: {
  data: Extract<NData, { kind: 'action' }>
  fieldIds: string[]
  actionFields: ActionFieldOptions
  actions: ActionData['action'][]
  emailTemplates: EmailTemplateOption[]
  pdfTemplates: PdfTemplateOption[]
  targetApps: TargetAppOption[]
  recipientOptions: RecipientOptions
  readOnly: boolean
  onChange: (d: NData) => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
      const sourceHtml = serializeTemplateEditor(ed)
      const res = await compileEmailDesign(sourceHtml)
      if (!res.ok || !res.html || !res.sourceHtml) {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_002d59b20693c5')))
        return
      }
      set({ ...a, mode: 'design', sourceHtml: res.sourceHtml, compiledHtml: res.html })
      setDesignOpen(false)
    } finally {
      setDesignBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <GeneratedValue
        value={
          designOpen ? (
            <div className="fixed inset-0 z-[60] flex flex-col bg-white dark:bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 dark:border-slate-800">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  <GeneratedText id="m_1d8534a5e92ce6" />
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDesignOpen(false)}>
                    <GeneratedText id="m_112e2e8ecda428" />
                  </Button>
                  <Button size="sm" disabled={designBusy} onClick={saveDesign}>
                    <GeneratedValue
                      value={
                        designBusy ? (
                          <GeneratedText id="m_106811f2aac664" />
                        ) : (
                          <GeneratedText id="m_1f0e1a82c4aae4" />
                        )
                      }
                    />
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <EmailDesignBuilder
                  initialHtml={a.action === 'send_email' ? (a.sourceHtml ?? null) : null}
                  mergeFields={fieldIds.map((f) => ({ key: f }))}
                  onReady={(ed) => {
                    designRef.current = ed
                  }}
                />
              </div>
            </div>
          ) : null
        }
      />
      <Field label={tGenerated('m_0bad495a7046e9')}>
        <Select
          value={a.action}
          disabled={readOnly}
          onChange={(e) => set(defaultAction(e.target.value as ActionData['action'], actionFields))}
        >
          <GeneratedValue
            value={actionChoices.map((k) => (
              <option key={k} value={k}>
                <GeneratedValue value={ACTION_LABEL[k]} />
              </option>
            ))}
          />
        </Select>
      </Field>

      <GeneratedValue
        value={
          a.action === 'send_email' ? (
            <>
              <RecipientsEditor
                to={a.to}
                onChange={(to) => set({ ...a, to })}
                readOnly={readOnly}
                fieldIds={fieldIds}
                options={recipientOptions}
              />
              <Field label={tGenerated('m_079594be6652a8')}>
                <Select
                  value={a.channel ?? 'email'}
                  disabled={readOnly}
                  onChange={(e) =>
                    set({ ...a, channel: e.target.value as 'email' | 'sms' | 'in_app' })
                  }
                >
                  <option value="email">
                    <GeneratedText id="m_00a0ba9938bdff" />
                  </option>
                  <option value="sms">
                    <GeneratedText id="m_17bd56c098516e" />
                  </option>
                  <option value="in_app">
                    <GeneratedText id="m_0a215b3bc9f35d" />
                  </option>
                </Select>
              </Field>
              <Field
                label={tGeneratedValue(
                  (a.channel ?? 'email') === 'email'
                    ? tGenerated('m_03a92a8bba62c3')
                    : tGenerated('m_12449ce6dd3e47'),
                )}
              >
                <Select
                  value={a.mode ?? 'inline'}
                  disabled={readOnly}
                  onChange={(e) =>
                    set({ ...a, mode: e.target.value as 'inline' | 'template' | 'design' })
                  }
                >
                  <option value="inline">
                    <GeneratedText id="m_18f3929cd2537c" />
                  </option>
                  <option value="template">
                    <GeneratedText id="m_0e09fff41d755b" />
                  </option>
                  <option value="design">
                    <GeneratedText id="m_13c13756195a75" />
                  </option>
                </Select>
              </Field>
              <GeneratedValue
                value={
                  (a.mode ?? 'inline') === 'design' ? (
                    <>
                      <Field label={tGenerated('m_1928431de4aaf1')}>
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
                        <GeneratedValue
                          value={
                            a.compiledHtml ? (
                              <GeneratedText id="m_1ed448916bb007" />
                            ) : (
                              <GeneratedText id="m_1f13f5c3b87576" />
                            )
                          }
                        />
                      </Button>
                      <GeneratedValue
                        value={
                          a.compiledHtml ? (
                            <p className="text-xs text-emerald-600">
                              <GeneratedText id="m_1a12949487d961" />
                            </p>
                          ) : (
                            <p className="text-xs text-slate-400">
                              <GeneratedText id="m_00021f60b601ff" />
                            </p>
                          )
                        }
                      />
                    </>
                  ) : (a.mode ?? 'inline') === 'template' ? (
                    <>
                      <Field label={tGenerated('m_13704e4d90cde4')}>
                        <Select
                          value={a.templateId ?? ''}
                          disabled={readOnly}
                          onChange={(e) => set({ ...a, templateId: e.target.value })}
                        >
                          <option value="">
                            <GeneratedText id="m_0bb019e960f98f" />
                          </option>
                          <GeneratedValue
                            value={emailTemplates.map((t) => (
                              <option key={t.id} value={t.id}>
                                <GeneratedValue value={t.name} />
                              </option>
                            ))}
                          />
                        </Select>
                      </Field>
                      <GeneratedValue
                        value={
                          emailTemplates.length === 0 ? (
                            <p className="text-xs text-slate-400">
                              <GeneratedText id="m_01725f4d4cbece" />
                            </p>
                          ) : null
                        }
                      />
                      <Field label={tGenerated('m_0a88689556c4a0')}>
                        <Input
                          value={a.subjectOverride ?? ''}
                          disabled={readOnly}
                          onChange={(e) => set({ ...a, subjectOverride: e.target.value })}
                        />
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field label={tGenerated('m_1928431de4aaf1')}>
                        <Input
                          value={a.subject ?? ''}
                          disabled={readOnly}
                          onChange={(e) => set({ ...a, subject: e.target.value })}
                        />
                      </Field>
                      <Field label={tGenerated('m_18d98590ba5c28')}>
                        <Textarea
                          rows={4}
                          value={a.bodyTemplate ?? ''}
                          disabled={readOnly}
                          onChange={(e) => set({ ...a, bodyTemplate: e.target.value })}
                        />
                      </Field>
                    </>
                  )
                }
              />
              <Field label={tGenerated('m_04c18d4965cadc')}>
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={!!a.attachPdf}
                    disabled={readOnly}
                    onChange={(e) => set({ ...a, attachPdf: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <GeneratedText id="m_1afb19e2a3fd62" />
                </label>
              </Field>
              <GeneratedValue
                value={
                  a.attachPdf ? (
                    <Field label={tGenerated('m_0728ad8d6726a2')}>
                      <Select
                        value={
                          a.pdfTemplateId
                            ? `tpl:${a.pdfTemplateId}`
                            : a.pdfFormat === 'summary'
                              ? 'builtin:summary'
                              : 'builtin:auto'
                        }
                        disabled={readOnly}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v.startsWith('tpl:')) {
                            set({ ...a, pdfTemplateId: v.slice(4), pdfFormat: undefined })
                          } else if (v === 'builtin:summary') {
                            set({ ...a, pdfTemplateId: undefined, pdfFormat: 'summary' })
                          } else {
                            set({ ...a, pdfTemplateId: undefined, pdfFormat: undefined })
                          }
                        }}
                      >
                        <optgroup label={tGenerated('m_09bfd82959f8d2')}>
                          <option value="builtin:auto">
                            <GeneratedText id="m_108ad7daade605" />
                          </option>
                          <option value="builtin:summary">
                            <GeneratedText id="m_1e176804fc9121" />
                          </option>
                        </optgroup>
                        <GeneratedValue
                          value={
                            pdfTemplates.length > 0 ? (
                              <optgroup label={tGenerated('m_1bf56760eea2b5')}>
                                <GeneratedValue
                                  value={pdfTemplates.map((t) => (
                                    <option key={t.id} value={`tpl:${t.id}`}>
                                      {t.name}
                                    </option>
                                  ))}
                                />
                              </optgroup>
                            ) : null
                          }
                        />
                      </Select>
                    </Field>
                  ) : null
                }
              />
            </>
          ) : null
        }
      />

      <GeneratedValue
        value={
          a.action === 'create_capa' ? (
            <>
              <Field label={tGenerated('m_1b31092e597972')}>
                <Input
                  value={a.titleTemplate}
                  disabled={readOnly}
                  onChange={(e) => set({ ...a, titleTemplate: e.target.value })}
                />
              </Field>
              <Field label={tGenerated('m_168b365cc671bf')}>
                <Select
                  value={a.severity ?? 'medium'}
                  disabled={readOnly}
                  onChange={(e) =>
                    set({
                      ...a,
                      severity: e.target.value as 'low' | 'medium' | 'high' | 'critical',
                    })
                  }
                >
                  <GeneratedValue
                    value={['low', 'medium', 'high', 'critical'].map((s) => (
                      <option key={s} value={s}>
                        <GeneratedValue value={s} />
                      </option>
                    ))}
                  />
                </Select>
              </Field>
              <Field label={tGenerated('m_0b8592c90b3997')}>
                <Input
                  type="number"
                  value={a.dueInDays ?? ''}
                  disabled={readOnly}
                  onChange={(e) =>
                    set({
                      ...a,
                      dueInDays: e.target.value === '' ? undefined : Number(e.target.value),
                    })
                  }
                />
              </Field>
            </>
          ) : null
        }
      />

      <GeneratedValue
        value={
          a.action === 'create_incident' ? (
            <Field label={tGenerated('m_1b31092e597972')}>
              <Input
                value={a.titleTemplate}
                disabled={readOnly}
                onChange={(e) => set({ ...a, titleTemplate: e.target.value })}
              />
            </Field>
          ) : null
        }
      />

      <GeneratedValue
        value={
          a.action === 'notify_role' ? (
            <>
              <Field label={tGenerated('m_1099c1fe8b6614')}>
                <Input
                  value={a.role}
                  disabled={readOnly}
                  onChange={(e) => set({ ...a, role: e.target.value })}
                />
              </Field>
              <Field label={tGenerated('m_0e4ff640f8e7d6')}>
                <Input
                  value={a.message}
                  disabled={readOnly}
                  onChange={(e) => set({ ...a, message: e.target.value })}
                />
              </Field>
            </>
          ) : null
        }
      />

      <GeneratedValue
        value={
          a.action === 'set_field' ? (
            <>
              <Field label={tGenerated('m_1dfe960eaa6224')}>
                <Select
                  value={a.field}
                  disabled={readOnly}
                  onChange={(e) => set({ ...a, field: e.target.value })}
                >
                  <option value="">
                    <GeneratedText id="m_032878135217ad" />
                  </option>
                  <GeneratedValue
                    value={actionFields.writable.map((f) => (
                      <option key={f} value={f}>
                        <GeneratedValue value={f} />
                      </option>
                    ))}
                  />
                </Select>
              </Field>
              <Field label={tGenerated('m_1cc0e5e7b5f442')}>
                <Input
                  value={a.value.kind === 'literal' ? String(a.value.value ?? '') : ''}
                  disabled={readOnly}
                  onChange={(e) => set({ ...a, value: { kind: 'literal', value: e.target.value } })}
                />
              </Field>
            </>
          ) : null
        }
      />

      <GeneratedValue
        value={
          a.action === 'flag_non_compliant' ? (
            <Field label={tGenerated('m_1cd0901d5dfe1a')}>
              <Input
                value={a.reason ?? ''}
                disabled={readOnly}
                onChange={(e) => set({ ...a, reason: e.target.value })}
              />
            </Field>
          ) : null
        }
      />

      <GeneratedValue
        value={
          a.action === 'webhook' ? (
            <>
              <Field label={tGenerated('m_165a381fa8ae74')}>
                <Input
                  value={a.url}
                  disabled={readOnly}
                  onChange={(e) => set({ ...a, url: e.target.value })}
                />
              </Field>
              <Field label={tGenerated('m_0984e05d5d435f')}>
                <Select
                  value={a.method}
                  disabled={readOnly}
                  onChange={(e) => set({ ...a, method: e.target.value as 'POST' | 'PUT' })}
                >
                  <option value="POST">
                    <GeneratedText id="m_159218c6d22874" />
                  </option>
                  <option value="PUT">
                    <GeneratedText id="m_1fea6a0197a12d" />
                  </option>
                </Select>
              </Field>
            </>
          ) : null
        }
      />

      <GeneratedValue
        value={
          a.action === 'create_response' ? (
            <Field label={tGenerated('m_057778f7de97cd')}>
              <SearchSelect
                value={a.templateId}
                disabled={readOnly}
                options={targetApps.map((app) => ({ value: app.id, label: app.name }))}
                placeholder={tGenerated('m_1cc7bc088003bc')}
                sheetTitle="Target app"
                ariaLabel="Target app"
                onChange={(templateId) => set({ ...a, templateId })}
              />
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                <GeneratedText id="m_0569fdc1833cbf" />
              </p>
            </Field>
          ) : null
        }
      />

      <GeneratedValue
        value={
          a.action === 'analyze_photos' ? (
            <>
              <Field label={tGenerated('m_0bb985b1bd9e88')}>
                <Select
                  value={a.fieldId}
                  disabled={readOnly}
                  onChange={(e) => set({ ...a, fieldId: e.target.value })}
                >
                  <option value="">
                    <GeneratedText id="m_032878135217ad" />
                  </option>
                  <GeneratedValue
                    value={actionFields.photoSources.map((f) => (
                      <option key={f} value={f}>
                        <GeneratedValue value={f} />
                      </option>
                    ))}
                  />
                </Select>
              </Field>
              <Field label={tGenerated('m_108b4cbe4ba75e')}>
                <Select
                  value={a.storeInField ?? ''}
                  disabled={readOnly}
                  onChange={(e) => set({ ...a, storeInField: e.target.value || undefined })}
                >
                  <option value="">
                    <GeneratedText id="m_0206c945814606" />
                  </option>
                  <GeneratedValue
                    value={actionFields.textOutputs.map((f) => (
                      <option key={f} value={f}>
                        <GeneratedValue value={f} />
                      </option>
                    ))}
                  />
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={!!a.createCapaOnHazard}
                  disabled={readOnly}
                  onChange={(e) => set({ ...a, createCapaOnHazard: e.target.checked })}
                />
                <GeneratedText id="m_1fb66407994e0c" />
              </label>
              <GeneratedValue
                value={
                  a.createCapaOnHazard ? (
                    <Field label={tGenerated('m_0ac24b7d0c1efa')}>
                      <Select
                        value={a.minSeverity ?? 'medium'}
                        disabled={readOnly}
                        onChange={(e) =>
                          set({ ...a, minSeverity: e.target.value as 'low' | 'medium' | 'high' })
                        }
                      >
                        <option value="low">
                          <GeneratedText id="m_1ccf901a8121fe" />
                        </option>
                        <option value="medium">
                          <GeneratedText id="m_1afce6ddb08ea6" />
                        </option>
                        <option value="high">
                          <GeneratedText id="m_0f4dbfdc81213e" />
                        </option>
                      </Select>
                    </Field>
                  ) : null
                }
              />
            </>
          ) : null
        }
      />

      <GeneratedValue
        value={
          a.action === 'start_monitored_session' ? (
            <>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_06251479eec41c" />
              </p>
              <MonitorNum
                label={tGenerated('m_059b9458e92a71')}
                value={a.intervalMinutes}
                fieldKey={a.intervalFieldKey}
                fieldIds={actionFields.numeric}
                readOnly={readOnly}
                onValue={(v) => set({ ...a, intervalMinutes: Math.max(1, v) })}
                onField={(k) => set({ ...a, intervalFieldKey: k })}
              />
              <MonitorNum
                label={tGenerated('m_1bc3a7ded730b8')}
                value={a.graceMinutes}
                fieldKey={a.graceFieldKey}
                fieldIds={actionFields.numeric}
                readOnly={readOnly}
                onValue={(v) => set({ ...a, graceMinutes: Math.max(0, v) })}
                onField={(k) => set({ ...a, graceFieldKey: k })}
              />
              <MonitorNum
                label={tGenerated('m_0d9d758963404e')}
                value={a.durationMinutes ?? 0}
                fieldKey={a.durationFieldKey}
                fieldIds={actionFields.numeric}
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
                <GeneratedText id="m_1d75b79556863c" />
              </label>
            </>
          ) : null
        }
      />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <Field label={tGeneratedValue(label)}>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min="0"
          className="h-8 w-20"
          value={String(value)}
          disabled={readOnly || !!fieldKey}
          onChange={(e) => onValue(Math.floor(Number(e.target.value) || 0))}
        />
        <span className="text-xs text-slate-400 dark:text-slate-500">
          <GeneratedText id="m_0e0bbc9cd7e263" />
        </span>
        <Select
          className="h-8 flex-1"
          value={fieldKey ?? ''}
          disabled={readOnly}
          onChange={(e) => onField(e.target.value || undefined)}
        >
          <option value="">
            <GeneratedText id="m_196dad6c0c06ea" />
          </option>
          <GeneratedValue
            value={fieldIds.map((f) => (
              <option key={f} value={f}>
                <GeneratedText id="m_07260ef1b27100" /> <GeneratedValue value={f} />
              </option>
            ))}
          />
        </Select>
      </div>
    </Field>
  )
}

function defaultAction(kind: ActionData['action'], fields: ActionFieldOptions): ActionData {
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
        field: fields.writable[0] ?? '',
        value: { kind: 'literal', value: '' },
      }
    case 'flag_non_compliant':
      return { action: 'flag_non_compliant' }
    case 'webhook':
      return { action: 'webhook', url: '', method: 'POST' }
    case 'create_response':
      return { action: 'create_response', templateId: '' }
    case 'analyze_photos':
      return { action: 'analyze_photos', fieldId: fields.photoSources[0] ?? '' }
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
      <Label className="text-xs">
        <GeneratedValue value={label} />
      </Label>
      <GeneratedValue value={children} />
    </div>
  )
}
