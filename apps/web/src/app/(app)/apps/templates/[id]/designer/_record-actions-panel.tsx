'use client'

// Record actions panel — the "Actions" left-rail tab in the App designer.
//
// Manages the BUTTONS that appear on a record. Each button is a `manual`-trigger
// flow in form_automations: a trigger node ({ trigger:'manual', buttonId, label,
// icon?, variant?, order? }) wired by one edge to a single action node. The
// record page renders one button per manual flow and runs that flow's branch on
// click (planAutomation(graph, 'manual', ctx, { buttonId })).
//
// This panel is a quick author: list existing buttons (enable / disable / open
// in Flows / delete) and a small form to add one. Anything richer — conditions,
// gates, multi-step branches — is edited on the full Flows canvas.

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Button, Input, Label, Select } from '@beaconhs/ui'
import { ExternalLink, MousePointerClick, Plus, Trash2 } from 'lucide-react'
import {
  FORM_TEMPLATE_ACTIONS,
  type ActionData,
  type AutomationGraph,
  type TriggerData,
} from '@beaconhs/forms-core'
import { toast } from '@/lib/toast'
import { confirmDialog } from '@/lib/confirm'
import { createFlow, deleteFlow, saveFlow, setFlowEnabled } from '@/lib/flows/flow-crud'
import { slugify } from '@/app/(app)/apps/_lib/slug'
import type { FlowSummary } from '../flows/_flows-canvas'

type ButtonVariant = NonNullable<Extract<TriggerData, { trigger: 'manual' }>['variant']>

// Human labels for every action a record button can run.
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
  export_pdf: 'Generate PDF',
}

const VARIANTS: { value: ButtonVariant; label: string }[] = [
  { value: 'default', label: 'Primary' },
  { value: 'outline', label: 'Outline' },
  { value: 'secondary', label: 'Secondary' },
  { value: 'destructive', label: 'Destructive' },
]

// Minimal valid action object for each kind — mirrors the Flows canvas
// `defaultAction`. The author refines it on the full canvas.
function defaultAction(kind: ActionData['action']): ActionData {
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
      return { action: 'set_field', field: '', value: { kind: 'literal', value: '' } }
    case 'flag_non_compliant':
      return { action: 'flag_non_compliant' }
    case 'webhook':
      return { action: 'webhook', url: '', method: 'POST' }
    case 'create_response':
      return { action: 'create_response', templateId: '' }
    case 'analyze_photos':
      return { action: 'analyze_photos', fieldId: '' }
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

// A url-safe, stable button id derived from the label.
function buttonIdFromLabel(label: string): string {
  const base = slugify(label)
  return `btn_${base || Math.random().toString(36).slice(2, 8)}`
}

// Pull the (single) manual trigger out of a flow graph, if any.
function manualTrigger(graph: AutomationGraph): Extract<TriggerData, { trigger: 'manual' }> | null {
  for (const n of graph.nodes) {
    if (n.data.kind === 'trigger' && n.data.trigger.trigger === 'manual') return n.data.trigger
  }
  return null
}

// The first action a manual flow runs (for the list summary).
function firstActionLabel(graph: AutomationGraph): string {
  const node = graph.nodes.find((n) => n.data.kind === 'action')
  if (node && node.data.kind === 'action') return ACTION_LABEL[node.data.action.action]
  return 'No action yet'
}

function buildButtonGraph(input: {
  label: string
  icon?: string
  variant: ButtonVariant
  actionKind: ActionData['action']
  order: number
}): AutomationGraph {
  const trigger: TriggerData = {
    trigger: 'manual',
    buttonId: buttonIdFromLabel(input.label),
    label: input.label.trim(),
    variant: input.variant,
    order: input.order,
    ...(input.icon?.trim() ? { icon: input.icon.trim() } : {}),
  }
  return {
    schemaVersion: 1,
    nodes: [
      { id: 'trg', position: { x: 80, y: 80 }, data: { kind: 'trigger', trigger } },
      {
        id: 'act',
        position: { x: 400, y: 80 },
        data: { kind: 'action', action: defaultAction(input.actionKind) },
      },
    ],
    edges: [{ id: 'e1', source: 'trg', target: 'act', sourceHandle: 'next' }],
  }
}

export function RecordActionsPanel({
  templateId,
  flows,
}: {
  templateId: string
  flows: FlowSummary[]
}) {
  // Only manual-trigger flows are record buttons. Order by the trigger's `order`
  // then name, so the panel mirrors the record bar.
  const buttons = useMemo(() => {
    return flows
      .map((f) => ({ flow: f, trigger: manualTrigger(f.graph) }))
      .filter(
        (b): b is { flow: FlowSummary; trigger: Extract<TriggerData, { trigger: 'manual' }> } =>
          b.trigger != null,
      )
      .sort((a, b) => (a.trigger.order ?? 0) - (b.trigger.order ?? 0))
  }, [flows])

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Buttons people see on a record. Each runs a flow on click — create a CAPA, send an email,
        change status, and more. Add one here, then refine its logic in Flows.
      </p>

      <ButtonList templateId={templateId} buttons={buttons} />

      <AddButtonForm templateId={templateId} nextOrder={buttons.length} />
    </div>
  )
}

function ButtonList({
  templateId,
  buttons,
}: {
  templateId: string
  buttons: { flow: FlowSummary; trigger: Extract<TriggerData, { trigger: 'manual' }> }[]
}) {
  const [pending, start] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  const toggle = (id: string, enabled: boolean) => {
    setBusyId(id)
    start(async () => {
      const res = await setFlowEnabled(id, enabled)
      setBusyId(null)
      if (!res.ok) {
        toast.error('Could not update the button')
        return
      }
      toast.success(enabled ? 'Button enabled' : 'Button disabled')
      // Reflect the change without a full reload.
      window.location.reload()
    })
  }

  const remove = async (id: string, label: string) => {
    if (!(await confirmDialog({ message: `Delete the “${label}” button? Its flow is removed too.`, tone: 'danger' })))
      return
    setBusyId(id)
    start(async () => {
      const res = await deleteFlow(id)
      setBusyId(null)
      if (!res.ok) {
        toast.error('Could not delete the button')
        return
      }
      toast.success('Button deleted')
      window.location.reload()
    })
  }

  if (buttons.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
        No action buttons yet.
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {buttons.map(({ flow, trigger }) => (
        <li key={flow.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-200">
                <MousePointerClick size={13} className="shrink-0 text-slate-400" />
                <span className="truncate">{trigger.label || 'Untitled button'}</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {firstActionLabel(flow.graph)}
                {!flow.enabled ? (
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    Disabled
                  </span>
                ) : null}
              </div>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
              <input
                type="checkbox"
                checked={flow.enabled}
                disabled={pending && busyId === flow.id}
                onChange={(e) => toggle(flow.id, e.target.checked)}
              />
              On
            </label>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Link
              href={`/apps/templates/${templateId}/designer?surface=flows`}
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline dark:text-teal-300"
            >
              <ExternalLink size={12} /> Edit as flow
            </Link>
            <button
              type="button"
              onClick={() => remove(flow.id, trigger.label || 'this')}
              disabled={pending && busyId === flow.id}
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:underline disabled:opacity-50 dark:text-rose-400"
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function AddButtonForm({ templateId, nextOrder }: { templateId: string; nextOrder: number }) {
  const [label, setLabel] = useState('')
  const [actionKind, setActionKind] = useState<ActionData['action']>('change_status')
  const [icon, setIcon] = useState('')
  const [variant, setVariant] = useState<ButtonVariant>('default')
  const [pending, start] = useTransition()

  const add = () => {
    const trimmed = label.trim()
    if (trimmed.length < 2) {
      toast.error('Give the button a label')
      return
    }
    start(async () => {
      const created = await createFlow({ type: 'form_template', key: templateId }, trimmed)
      if (!created.ok || !created.id) {
        toast.error(created.error ?? 'Could not create the button')
        return
      }
      const graph = buildButtonGraph({
        label: trimmed,
        icon,
        variant,
        actionKind,
        order: nextOrder,
      })
      const saved = await saveFlow(created.id, graph)
      if (!saved.ok) {
        toast.error(saved.error ?? 'Could not save the button')
        return
      }
      toast.success('Button added')
      window.location.reload()
    })
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
      <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
        Add action button
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Label</Label>
        <Input
          value={label}
          placeholder="e.g. Close out, Raise CAPA"
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Runs</Label>
        <Select
          value={actionKind}
          onChange={(e) => setActionKind(e.target.value as ActionData['action'])}
        >
          {FORM_TEMPLATE_ACTIONS.map((k) => (
            <option key={k} value={k}>
              {ACTION_LABEL[k]}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Style</Label>
          <Select value={variant} onChange={(e) => setVariant(e.target.value as ButtonVariant)}>
            {VARIANTS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Icon</Label>
          <Input
            value={icon}
            placeholder="Optional, e.g. check"
            onChange={(e) => setIcon(e.target.value)}
          />
        </div>
      </div>
      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        Icon names follow lucide (e.g. <span className="font-mono">check</span>,{' '}
        <span className="font-mono">file-text</span>). The action&apos;s details are set in Flows.
      </p>
      <Button onClick={add} disabled={pending} className="w-full">
        <Plus size={14} /> {pending ? 'Adding…' : 'Add button'}
      </Button>
    </div>
  )
}
