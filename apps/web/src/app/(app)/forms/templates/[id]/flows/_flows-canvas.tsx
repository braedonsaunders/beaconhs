'use client'

// Flows canvas — the n8n-style visual automation builder for an App.
// Node graph: Trigger → Condition / Gate / Action. Conditions branch then/else;
// Gates (human approve/reject) branch approve/reject. Persists the graph to
// form_automations. Nodes are real React components, so the Condition inspector
// reuses the existing LogicBuilder. Authoring only — execution is server-side.

import { useCallback, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
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
  Zap,
} from 'lucide-react'
import { Button, Drawer, Input, Label, Select, Textarea } from '@beaconhs/ui'
import type { ActionData, AutomationGraph, AutomationNode, TriggerData } from '@beaconhs/forms-core'
import { emptyAutomationGraph } from '@beaconhs/forms-core'
import { LogicBuilder } from '../designer/logic-builder'
import { toast } from '@/lib/toast'
import { createFlow, deleteFlow, renameFlow, saveFlow, setFlowEnabled } from './_actions'
import { generateFlowDraft } from '../../../_ai-actions'

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
}

const CARD = 'rounded-lg border bg-white px-3 py-2 text-xs shadow-sm w-48'
const HANDLE = { width: 9, height: 9 }

function TriggerNode({ data, selected }: NodeProps) {
  const d = data as Extract<NData, { kind: 'trigger' }>
  return (
    <div
      className={`${CARD} ${selected ? 'border-teal-500 ring-1 ring-teal-500' : 'border-emerald-300'}`}
    >
      <div className="flex items-center gap-1.5 font-semibold text-emerald-700">
        <Zap size={13} /> Trigger
      </div>
      <div className="mt-0.5 truncate text-slate-600">{triggerSummary(d.trigger)}</div>
      <Handle type="source" position={Position.Right} id="next" style={HANDLE} />
    </div>
  )
}

function ConditionNode({ data, selected }: NodeProps) {
  const d = data as Extract<NData, { kind: 'condition' }>
  return (
    <div
      className={`${CARD} ${selected ? 'border-teal-500 ring-1 ring-teal-500' : 'border-amber-300'}`}
    >
      <Handle type="target" position={Position.Left} style={HANDLE} />
      <div className="flex items-center gap-1.5 font-semibold text-amber-700">
        <GitBranch size={13} /> Condition
      </div>
      <div className="mt-0.5 truncate text-slate-600">{d.label || 'If…'}</div>
      <Handle type="source" position={Position.Right} id="then" style={{ ...HANDLE, top: '38%' }} />
      <Handle type="source" position={Position.Right} id="else" style={{ ...HANDLE, top: '70%' }} />
    </div>
  )
}

function GateNode({ data, selected }: NodeProps) {
  const d = data as Extract<NData, { kind: 'gate' }>
  return (
    <div
      className={`${CARD} ${selected ? 'border-teal-500 ring-1 ring-teal-500' : 'border-violet-300'}`}
    >
      <Handle type="target" position={Position.Left} style={HANDLE} />
      <div className="flex items-center gap-1.5 font-semibold text-violet-700">
        <ShieldCheck size={13} /> Approval
      </div>
      <div className="mt-0.5 truncate text-slate-600">{d.gate.title || 'Approve / reject'}</div>
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
      className={`${CARD} ${selected ? 'border-teal-500 ring-1 ring-teal-500' : 'border-sky-300'}`}
    >
      <Handle type="target" position={Position.Left} style={HANDLE} />
      <div className="flex items-center gap-1.5 font-semibold text-sky-700">
        <Mail size={13} /> Action
      </div>
      <div className="mt-0.5 truncate text-slate-600">{ACTION_LABEL[d.action.action]}</div>
      <Handle type="source" position={Position.Right} id="next" style={HANDLE} />
    </div>
  )
}

// --- Default node data ------------------------------------------------------

function defaultData(kind: NData['kind'], firstField: string): NData {
  switch (kind) {
    case 'trigger':
      return { kind: 'trigger', trigger: { trigger: 'on_submit' } }
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
        action: {
          action: 'send_email',
          to: [{ type: 'submitter' }],
          subject: '',
          bodyTemplate: '',
        },
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
        checked ? 'bg-teal-500' : 'bg-slate-300'
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
]

export function FlowsCanvas({
  templateId,
  templateName,
  fieldIds,
  flows,
  canEdit,
  canGenerate,
  embedded = false,
}: {
  templateId: string
  templateName: string
  fieldIds: string[]
  flows: FlowSummary[]
  canEdit: boolean
  canGenerate: boolean
  // When rendered inside the unified App editor, hide the standalone back link
  // + the redundant "templateName ·" prefix (the editor header already has it).
  embedded?: boolean
}) {
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

  const nodeTypes = useMemo(
    () => ({ trigger: TriggerNode, condition: ConditionNode, gate: GateNode, action: ActionNode }),
    [],
  )

  const availableFields = useMemo(() => fieldIds.map((id) => ({ id, label: id })), [fieldIds])
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
      const res = await createFlow(templateId, 'New flow')
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
      data: defaultData(kind, fieldIds[0] ?? ''),
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
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <Workflow size={13} /> Flows
          </span>
          {canEdit ? (
            <button
              type="button"
              onClick={addFlow}
              disabled={pending}
              title="New flow"
              className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-700 disabled:opacity-50"
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
                    active ? 'bg-white shadow-sm ring-1 ring-teal-300' : 'hover:bg-white/70'
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
                        f.enabled ? 'text-slate-700' : 'text-slate-400 line-through'
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
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            {embedded ? null : (
              <>
                <Link
                  href={`/forms/templates/${templateId}`}
                  title="Back to app"
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  <ArrowLeft size={15} />
                  <span className="hidden sm:inline">Back</span>
                </Link>
                <span className="h-4 w-px bg-slate-200" />
              </>
            )}
            <span className="min-w-0 truncate">
              {embedded ? null : <span className="font-semibold">{templateName}</span>}{' '}
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
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable />
            </ReactFlow>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
                <p className="text-sm font-medium text-slate-700">No flow selected</p>
                <p className="mt-1 max-w-xs text-xs text-slate-500">
                  Create a flow on the left to start building automations for this App.
                </p>
              </div>
            </div>
          )}

          {selectedFlowId && nodes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
              <div className="pointer-events-auto w-full max-w-lg rounded-xl border border-dashed border-slate-300 bg-white/95 p-5 text-center shadow-sm">
                <p className="text-sm font-semibold text-slate-700">Start with a template</p>
                <p className="mt-1 text-xs text-slate-500">
                  Pick a common automation, or build from scratch with the toolbar / AI.
                </p>
                {canEdit ? (
                  <div className="mt-3 grid grid-cols-1 gap-2 text-left sm:grid-cols-2">
                    {FLOW_TEMPLATES.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => applyTemplate(t)}
                        className="rounded-lg border border-slate-200 bg-white p-2.5 transition hover:border-teal-400 hover:bg-teal-50/40"
                      >
                        <div className="text-xs font-semibold text-slate-800">{t.label}</div>
                        <div className="mt-0.5 text-[11px] leading-snug text-slate-500">
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
              className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-teal-400 hover:bg-teal-50/40"
            >
              <div className="text-sm font-semibold text-slate-800">{t.label}</div>
              <div className="mt-0.5 text-xs leading-snug text-slate-500">{t.description}</div>
            </button>
          ))}
          <p className="pt-1 text-[11px] text-slate-400">
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
          <p className="text-[11px] text-slate-400">
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
  readOnly,
  onChange,
}: {
  data: NData
  fieldIds: string[]
  availableFields: { id: string; label: string }[]
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
              const next: TriggerData =
                v === 'on_field_value'
                  ? { trigger: 'on_field_value', rule: { op: 'isSet', field: fieldIds[0] ?? '' } }
                  : v === 'status_change'
                    ? { trigger: 'status_change', to: 'submitted' }
                    : v === 'scheduled'
                      ? { trigger: 'scheduled', cron: '0 8 * * 1' }
                      : { trigger: 'on_submit' }
              onChange({ kind: 'trigger', trigger: next })
            }}
          >
            <option value="on_submit">A response is submitted</option>
            <option value="on_field_value">A field matches a condition</option>
            <option value="status_change">Status changes</option>
            <option value="scheduled">On a schedule</option>
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
              {['submitted', 'in_review', 'closed', 'rejected', 'non_compliant'].map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
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
  return <ActionInspector data={data} fieldIds={fieldIds} readOnly={readOnly} onChange={onChange} />
}

function ActionInspector({
  data,
  fieldIds,
  readOnly,
  onChange,
}: {
  data: Extract<NData, { kind: 'action' }>
  fieldIds: string[]
  readOnly: boolean
  onChange: (d: NData) => void
}) {
  const a = data.action
  const set = (action: ActionData) => onChange({ kind: 'action', action })
  return (
    <div className="space-y-3">
      <Field label="Action">
        <Select
          value={a.action}
          disabled={readOnly}
          onChange={(e) => set(defaultAction(e.target.value as ActionData['action'], fieldIds))}
        >
          {(Object.keys(ACTION_LABEL) as ActionData['action'][]).map((k) => (
            <option key={k} value={k}>
              {ACTION_LABEL[k]}
            </option>
          ))}
        </Select>
      </Field>

      {a.action === 'send_email' ? (
        <>
          <Field label="Recipient">
            <Select
              value={a.to[0]?.type ?? 'submitter'}
              disabled={readOnly}
              onChange={(e) =>
                set({
                  ...a,
                  to: [
                    e.target.value === 'role'
                      ? { type: 'role', role: '' }
                      : e.target.value === 'literal'
                        ? { type: 'literal', email: '' }
                        : { type: 'submitter' },
                  ],
                })
              }
            >
              <option value="submitter">The submitter</option>
              <option value="role">A role</option>
              <option value="literal">A specific email</option>
            </Select>
          </Field>
          {a.to[0]?.type === 'role' ? (
            <Field label="Role">
              <Input
                value={a.to[0].role}
                disabled={readOnly}
                onChange={(e) => set({ ...a, to: [{ type: 'role', role: e.target.value }] })}
              />
            </Field>
          ) : null}
          {a.to[0]?.type === 'literal' ? (
            <Field label="Email">
              <Input
                value={a.to[0].email}
                disabled={readOnly}
                onChange={(e) => set({ ...a, to: [{ type: 'literal', email: e.target.value }] })}
              />
            </Field>
          ) : null}
          <Field label="Subject">
            <Input
              value={a.subject}
              disabled={readOnly}
              onChange={(e) => set({ ...a, subject: e.target.value })}
            />
          </Field>
          <Field label="Body (supports {{field_id}})">
            <Textarea
              rows={4}
              value={a.bodyTemplate}
              disabled={readOnly}
              onChange={(e) => set({ ...a, bodyTemplate: e.target.value })}
            />
          </Field>
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
    </div>
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
