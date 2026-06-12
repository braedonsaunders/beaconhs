'use client'

// The document AI assistant — a doc-aware chat built on the shared Drawer so it
// behaves like every other flyout in the app (portaled, backdrop, slide-in,
// Esc/click-out). It can draft and edit policy/procedure content: assistant
// turns that come back as HTML get "Insert" / "Replace document" actions wired
// straight into the TipTap editor. History persists per-user-per-document via
// the unified ai_conversations tables.

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import Link from 'next/link'
import { Loader2, Plus, Send, Sparkles, SquarePen, TextCursorInput } from 'lucide-react'
import { Drawer } from '@beaconhs/ui'
import { sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { toast } from '@/lib/toast'
import {
  appendDocMessages,
  loadDocConversation,
  newDocConversation,
  type DocAiMessage,
} from '../_ai-actions'

type ChatMsg = DocAiMessage & { streaming?: boolean }

const QUICK_PROMPTS: { label: string; text: string; fill?: boolean }[] = [
  {
    label: 'Draft a policy…',
    text: 'Draft a complete, well-structured policy document on ',
    fill: true,
  },
  {
    label: 'Improve writing',
    text: 'Improve the clarity, flow, and professionalism of this document. Return the full revised document.',
  },
  {
    label: 'Make more formal',
    text: 'Rewrite this document in a more formal, professional tone suitable for a regulated workplace. Return the full revised document.',
  },
  { label: 'Summarize', text: 'Summarize this document in a short, clear paragraph.' },
  {
    label: 'Add a section…',
    text: 'Suggest and write an additional section that would strengthen this document: ',
    fill: true,
  },
  {
    label: 'Find compliance gaps',
    text: 'Review this document and list any compliance gaps, missing elements, or risks I should address.',
  },
]

function looksLikeHtml(s: string): boolean {
  const t = s.trimStart()
  if (!t.startsWith('<')) return false
  return /<(h[1-6]|p|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|strong|em|br)\b/i.test(t)
}

async function* streamChat(
  messages: { role: 'user' | 'assistant'; content: string }[],
  docText: string,
): AsyncGenerator<string> {
  const res = await fetch('/documents/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, docText }),
  })
  if (res.status === 503) throw new Error('AI isn’t configured. Add an API key in Admin → AI.')
  if (!res.ok || !res.body) throw new Error('AI request failed.')
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const s = dec.decode(value, { stream: true })
    if (s) yield s
  }
}

export function AiPanel({
  editor,
  documentId,
  aiEnabled,
  open,
  onClose,
}: {
  editor: Editor
  documentId: string
  aiEnabled: boolean
  open: boolean
  onClose: () => void
}) {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const loadedRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load (or create) the persistent conversation the first time the drawer opens.
  useEffect(() => {
    if (!open || loadedRef.current) return
    loadedRef.current = true
    setLoading(true)
    void (async () => {
      try {
        const res = await loadDocConversation(documentId)
        setConversationId(res.conversationId)
        setMessages(res.messages)
      } catch {
        /* still usable, just unpersisted */
      } finally {
        setLoading(false)
      }
    })()
  }, [open, documentId])

  // Autoscroll to the newest content.
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, loading, open])

  async function send(text: string) {
    const content = text.trim()
    if (!content || busy) return
    if (!aiEnabled) {
      toast.error('AI isn’t configured. Add an API key in Admin → AI.')
      return
    }
    setInput('')
    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: 'user', content }
    const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }))
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: `a-${Date.now()}`, role: 'assistant', content: '', streaming: true },
    ])
    setBusy(true)
    let full = ''
    try {
      const docText = editor.getText()
      for await (const chunk of streamChat(history, docText)) {
        full += chunk
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last && last.role === 'assistant') next[next.length - 1] = { ...last, content: full }
          return next
        })
      }
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last && last.role === 'assistant') next[next.length - 1] = { ...last, streaming: false }
        return next
      })
      if (conversationId && full.trim()) {
        void appendDocMessages({
          conversationId,
          messages: [
            { role: 'user', content },
            { role: 'assistant', content: full },
          ],
        })
      }
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last && last.role === 'assistant' && !last.content) next.pop()
        else if (last && last.role === 'assistant')
          next[next.length - 1] = { ...last, streaming: false }
        return next
      })
      toast.error(err instanceof Error ? err.message : 'AI request failed.')
    } finally {
      setBusy(false)
    }
  }

  function applyHtml(html: string, replace: boolean) {
    const clean = sanitizeDocumentHtml(html)
    if (replace) {
      editor.chain().setContent(clean, { emitUpdate: true }).focus('end').run()
      toast.success('Document replaced.')
    } else {
      editor.chain().focus().insertContent(clean).run()
      toast.success('Inserted into document.')
    }
    onClose()
  }

  async function startNewChat() {
    if (busy) return
    setMessages([])
    try {
      const res = await newDocConversation(documentId)
      setConversationId(res.conversationId)
    } catch {
      /* keep the cleared view even if persistence failed */
    }
  }

  function onPickPrompt(p: (typeof QUICK_PROMPTS)[number]) {
    if (p.fill) {
      setInput(p.text)
      inputRef.current?.focus()
    } else {
      void send(p.text)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white">
            <Sparkles size={14} />
          </span>
          AI assistant
        </span>
      }
      footer={
        <div className="w-full space-y-2">
          {messages.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {QUICK_PROMPTS.slice(0, 3).map((p) => (
                <button
                  key={p.label}
                  type="button"
                  disabled={busy || !aiEnabled}
                  onClick={() => onPickPrompt(p)}
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-50 dark:border-slate-800 dark:text-slate-300"
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={startNewChat}
                disabled={busy}
                className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <Plus size={12} /> New chat
              </button>
            </div>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void send(input)
            }}
            className="flex items-end gap-2"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send(input)
                }
              }}
              rows={2}
              placeholder={
                aiEnabled ? 'Ask AI to draft or edit…  (Enter to send)' : 'AI is not configured'
              }
              disabled={!aiEnabled || busy}
              className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-400 disabled:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800"
            />
            <button
              type="submit"
              disabled={!aiEnabled || busy || !input.trim()}
              title="Send"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </form>
        </div>
      }
    >
      {loading ? (
        <div className="grid h-40 place-items-center text-slate-300">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : messages.length === 0 ? (
        <Intro aiEnabled={aiEnabled} onPick={onPickPrompt} />
      ) : (
        <div className="space-y-3">
          {messages.map((m) => (
            <Bubble key={m.id} m={m} onApply={applyHtml} />
          ))}
        </div>
      )}
      <div ref={bottomRef} />
    </Drawer>
  )
}

function Intro({
  aiEnabled,
  onPick,
}: {
  aiEnabled: boolean
  onPick: (p: (typeof QUICK_PROMPTS)[number]) => void
}) {
  if (!aiEnabled) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        <p className="font-medium">AI is not configured</p>
        <p className="mt-1 text-xs text-amber-700">
          Add an API key to enable the writing assistant.
        </p>
        <Link
          href="/admin/ai"
          className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
        >
          Open AI settings
        </Link>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-gradient-to-br from-violet-50 to-fuchsia-50 p-3">
        <p className="text-sm font-medium text-slate-800">Your writing assistant</p>
        <p className="mt-1 text-xs text-slate-500">
          Draft a new policy from scratch, rewrite a section, or ask for compliance feedback. Drafts
          come back ready to insert into the document.
        </p>
      </div>
      <div className="grid gap-1.5">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onPick(p)}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:border-violet-300 hover:bg-violet-50 dark:border-slate-800 dark:text-slate-200"
          >
            <SquarePen size={14} className="shrink-0 text-violet-500" />
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Bubble({ m, onApply }: { m: ChatMsg; onApply: (html: string, replace: boolean) => void }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-teal-600 px-3 py-2 text-sm whitespace-pre-wrap text-white">
          {m.content}
        </div>
      </div>
    )
  }

  const isHtml = looksLikeHtml(m.content)
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        {isHtml ? (
          <>
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold tracking-wide text-violet-500 uppercase">
              <Sparkles size={11} /> Generated document
            </div>
            <div
              className="prose prose-sm doc-ai-preview max-h-80 max-w-none overflow-auto rounded-md border border-slate-200 bg-white p-2"
              dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(m.content) }}
            />
            {!m.streaming ? (
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => onApply(m.content, false)}
                  className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700"
                >
                  <TextCursorInput size={12} /> Insert
                </button>
                <button
                  type="button"
                  onClick={() => onApply(m.content, true)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <SquarePen size={12} /> Replace document
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="whitespace-pre-wrap">
            {m.content}
            {m.streaming ? (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-violet-400 align-middle" />
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
