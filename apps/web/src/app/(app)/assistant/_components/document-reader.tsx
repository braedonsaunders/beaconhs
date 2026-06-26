'use client'

// In-chat document reader. A right-side slide-out panel that loads a controlled
// document and renders it without leaving the conversation: in-app documents on
// a paper surface using the same `documentBodyCss` as the editor/PDF, and
// uploaded PDFs (including scanned/image-only ones) in a native <iframe> on a
// short-lived presigned URL. Mounted once by DocumentReaderProvider (in
// assistant-app); any result card opens it via useDocumentReader().

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Download, ExternalLink, FileText, FileWarning, PanelRightOpen, X } from 'lucide-react'
import { Badge, Drawer, Skeleton } from '@beaconhs/ui'
import { documentBodyCss } from '@beaconhs/forms-core'
import { getReaderDocument, type ReaderDocument } from '../_document-reader-actions'

export type DocRef = {
  id: string
  title?: string | null
  key?: string | null
  status?: string | null
  category?: string | null
  /** Preloaded sanitized HTML (e.g. from the preview card) — when present the
   *  reader renders it immediately instead of re-fetching. Uploaded PDFs have no
   *  HTML, so they leave this null and the reader fetches a fresh presigned URL. */
  html?: string | null
}

type ReaderCtx = { open: (doc: DocRef) => void }
const Ctx = createContext<ReaderCtx | null>(null)

/** Opens the document reader, or null when no provider is mounted (caller should
 *  fall back to a normal link). */
export function useDocumentReader(): ReaderCtx | null {
  return useContext(Ctx)
}

// Scoped once — the document body styles only apply under `.doc-reader-body`.
const DOC_CSS = documentBodyCss('.doc-reader-body')

function statusVariant(s?: string | null) {
  if (s === 'published') return 'success' as const
  if (s === 'under_review') return 'warning' as const
  if (s === 'archived') return 'outline' as const
  return 'secondary' as const
}
function humanize(s?: string | null): string {
  return s ? s.replace(/_/g, ' ') : ''
}

export function DocumentReaderProvider({ children }: { children: ReactNode }) {
  const [docRef, setDocRef] = useState<DocRef | null>(null)
  const value = useMemo<ReaderCtx>(() => ({ open: setDocRef }), [])
  return (
    <Ctx.Provider value={value}>
      {children}
      <DocumentReaderDrawer docRef={docRef} onClose={() => setDocRef(null)} />
    </Ctx.Provider>
  )
}

// The fetch result, tagged with the id it belongs to so a stale response for a
// previously-opened document is ignored and `loading` is derived (no synchronous
// setState in the effect → no cascading render).
type Loaded = { id: string; doc: ReaderDocument | null; error: string | null }

function DocumentReaderDrawer({ docRef, onClose }: { docRef: DocRef | null; onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    // Skip the round-trip when the opener already handed us the HTML.
    if (!docRef || docRef.html != null) return
    const id = docRef.id
    let cancelled = false
    getReaderDocument(id)
      .then((res) => {
        if (cancelled) return
        if (res.ok) setLoaded({ id, doc: res.doc, error: null })
        else
          setLoaded({
            id,
            doc: null,
            error:
              res.error === 'forbidden'
                ? "You don't have access to this document."
                : "This document isn't available.",
          })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id, doc: null, error: 'Could not load this document.' })
      })
    return () => {
      cancelled = true
    }
  }, [docRef])

  // Preloaded HTML is used directly (derived, not stored) so the effect never
  // calls setState synchronously. Otherwise trust `loaded` once it matches.
  const preloaded: ReaderDocument | null =
    docRef && docRef.html != null
      ? {
          id: docRef.id,
          key: docRef.key ?? '',
          title: docRef.title ?? 'Document',
          status: docRef.status ?? '',
          category: docRef.category ?? null,
          updatedAt: null,
          html: docRef.html,
          // Preloading only ever carries HTML; PDFs always re-fetch a fresh URL.
          pdfUrl: null,
        }
      : null
  const current = docRef && loaded?.id === docRef.id ? loaded : null
  const doc = preloaded ?? current?.doc ?? null

  return (
    <ReaderShell
      open={docRef !== null}
      title={doc?.title ?? docRef?.title ?? 'Document'}
      docKey={doc?.key ?? docRef?.key ?? null}
      category={doc?.category ?? docRef?.category ?? null}
      status={doc?.status ?? docRef?.status ?? null}
      fullHref={docRef ? `/documents/${docRef.id}` : '#'}
      loading={docRef !== null && !preloaded && current === null}
      error={current?.error ?? null}
      html={doc?.html ?? null}
      pdfUrl={doc?.pdfUrl ?? null}
      onClose={onClose}
    />
  )
}

/** Presentational shell — pure function of props so it can be previewed in isolation. */
export function ReaderShell({
  open,
  title,
  docKey,
  category,
  status,
  fullHref,
  loading,
  error,
  html,
  pdfUrl,
  onClose,
}: {
  open: boolean
  title: string
  docKey: string | null
  category: string | null
  status: string | null
  fullHref: string
  loading: boolean
  error: string | null
  html: string | null
  pdfUrl: string | null
  onClose: () => void
}) {
  return (
    <Drawer open={open} onClose={onClose} size="xl">
      <style dangerouslySetInnerHTML={{ __html: DOC_CSS }} />

      {/* Sticky header — bled to the drawer edges over the body's px-6 py-5. */}
      <div className="sticky -top-5 z-10 -mx-6 -mt-5 mb-5 flex items-start gap-3 border-b border-slate-200 bg-white/95 px-6 py-3.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
          <FileText className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base leading-snug font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            {docKey ? (
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {docKey}
              </code>
            ) : null}
            {category ? <span className="truncate">{category}</span> : null}
            {status ? (
              <Badge variant={statusVariant(status)} className="capitalize">
                {humanize(status)}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={fullHref}
            target="_blank"
            rel="noreferrer"
            title="Open full page"
            aria-label="Open full page"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Open full page</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {loading ? (
        <ReaderSkeleton />
      ) : error ? (
        <ReaderMessage icon={<FileWarning className="h-5 w-5" />} title={error}>
          You can still open it from the document module if you have access.
        </ReaderMessage>
      ) : pdfUrl ? (
        // Uploaded PDF (incl. scanned/image-only) → browsers render it natively
        // in the iframe; no pdf.js needed. A slim action row offers download /
        // new-tab on the same short-lived presigned URL.
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-end gap-1.5 border-b border-slate-200 bg-white/95 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/95">
            <a
              href={pdfUrl}
              download
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </a>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60"
            >
              <ExternalLink className="h-3.5 w-3.5" /> New tab
            </a>
          </div>
          <iframe
            src={pdfUrl}
            title={title}
            className="h-[calc(100vh-11rem)] min-h-[480px] w-full bg-white"
          />
        </div>
      ) : html ? (
        // White "paper" surface, kept light even in dark mode so the document
        // reads like a printed page; doc-body CSS styles headings/lists/tables.
        <div className="rounded-xl bg-white p-6 text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-8 dark:ring-slate-800">
          <article className="doc-reader-body" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      ) : (
        <ReaderMessage icon={<FileText className="h-5 w-5" />} title="No readable content yet">
          This document doesn’t have any published content to show.
        </ReaderMessage>
      )}
    </Drawer>
  )
}

function ReaderSkeleton() {
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8 dark:ring-slate-800">
      <Skeleton className="h-7 w-2/3" />
      <div className="mt-5 space-y-2.5">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={`a${i}`} className="h-3.5 w-full" />
        ))}
        <Skeleton className="h-3.5 w-4/5" />
      </div>
      <Skeleton className="mt-7 h-5 w-1/3" />
      <div className="mt-4 space-y-2.5">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={`b${i}`} className="h-3.5 w-full" />
        ))}
        <Skeleton className="h-3.5 w-3/5" />
      </div>
    </div>
  )
}

function ReaderMessage({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 px-6 py-16 text-center dark:border-slate-800">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
        {icon}
      </span>
      <p className="font-medium text-slate-700 dark:text-slate-200">{title}</p>
      {children ? (
        <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{children}</p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Document preview card — a page thumbnail of the real content that opens the
// reader on click. Rendered for the read_document tool result.
// ---------------------------------------------------------------------------

export function DocumentPreviewCard({
  id,
  title,
  docKey,
  status,
}: {
  id: string
  title: string
  docKey: string | null
  status: string | null
}) {
  const reader = useDocumentReader()
  const [loaded, setLoaded] = useState<ReaderDocument | 'error' | null>(null)

  useEffect(() => {
    let cancelled = false
    getReaderDocument(id)
      .then((res) => {
        if (!cancelled) setLoaded(res.ok ? res.doc : 'error')
      })
      .catch(() => {
        if (!cancelled) setLoaded('error')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const doc = loaded && loaded !== 'error' ? loaded : null
  const resolvedTitle = doc?.title ?? title
  const resolvedKey = doc?.key ?? docKey
  const resolvedStatus = doc?.status ?? status
  const resolvedCategory = doc?.category ?? null

  function open() {
    if (reader) {
      // Hand the already-loaded HTML to the reader so it opens instantly. A PDF
      // document has no HTML (empty string) — pass null so the reader fetches a
      // fresh presigned URL rather than treating "" as preloaded-but-empty.
      reader.open({
        id,
        title: resolvedTitle,
        key: resolvedKey,
        status: resolvedStatus,
        category: resolvedCategory,
        html: doc?.html || null,
      })
    } else if (typeof window !== 'undefined') {
      window.open(`/documents/${id}`, '_blank', 'noopener')
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <style dangerouslySetInnerHTML={{ __html: DOC_CSS }} />
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-slate-800 dark:text-slate-100">
            {resolvedTitle}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
            {resolvedKey ? (
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {resolvedKey}
              </code>
            ) : null}
            {resolvedCategory ? <span className="truncate">{resolvedCategory}</span> : null}
          </div>
        </div>
        {resolvedStatus ? (
          <Badge variant={statusVariant(resolvedStatus)} className="shrink-0 capitalize">
            {humanize(resolvedStatus)}
          </Badge>
        ) : null}
        <a
          href={`/documents/${id}`}
          target="_blank"
          rel="noreferrer"
          title="Open full page"
          aria-label="Open full page"
          className="shrink-0 rounded p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      <button type="button" onClick={open} className="group block w-full cursor-pointer text-left">
        {/* Page-preview thumbnail on a white "paper" surface, clipped + faded. */}
        <div className="relative max-h-52 overflow-hidden border-t border-slate-100 bg-white px-6 pt-6 dark:border-slate-800">
          {loaded === null ? (
            <PreviewSkeleton />
          ) : doc?.pdfUrl ? (
            <PreviewPdf />
          ) : doc?.html ? (
            <div className="doc-reader-body" dangerouslySetInnerHTML={{ __html: doc.html }} />
          ) : (
            <PreviewEmpty error={loaded === 'error'} />
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white via-white/85 to-transparent" />
        </div>
        <div className="flex items-center justify-center gap-1.5 border-t border-slate-100 bg-white py-2 text-xs font-medium text-teal-700 transition-colors group-hover:bg-teal-50/60 dark:border-slate-800 dark:bg-slate-900 dark:text-teal-300 dark:group-hover:bg-teal-950/30">
          <PanelRightOpen className="h-3.5 w-3.5" />
          {reader ? 'Open in reader' : 'Open document'}
        </div>
      </button>
    </div>
  )
}

function PreviewSkeleton() {
  return (
    <div className="space-y-2.5 pb-6">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-4/6" />
    </div>
  )
}

function PreviewEmpty({ error }: { error: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center text-slate-400">
      <FileText className="h-7 w-7" />
      <span className="text-xs">{error ? 'Preview unavailable' : 'No preview available'}</span>
    </div>
  )
}

// Uploaded-PDF documents have no HTML to thumbnail — show a PDF affordance
// instead. The surface is always white paper, so this is styled light-only.
function PreviewPdf() {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-teal-100 text-teal-700">
        <FileText className="h-5 w-5" />
      </span>
      <span className="text-sm font-medium text-slate-700">PDF document</span>
      <span className="text-xs text-slate-500">Open in the reader to view the pages</span>
    </div>
  )
}
