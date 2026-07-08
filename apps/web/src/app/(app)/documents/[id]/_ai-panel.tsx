'use client'

// Document AI panel — docked beside the Writer embed. Each turn runs a full
// server-side agent loop that can read the DOCX master, draft the entire
// document, and apply surgical exact-match edits directly to the file; when
// the document changed, the host remounts the editor so Writer reloads the
// new master. Threads persist per user per document (ai_conversations).

import { useEffect, useRef, useState } from 'react'
import {
  CornerDownLeft,
  Copy,
  FilePenLine,
  Loader2,
  RotateCcw,
  Sparkles,
  TextCursorInput,
  X,
} from 'lucide-react'
import { Button, Textarea, cn } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import type { CollaboraHandle } from '@/components/collabora-embed'
import {
  appendDocMessages,
  loadDocConversation,
  newDocConversation,
  runDocumentAiTurn,
} from './_ai-actions'

type Msg = { role: 'user' | 'assistant'; content: string; actions?: string[] }

export function DocumentAiPanel({
  documentId,
  editorRef,
  onClose,
  onDocChanged,
  className,
}: {
  documentId: string
  editorRef: React.RefObject<CollaboraHandle | null>
  onClose: () => void
  /** The agent changed the DOCX master — reload the editor. */
  onDocChanged: () => void
  className?: string
}) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    loadDocConversation(documentId)
      .then((c) => {
        if (cancelled) return
        setConversationId(c.conversationId)
        setMessages(c.messages.map((m) => ({ role: m.role, content: m.content })))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [documentId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, busy])

  async function send() {
    const q = input.trim()
    if (!q || busy || loading) return
    setInput('')
    setBusy(true)
    const history = [...messages, { role: 'user' as const, content: q }]
    setMessages(history)
    try {
      const result = await runDocumentAiTurn(
        documentId,
        history.map((m) => ({ role: m.role, content: m.content })),
      )
      if (!result.ok) {
        setMessages((prev) => prev.slice(0, -1))
        setInput(q)
        toast.error(result.error)
        return
      }
      const reply: Msg = {
        role: 'assistant',
        content: result.text || 'Done.',
        actions: result.actions.length > 0 ? result.actions : undefined,
      }
      setMessages((prev) => [...prev, reply])
      if (result.docChanged) onDocChanged()
      if (conversationId) {
        void appendDocMessages({
          conversationId,
          messages: [
            { role: 'user', content: q },
            { role: 'assistant', content: reply.content },
          ],
        })
      }
    } catch {
      setMessages((prev) => prev.slice(0, -1))
      setInput(q)
      toast.error('The AI request failed.')
    } finally {
      setBusy(false)
    }
  }

  function startNewChat() {
    if (busy) return
    setLoading(true)
    newDocConversation(documentId)
      .then((c) => {
        setConversationId(c.conversationId)
        setMessages([])
      })
      .catch(() => toast.error('Could not start a new chat'))
      .finally(() => setLoading(false))
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
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={startNewChat}
            disabled={busy || loading}
            aria-label="New chat"
            title="New chat"
            className="grid h-6 w-6 place-items-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <RotateCcw size={12} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI panel"
            className="grid h-6 w-6 place-items-center rounded text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="app-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Loader2 size={12} className="animate-spin" /> Loading conversation…
          </div>
        ) : messages.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            The assistant edits this document directly — ask it to draft the full document, rewrite
            a section, or fix specific wording. It reads the current draft before answering.
          </p>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            {m.actions?.map((a, j) => (
              <div
                key={j}
                className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
              >
                <FilePenLine size={11} /> {a}
              </div>
            ))}
            <div
              className={cn(
                'inline-block max-w-full rounded-lg px-3 py-2 text-left text-xs whitespace-pre-wrap',
                m.role === 'user'
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100',
              )}
            >
              {m.content}
            </div>
            {m.role === 'assistant' && m.content ? (
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
        {busy ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Loader2 size={12} className="animate-spin" /> Working on the document…
          </div>
        ) : null}
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
            placeholder="Draft, edit, or ask…"
            className="flex-1 text-xs"
          />
          <Button
            type="button"
            size="sm"
            disabled={busy || loading || !input.trim()}
            onClick={() => void send()}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <CornerDownLeft size={13} />}
          </Button>
        </div>
      </div>
    </div>
  )
}
