'use client'

// Confirm card for a drafted (proposed) write. The draft tool returns a signed
// proposal in its output; this renders the preview + Apply/Discard. The real
// mutation happens only in _commit-actions.ts after the user clicks Apply.

import { useState, useTransition } from 'react'
import { Check, ExternalLink, FileWarning, Sparkles } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { commitCorrectiveAction, commitIncident, type CommitResult } from '../_commit-actions'

export type ProposalData = {
  kind: string
  preview: Record<string, unknown>
  confirmToken: string
}

/** Extract a proposal from a tool output, if present. */
export function proposalFromOutput(output: unknown): ProposalData | null {
  if (!output || typeof output !== 'object') return null
  const o = output as Record<string, unknown>
  const data = (o.data ?? null) as Record<string, unknown> | null
  const proposed =
    data && typeof data === 'object' ? (data.proposed as ProposalData | undefined) : undefined
  if (
    proposed &&
    typeof proposed === 'object' &&
    typeof proposed.kind === 'string' &&
    typeof proposed.confirmToken === 'string'
  ) {
    return proposed
  }
  return null
}

const KIND_LABEL: Record<string, string> = {
  create_corrective_action: 'Corrective action',
  create_incident: 'Incident report',
}

function humanize(v: unknown): string {
  return typeof v === 'string' ? v.replace(/_/g, ' ') : String(v ?? '—')
}

function previewRows(kind: string, p: Record<string, unknown>): { label: string; value: string }[] {
  if (kind === 'create_corrective_action') {
    return [
      { label: 'Severity', value: humanize(p.severity) },
      { label: 'Source', value: humanize(p.source) },
      { label: 'Due', value: p.dueOn ? String(p.dueOn) : 'Not set' },
    ]
  }
  if (kind === 'create_incident') {
    return [
      { label: 'Type', value: humanize(p.type) },
      { label: 'Severity', value: humanize(p.severity) },
      {
        label: 'Occurred',
        value: p.occurredAt ? new Date(String(p.occurredAt)).toLocaleString() : '—',
      },
      ...(p.location ? [{ label: 'Location', value: String(p.location) }] : []),
    ]
  }
  return []
}

export function ProposalCard({ proposal }: { proposal: ProposalData }) {
  const [state, setState] = useState<'idle' | 'done' | 'discarded' | 'error'>('idle')
  const [result, setResult] = useState<{ reference: string; href: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const label = KIND_LABEL[proposal.kind] ?? 'Change'
  const title = String(proposal.preview.title ?? 'Untitled')
  const description = proposal.preview.description ? String(proposal.preview.description) : null

  function apply() {
    setError(null)
    start(async () => {
      let res: CommitResult
      if (proposal.kind === 'create_corrective_action') {
        res = await commitCorrectiveAction({
          preview: proposal.preview as never,
          confirmToken: proposal.confirmToken,
        })
      } else if (proposal.kind === 'create_incident') {
        res = await commitIncident({
          preview: proposal.preview as never,
          confirmToken: proposal.confirmToken,
        })
      } else {
        res = { ok: false, error: 'Unsupported draft type.' }
      }
      if (res.ok) {
        setResult({ reference: res.reference, href: res.href })
        setState('done')
      } else {
        setError(res.error)
        setState('error')
      }
    })
  }

  if (state === 'discarded') {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900/50">
        Draft discarded.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-teal-200 bg-teal-50/40 dark:border-teal-900/60 dark:bg-teal-950/20">
      <div className="flex items-center gap-2 border-b border-teal-200/70 px-3 py-2 dark:border-teal-900/40">
        <Sparkles className="h-4 w-4 text-teal-600 dark:text-teal-400" />
        <span className="text-xs font-semibold tracking-wide text-teal-700 uppercase dark:text-teal-300">
          Drafted {label.toLowerCase()} · needs your approval
        </span>
      </div>
      <div className="space-y-3 px-3 py-3">
        <div>
          <div className="font-medium text-slate-900 dark:text-slate-100">{title}</div>
          {description ? (
            <p className="mt-1 text-sm whitespace-pre-wrap text-slate-600 dark:text-slate-300">
              {description}
            </p>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
          {previewRows(proposal.kind, proposal.preview).map((r) => (
            <div key={r.label}>
              <dt className="text-[11px] tracking-wide text-slate-400 uppercase dark:text-slate-500">
                {r.label}
              </dt>
              <dd className="text-slate-700 dark:text-slate-200">{r.value}</dd>
            </div>
          ))}
        </dl>

        {state === 'done' && result ? (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-300">
            <Check className="h-4 w-4" />
            Created {result.reference}.
            <a href={result.href} className="inline-flex items-center gap-1 font-medium underline">
              Open <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={apply} disabled={pending}>
              <Check className="h-4 w-4" />
              {pending ? 'Applying…' : `Create ${label.toLowerCase()}`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setState('discarded')}
              disabled={pending}
            >
              Discard
            </Button>
          </div>
        )}
        {state === 'error' && error ? (
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <FileWarning className="h-4 w-4" />
            {error}
          </div>
        ) : null}
      </div>
    </div>
  )
}
