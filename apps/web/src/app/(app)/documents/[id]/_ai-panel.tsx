'use client'

// Document AI panel — docked beside the Writer embed. Chat is grounded in the
// CURRENT working draft (LibreOffice text extraction of the DOCX master) and
// streams from /documents/ai (tenant-configured provider). Assistant replies
// can be inserted at the editor's cursor through the Collabora postMessage
// channel, or copied.

import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Copy, Loader2, Sparkles, TextCursorInput, X } from 'lucide-react'
import { Button, Textarea, cn } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import type { CollaboraHandle } from '@/components/collabora-embed'
import { getDocumentDraftText } from './_master-actions'

type Msg = { role: 'user' | 'assistant'; content: string }

export function DocumentAiPanel({
  documentId,
  editorRef,
  onClose,
  className,
}: {
  documentId: string
  editorRef: React.RefObject<CollaboraHandle | null>
  onClose: () => void
  className?: string
}) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const docTextRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  async function send() {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    setBusy(true)
    const history: Msg[] = [...messages, { role: 'user', content: q }]
    setMessages([...history, { role: 'assistant', content: '' }])
    try {
      if (docTextRef.current === null) {
        const t = await getDocumentDraftText(documentId)
        docTextRef.current = t.ok ? t.text : ''
      }
      const res = await fetch('/documents/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history, docText: docTextRef.current || undefined }),
      })
      if (!res.ok || !res.body) {
        const detail =
          res.status === 503 ? 'AI is not configured for this tenant.' : 'AI request failed.'
        setMessages((prev) => prev.slice(0, -1))
        toast.error(detail)
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        const text = acc
        setMessages((prev) => [...prev.slice(0, -1), { role: 'assistant', content: text }])
      }
    } catch {
      setMessages((prev) => prev.slice(0, -1))
      toast.error('AI request failed.')
    } finally {
      setBusy(false)
    }
  }

  function insert(text: string) {
    const editor = editorRef.current
    if (!editor?.isLoaded()) {
      toast.error('The editor is still loading.')
      return
    }
    editor.insertText(text)
    toast.success('Inserted at the cursor')
  }

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-200 px-3 dark:border-slate-800">
        <Sparkles size={13} className="text-teal-600 dark:text-teal-400" />
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          AI assistant
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI panel"
          className="ml-auto grid h-6 w-6 place-items-center rounded text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <X size={13} />
        </button>
      </div>

      <div ref={scrollRef} className="app-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Ask about this document or request new content — replies can be inserted at the cursor.
            The assistant reads the current draft.
          </p>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <div
              className={cn(
                'inline-block max-w-full rounded-lg px-3 py-2 text-left text-xs whitespace-pre-wrap',
                m.role === 'user'
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100',
              )}
            >
              {m.content || (busy && i === messages.length - 1 ? '…' : '')}
            </div>
            {m.role === 'assistant' && m.content && !(busy && i === messages.length - 1) ? (
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => insert(m.content)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:underline dark:text-teal-300"
                >
                  <TextCursorInput size={11} /> Insert at cursor
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(m.content)
                    toast.success('Copied')
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:underline dark:text-slate-400"
                >
                  <Copy size={11} /> Copy
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-slate-200 p-2 dark:border-slate-800">
        <div className="flex items-end gap-1.5">
          <Textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder="Ask or draft…"
            className="flex-1 text-xs"
          />
          <Button
            type="button"
            size="sm"
            disabled={busy || !input.trim()}
            onClick={() => void send()}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <CornerDownLeft size={13} />}
          </Button>
        </div>
      </div>
    </div>
  )
}
