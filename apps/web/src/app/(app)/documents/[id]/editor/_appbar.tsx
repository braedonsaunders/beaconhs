'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Maximize2,
  Check,
  CloudUpload,
  CircleAlert,
  Download,
  FileUp,
  MessageSquare,
  PencilRuler,
  Printer,
  Settings2,
  ChevronDown,
  Loader2,
} from 'lucide-react'
import { cn, FileUploader } from '@beaconhs/ui'
import { requestUpload, finalizeUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { ZOOM_PRESETS, PAGE_SIZES, type PageSizeKey } from './_lib'
import type { SaveState } from './_autosave'
import { importDocxIntoDocument } from '../_actions'
import { ModeSwitch, type DocumentMode } from '../_mode-switch'

export type LayoutState = {
  pageSize: PageSizeKey
  headerText: string
  footerText: string
  printHeader: boolean
  printFooter: boolean
}

export function EditorAppbar({
  documentId,
  embedded = false,
  mode,
  onModeChange,
  title,
  onTitleChange,
  saveState,
  words,
  zoom,
  onZoomChange,
  layout,
  onLayoutChange,
  suggesting,
  onToggleSuggesting,
  commentsOpen,
  onToggleComments,
  commentCount,
  onPublish,
  publishing,
}: {
  documentId: string
  embedded?: boolean
  mode?: DocumentMode
  onModeChange?: (m: DocumentMode) => void
  title: string
  onTitleChange: (t: string) => void
  saveState: SaveState
  words: number
  zoom: number
  onZoomChange: (z: number) => void
  layout: LayoutState
  onLayoutChange: (patch: Partial<LayoutState>) => void
  suggesting: boolean
  onToggleSuggesting: () => void
  commentsOpen: boolean
  onToggleComments: () => void
  commentCount: number
  onPublish: () => void
  publishing: boolean
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3">
      {embedded ? (
        <Link
          href={`/documents/${documentId}/editor`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
          title="Open full-screen editor"
        >
          <Maximize2 size={15} />
        </Link>
      ) : (
        <Link
          href={`/documents/${documentId}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
          title="Back to document"
        >
          <ArrowLeft size={16} />
        </Link>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-3">
        {embedded ? (
          mode && onModeChange ? (
            <ModeSwitch mode={mode} onChange={onModeChange} />
          ) : (
            <span className="text-sm font-semibold text-slate-700">Editor</span>
          )
        ) : (
          <input
            value={title}
            onChange={(e) => onTitleChange(e.currentTarget.value)}
            placeholder="Untitled document"
            className="min-w-0 max-w-md flex-1 truncate rounded-md border border-transparent px-2 py-1 text-sm font-semibold text-slate-900 outline-none hover:border-slate-200 focus:border-teal-400"
          />
        )}
        <SaveBadge state={saveState} />
        <span className="hidden text-[11px] tabular-nums text-slate-400 md:inline">{words} words</span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleSuggesting}
          title="Suggesting mode (track changes)"
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
            suggesting
              ? 'border-amber-300 bg-amber-50 text-amber-800'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50',
          )}
        >
          <PencilRuler size={14} />
          <span className="hidden sm:inline">{suggesting ? 'Suggesting' : 'Editing'}</span>
        </button>

        <button
          type="button"
          onClick={onToggleComments}
          title="Comments"
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
            commentsOpen
              ? 'border-teal-300 bg-teal-50 text-teal-800'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50',
          )}
        >
          <MessageSquare size={14} />
          {commentCount > 0 ? <span>{commentCount}</span> : null}
        </button>

        <ZoomSelect zoom={zoom} onZoomChange={onZoomChange} />
        <PageSetupMenu layout={layout} onLayoutChange={onLayoutChange} />
        <FileMenu documentId={documentId} />

        {embedded ? null : (
          <button
            type="button"
            onClick={onPublish}
            disabled={publishing}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-700 px-3 text-xs font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-60"
          >
            {publishing ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Publish
          </button>
        )}
      </div>
    </header>
  )
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === 'saving')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
        <CloudUpload size={12} /> Saving…
      </span>
    )
  if (state === 'error')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-rose-600">
        <CircleAlert size={12} /> Save failed
      </span>
    )
  if (state === 'saved')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-teal-600">
        <Check size={12} /> Saved
      </span>
    )
  return null
}

function ZoomSelect({ zoom, onZoomChange }: { zoom: number; onZoomChange: (z: number) => void }) {
  return (
    <select
      title="Zoom"
      value={zoom}
      onChange={(e) => onZoomChange(Number(e.currentTarget.value))}
      className="doc-select h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600 outline-none hover:border-slate-300"
    >
      {ZOOM_PRESETS.map((z) => (
        <option key={z} value={z}>
          {Math.round(z * 100)}%
        </option>
      ))}
    </select>
  )
}

function FileMenu({ documentId }: { documentId: string }) {
  const router = useRouter()
  return (
    <Menu trigger={<FileUp size={15} />} title="File — import / export" widthClass="w-64">
      {(close) => (
        <div className="text-sm text-slate-700">
          <div className="border-b border-slate-100 p-2">
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Import
            </p>
            <FileUploader
              requestUploadAction={requestUpload}
              finalizeUploadAction={finalizeUpload}
              kind="document"
              accept=".docx"
              compact
              label="Replace from a Word (.docx) file"
              onUploaded={(f) =>
                void (async () => {
                  const res = await importDocxIntoDocument({ documentId, attachmentId: f.attachmentId })
                  if (res.ok) {
                    toast.success('Word file imported.')
                    close()
                    router.refresh()
                  } else {
                    toast.error(res.error ?? 'Import failed')
                  }
                })()
              }
            />
          </div>
          <div className="py-1">
            <a
              href={`/documents/${documentId}/pdf`}
              target="_blank"
              rel="noreferrer"
              onClick={close}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50"
            >
              <Download size={14} /> Download PDF
            </a>
            <a
              href={`/documents/${documentId}/docx`}
              target="_blank"
              rel="noreferrer"
              onClick={close}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50"
            >
              <Download size={14} /> Download Word (.docx)
            </a>
            <button
              type="button"
              onClick={() => {
                close()
                window.print()
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50"
            >
              <Printer size={14} /> Print
            </button>
          </div>
        </div>
      )}
    </Menu>
  )
}

function PageSetupMenu({
  layout,
  onLayoutChange,
}: {
  layout: LayoutState
  onLayoutChange: (patch: Partial<LayoutState>) => void
}) {
  return (
    <Menu trigger={<Settings2 size={15} />} title="Page setup" widthClass="w-64">
      {() => (
        <div className="space-y-3 p-3 text-xs text-slate-700">
          <label className="block">
            <span className="mb-1 block font-medium text-slate-500">Page size</span>
            <select
              value={layout.pageSize}
              onChange={(e) => onLayoutChange({ pageSize: e.currentTarget.value as PageSizeKey })}
              className="doc-select h-8 w-full rounded border border-slate-200 px-2"
            >
              {Object.entries(PAGE_SIZES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between">
            <span className="font-medium text-slate-500">Print header</span>
            <input
              type="checkbox"
              checked={layout.printHeader}
              onChange={(e) => onLayoutChange({ printHeader: e.currentTarget.checked })}
            />
          </label>
          {layout.printHeader ? (
            <input
              value={layout.headerText}
              onChange={(e) => onLayoutChange({ headerText: e.currentTarget.value })}
              placeholder="Header text (optional)"
              className="h-8 w-full rounded border border-slate-200 px-2"
            />
          ) : null}
          <label className="flex items-center justify-between">
            <span className="font-medium text-slate-500">Print footer + page #</span>
            <input
              type="checkbox"
              checked={layout.printFooter}
              onChange={(e) => onLayoutChange({ printFooter: e.currentTarget.checked })}
            />
          </label>
          {layout.printFooter ? (
            <input
              value={layout.footerText}
              onChange={(e) => onLayoutChange({ footerText: e.currentTarget.value })}
              placeholder="Footer text (optional)"
              className="h-8 w-full rounded border border-slate-200 px-2"
            />
          ) : null}
          <p className="text-[10px] leading-snug text-slate-400">
            Headers, footers, and final pagination are applied in the exported PDF.
          </p>
        </div>
      )}
    </Menu>
  )
}

function Menu({
  trigger,
  title,
  widthClass,
  children,
}: {
  trigger: ReactNode
  title: string
  widthClass: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={title}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-8 items-center gap-0.5 rounded-md border border-slate-200 px-2 text-slate-600 transition-colors hover:bg-slate-50',
          open && 'bg-slate-50',
        )}
      >
        {trigger}
        <ChevronDown size={11} />
      </button>
      {open ? (
        <div
          className={cn(
            'absolute right-0 top-10 z-40 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg',
            widthClass,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  )
}
