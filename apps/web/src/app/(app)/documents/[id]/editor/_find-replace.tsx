'use client'

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { CaseSensitive, ChevronDown, ChevronUp, X } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import { findReplacePluginKey } from './_ext/find-replace'

export function FindReplaceBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const fs = findReplacePluginKey.getState(editor.state) as
    | { matches: unknown[]; activeIndex: number }
    | undefined
  const count = fs?.matches.length ?? 0
  const active = count > 0 ? (fs?.activeIndex ?? 0) + 1 : 0

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <input
        ref={inputRef}
        value={find}
        onChange={(e) => {
          setFind(e.target.value)
          editor.commands.setSearchTerm(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) editor.commands.findPrev()
            else editor.commands.findNext()
          } else if (e.key === 'Escape') {
            onClose()
          }
        }}
        placeholder="Find"
        className="h-7 w-44 rounded border border-slate-200 px-2 text-sm outline-none focus:border-teal-400"
      />
      <span className="w-14 text-center text-xs tabular-nums text-slate-500">
        {count ? `${active}/${count}` : '0/0'}
      </span>
      <BarBtn title="Previous (Shift+Enter)" onClick={() => editor.commands.findPrev()}>
        <ChevronUp size={14} />
      </BarBtn>
      <BarBtn title="Next (Enter)" onClick={() => editor.commands.findNext()}>
        <ChevronDown size={14} />
      </BarBtn>
      <BarBtn
        title="Match case"
        active={caseSensitive}
        onClick={() => {
          const next = !caseSensitive
          setCaseSensitive(next)
          editor.commands.setSearchCaseSensitive(next)
        }}
      >
        <CaseSensitive size={14} />
      </BarBtn>

      <span className="mx-1 h-4 w-px bg-slate-200" />

      <input
        value={replace}
        onChange={(e) => setReplace(e.target.value)}
        placeholder="Replace with"
        className="h-7 w-44 rounded border border-slate-200 px-2 text-sm outline-none focus:border-teal-400"
      />
      <button
        type="button"
        onClick={() => editor.commands.replaceCurrent(replace)}
        className="h-7 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Replace
      </button>
      <button
        type="button"
        onClick={() => editor.commands.replaceAll(replace)}
        className="h-7 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        All
      </button>

      <button
        type="button"
        onClick={onClose}
        className="ml-auto grid h-7 w-7 place-items-center rounded text-slate-500 hover:bg-slate-200"
        aria-label="Close find"
      >
        <X size={14} />
      </button>
    </div>
  )
}

function BarBtn({
  children,
  title,
  active,
  onClick,
}: {
  children: React.ReactNode
  title: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'grid h-7 w-7 place-items-center rounded text-slate-600 hover:bg-slate-200',
        active && 'bg-teal-100 text-teal-800',
      )}
    >
      {children}
    </button>
  )
}
