'use client'

// A single tool call rendered as a tidy, expandable card. Driven by the SDK part
// `state`: input-streaming/input-available → spinner; output-available → check;
// output-error → alert. The same card renders live and on transcript reload.

import { useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Database,
  FileImage,
  FileText,
  ListChecks,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@beaconhs/ui'

type ToolState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error'

const META: Record<string, { label: string; icon: LucideIcon }> = {
  whoami: { label: 'Checked your access', icon: ShieldCheck },
  find_incidents: { label: 'Searched incidents', icon: Search },
  get_incident: { label: 'Read incident', icon: FileText },
  find_corrective_actions: { label: 'Searched corrective actions', icon: Search },
  get_corrective_action: { label: 'Read corrective action', icon: FileText },
  find_documents: { label: 'Searched documents', icon: Search },
  search_document: { label: 'Searched within document', icon: Search },
  read_document: { label: 'Read document', icon: FileText },
  view_document_pages: { label: 'Viewed document pages', icon: FileImage },
  find_people: { label: 'Looked up people', icon: Users },
  find_training_records: { label: 'Searched training records', icon: Search },
  list_my_open_items: { label: 'Checked your open items', icon: ListChecks },
  draft_corrective_action: { label: 'Drafted a corrective action', icon: Sparkles },
  draft_incident: { label: 'Drafted an incident report', icon: Sparkles },
  draft_journal_entry: { label: 'Drafted a journal entry', icon: Sparkles },
}

function metaFor(name: string): { label: string; icon: LucideIcon } {
  return META[name] ?? { label: name.replace(/_/g, ' '), icon: Database }
}

function summarize(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null
  const o = output as Record<string, unknown>
  if (o.ok === false) return typeof o.error === 'string' ? o.error.replace(/_/g, ' ') : 'failed'
  const data = (o.data ?? o) as Record<string, unknown>
  if (typeof data.renderedPages === 'number')
    return `${data.renderedPages} page${data.renderedPages === 1 ? '' : 's'}`
  if (typeof data.total === 'number') return `${data.total} match${data.total === 1 ? '' : 'es'}`
  if (typeof data.returned === 'number')
    return `${data.returned} result${data.returned === 1 ? '' : 's'}`
  return null
}

// The vision tool returns base64 page images on data.images so the model can SEE
// them. Replace that payload with a short marker before the card prints the JSON
// result, so the expandable view stays readable (the human reads the actual
// pages via the document reader). No-op for every other tool.
function redactImages(output: unknown): unknown {
  if (!output || typeof output !== 'object') return output
  const data = (output as { data?: unknown }).data
  const images = data && typeof data === 'object' ? (data as { images?: unknown }).images : null
  if (!Array.isArray(images) || images.length === 0) return output
  const o = output as { data?: Record<string, unknown> }
  return { ...o, data: { ...o.data, images: `[${images.length} page image(s)]` } }
}

export function ToolUseCard({
  name,
  state,
  input,
  output,
}: {
  name: string
  state: ToolState
  input?: unknown
  output?: unknown
}) {
  const [open, setOpen] = useState(false)
  const { label, icon: Icon } = metaFor(name)
  const running = state === 'input-streaming' || state === 'input-available'
  const errored = state === 'output-error' || (output as { ok?: boolean })?.ok === false
  const summary = summarize(output)

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50/70 text-sm dark:border-slate-800 dark:bg-slate-900/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-slate-100/70 dark:hover:bg-slate-800/50"
      >
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
            errored
              ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-300'
              : 'bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200">
          {label}
        </span>
        {summary ? (
          <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">{summary}</span>
        ) : null}
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-400" />
        ) : errored ? (
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
        )}
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform',
            open && 'rotate-90',
          )}
        />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-slate-200 px-3 py-2 dark:border-slate-800">
          {input !== undefined && input !== null && Object.keys(input).length > 0 ? (
            <Detail label="Request" value={input} />
          ) : null}
          {output !== undefined ? <Detail label="Result" value={redactImages(output)} /> : null}
        </div>
      ) : null}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
        {label}
      </div>
      <pre className="app-scroll max-h-60 overflow-auto rounded-md bg-white p-2 text-xs leading-relaxed text-slate-700 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800">
        {safeStringify(value)}
      </pre>
    </div>
  )
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
