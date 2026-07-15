'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
import { type ActionData, type AutomationGraph, type TriggerData } from '@beaconhs/forms-core'
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

const QUICK_ACTIONS = [
  'flag_non_compliant',
  'start_monitored_session',
  'duplicate_record',
  'export_pdf',
] as const satisfies readonly ActionData['action'][]
type QuickAction = (typeof QUICK_ACTIONS)[number]

// Minimal valid action object for each kind — mirrors the Flows canvas
// `defaultAction`. The author refines it on the full canvas.
function defaultAction(kind: QuickAction): ActionData {
  switch (kind) {
    case 'flag_non_compliant':
      return { action: 'flag_non_compliant' }
    case 'start_monitored_session':
      return {
        action: 'start_monitored_session',
        intervalMinutes: 30,
        graceMinutes: 10,
        durationMinutes: 120,
        requireGeo: false,
      }
    case 'duplicate_record':
      return { action: 'duplicate_record' }
    case 'export_pdf':
      return { action: 'export_pdf' }
  }
}

// A url-safe, stable button id derived from the label.
function buttonIdFromLabel(label: string): string {
  const base = slugify(label)
  return `btn_${base || globalThis.crypto.randomUUID().slice(0, 8)}`
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
  actionKind: QuickAction
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
        <GeneratedText id="m_04c26741b8a61a" />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [pending, start] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  const toggle = (id: string, enabled: boolean) => {
    setBusyId(id)
    start(async () => {
      const res = await setFlowEnabled(id, enabled)
      setBusyId(null)
      if (!res.ok) {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0ace7111b8a4ca')))
        return
      }
      toast.success(
        tGeneratedValue(enabled ? tGenerated('m_17a1ffe7b619a7') : tGenerated('m_1263bc1887a413')),
      )
      // Reflect the change without a full reload.
      window.location.reload()
    })
  }

  const remove = async (id: string, label: string) => {
    if (
      !(await confirmDialog({
        message: `Delete the “${label}” button? Its flow is removed too.`,
        tone: 'danger',
      }))
    )
      return
    setBusyId(id)
    start(async () => {
      const res = await deleteFlow(id)
      setBusyId(null)
      if (!res.ok) {
        toast.error(tGenerated('m_065983a28dd74f'))
        return
      }
      toast.success(tGenerated('m_17a3631fb2f4e4'))
      window.location.reload()
    })
  }

  if (buttons.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
        <GeneratedText id="m_1e0d6150fa36c1" />
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      <GeneratedValue
        value={buttons.map(({ flow, trigger }) => (
          <li
            key={flow.id}
            className="rounded-md border border-slate-200 p-3 dark:border-slate-700"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-200">
                  <MousePointerClick size={13} className="shrink-0 text-slate-400" />
                  <span className="truncate">
                    <GeneratedValue
                      value={trigger.label || <GeneratedText id="m_177ebf9909c429" />}
                    />
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  <GeneratedValue value={firstActionLabel(flow.graph)} />
                  <GeneratedValue
                    value={
                      !flow.enabled ? (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          <GeneratedText id="m_0ea7ffe3f671e7" />
                        </span>
                      ) : null
                    }
                  />
                </div>
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={flow.enabled}
                  disabled={pending && busyId === flow.id}
                  onChange={(e) => toggle(flow.id, e.target.checked)}
                />
                <GeneratedText id="m_0738c9c7544385" />
              </label>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Link
                href={`/apps/templates/${templateId}/designer?surface=flows`}
                className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline dark:text-teal-300"
              >
                <ExternalLink size={12} /> <GeneratedText id="m_1f5548c5f64859" />
              </Link>
              <button
                type="button"
                onClick={() => remove(flow.id, trigger.label || 'this')}
                disabled={pending && busyId === flow.id}
                className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:underline disabled:opacity-50 dark:text-rose-400"
              >
                <Trash2 size={12} /> <GeneratedText id="m_11773f3c3f7558" />
              </button>
            </div>
          </li>
        ))}
      />
    </ul>
  )
}

function AddButtonForm({ templateId, nextOrder }: { templateId: string; nextOrder: number }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [label, setLabel] = useState('')
  const [actionKind, setActionKind] = useState<QuickAction>('export_pdf')
  const [icon, setIcon] = useState('')
  const [variant, setVariant] = useState<ButtonVariant>('default')
  const [pending, start] = useTransition()

  const add = () => {
    const trimmed = label.trim()
    if (trimmed.length < 2) {
      toast.error(tGenerated('m_1679c2ed292c3d'))
      return
    }
    start(async () => {
      const created = await createFlow({ type: 'form_template', key: templateId }, trimmed)
      if (!created.ok || !created.id) {
        toast.error(tGeneratedValue(created.error ?? tGenerated('m_158f2495bcddb0')))
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
        await deleteFlow(created.id)
        toast.error(tGeneratedValue(saved.error ?? tGenerated('m_1da8a415304d10')))
        return
      }
      const enabled = await setFlowEnabled(created.id, true)
      if (!enabled.ok) {
        toast.error(tGeneratedValue(enabled.error ?? tGenerated('m_0f6e0471488eed')))
        return
      }
      toast.success(tGenerated('m_0aeca8ac2599fe'))
      window.location.reload()
    })
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
      <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
        <GeneratedText id="m_05253329e74fe1" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">
          <GeneratedText id="m_1d088977412efb" />
        </Label>
        <Input
          value={label}
          placeholder={tGenerated('m_0fa92e5594b03b')}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">
          <GeneratedText id="m_142e7fa174a9b9" />
        </Label>
        <Select value={actionKind} onChange={(e) => setActionKind(e.target.value as QuickAction)}>
          <GeneratedValue
            value={QUICK_ACTIONS.map((k) => (
              <option key={k} value={k}>
                <GeneratedValue value={ACTION_LABEL[k]} />
              </option>
            ))}
          />
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">
            <GeneratedText id="m_03cf3a97d03fef" />
          </Label>
          <Select value={variant} onChange={(e) => setVariant(e.target.value as ButtonVariant)}>
            <GeneratedValue
              value={VARIANTS.map((v) => (
                <option key={v.value} value={v.value}>
                  <GeneratedValue value={v.label} />
                </option>
              ))}
            />
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            <GeneratedText id="m_158279b74f9a6e" />
          </Label>
          <Input
            value={icon}
            placeholder={tGenerated('m_0627f8a8876dd0')}
            onChange={(e) => setIcon(e.target.value)}
          />
        </div>
      </div>
      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        <GeneratedText id="m_073488ed2e8c75" />
        <GeneratedValue value={' '} />
        <span className="font-mono">
          <GeneratedText id="m_1cfe02e5abf380" />
        </span>
        ).
      </p>
      <Button onClick={add} disabled={pending} className="w-full">
        <Plus size={14} />{' '}
        <GeneratedValue
          value={
            pending ? (
              <GeneratedText id="m_184412952a7847" />
            ) : (
              <GeneratedText id="m_0736cc3d80b217" />
            )
          }
        />
      </Button>
    </div>
  )
}
