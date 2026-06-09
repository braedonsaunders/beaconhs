'use client'

import type { Editor } from '@tiptap/react'
import { Check, CheckCheck, ChevronDown, ChevronUp, X, XCircle } from 'lucide-react'
import { collectSuggestionRuns } from './_ext/suggestion'

export function SuggestionBar({ editor }: { editor: Editor }) {
  const runs = collectSuggestionRuns(editor.state)
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs">
      <span className="font-medium text-amber-800">
        Suggesting · {runs.length} change{runs.length === 1 ? '' : 's'}
      </span>
      <span className="mx-1 h-4 w-px bg-amber-200" />
      <BarBtn title="Previous change" onClick={() => editor.commands.gotoPrevSuggestion()}>
        <ChevronUp size={14} />
      </BarBtn>
      <BarBtn title="Next change" onClick={() => editor.commands.gotoNextSuggestion()}>
        <ChevronDown size={14} />
      </BarBtn>
      <button
        type="button"
        onClick={() => editor.commands.acceptSuggestionAt()}
        className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50"
      >
        <Check size={13} /> Accept
      </button>
      <button
        type="button"
        onClick={() => editor.commands.rejectSuggestionAt()}
        className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50"
      >
        <X size={13} /> Reject
      </button>
      <span className="mx-1 h-4 w-px bg-amber-200" />
      <button
        type="button"
        onClick={() => editor.commands.acceptAllSuggestions()}
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium text-emerald-700 hover:bg-emerald-100"
      >
        <CheckCheck size={13} /> Accept all
      </button>
      <button
        type="button"
        onClick={() => editor.commands.rejectAllSuggestions()}
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium text-rose-700 hover:bg-rose-100"
      >
        <XCircle size={13} /> Reject all
      </button>
    </div>
  )
}

function BarBtn({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded text-amber-700 hover:bg-amber-100"
    >
      {children}
    </button>
  )
}
