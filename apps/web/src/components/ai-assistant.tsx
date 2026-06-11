'use client'

// Reusable AI assistant flyout with PERSISTENT, GLOBAL conversation history.
// Generic: pass a `scope` (+ optional `scopeRefId`) to namespace the threads,
// an `onSend` that runs one feature-specific turn (persisting messages), and an
// `onApply` that consumes a finished assistant message's structured `data`.
// The conversation list + thread + persistence are handled here.

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Check, History, Loader2, Plus, Send, Sparkles, Trash2 } from 'lucide-react'
import { Button, Drawer, Textarea } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import {
  deleteConversation,
  getConversationMessages,
  listConversations,
  type AiChatMessage,
  type AiConversationSummary,
} from '@/lib/ai-conversations'

export type AiSendResult = {
  ok: boolean
  conversationId?: string
  error?: string
}

export function AiAssistant({
  open,
  onClose,
  scope,
  scopeRefId,
  title = 'AI assistant',
  description,
  placeholder = 'Describe what to build or change…',
  suggestions = [],
  applyLabel = 'Apply',
  onSend,
  onApply,
}: {
  open: boolean
  onClose: () => void
  scope: string
  scopeRefId?: string | null
  title?: string
  description?: string
  placeholder?: string
  suggestions?: string[]
  applyLabel?: string
  onSend: (conversationId: string | null, prompt: string) => Promise<AiSendResult>
  onApply: (data: Record<string, unknown>) => void
}) {
  const [conversations, setConversations] = useState<AiConversationSummary[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [input, setInput] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [pending, start] = useTransition()
  const threadRef = useRef<HTMLDivElement>(null)

  const refreshConversations = useCallback(() => {
    listConversations(scope, scopeRefId)
      .then(setConversations)
      .catch(() => {})
  }, [scope, scopeRefId])

  useEffect(() => {
    if (open) refreshConversations()
  }, [open, refreshConversations])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [messages])

  const loadConversation = (id: string) => {
    setConversationId(id)
    setShowHistory(false)
    getConversationMessages(id)
      .then(setMessages)
      .catch(() => setMessages([]))
  }

  const newChat = () => {
    setConversationId(null)
    setMessages([])
    setShowHistory(false)
    setInput('')
  }

  const send = (text: string) => {
    const prompt = text.trim()
    if (prompt.length < 2 || pending) return
    setInput('')
    // Optimistic user bubble.
    setMessages((m) => [
      ...m,
      { id: `tmp_${m.length}`, role: 'user', content: prompt, data: null, createdAt: '' },
    ])
    start(async () => {
      const res = await onSend(conversationId, prompt)
      if (!res.ok) {
        toast.error(res.error ?? 'The assistant could not respond')
      }
      const cid = res.conversationId ?? conversationId
      if (cid) {
        setConversationId(cid)
        const msgs = await getConversationMessages(cid)
        setMessages(msgs)
      }
      refreshConversations()
    })
  }

  const removeConversation = (id: string) => {
    start(async () => {
      await deleteConversation(id)
      if (id === conversationId) newChat()
      refreshConversations()
    })
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Sparkles size={16} className="text-violet-600" /> {title}
        </span>
      }
      description={description}
      size="md"
    >
      <div className="flex h-full min-h-0 flex-col">
        {/* Toolbar */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-200 pb-2 dark:border-slate-800">
          <Button variant="outline" size="sm" onClick={newChat}>
            <Plus size={14} /> New chat
          </Button>
          <Button
            variant={showHistory ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowHistory((s) => !s)}
          >
            <History size={14} /> History
          </Button>
          {pending ? (
            <Loader2 size={14} className="ml-1 animate-spin text-slate-400 dark:text-slate-500" />
          ) : null}
        </div>

        {showHistory ? (
          <div className="app-scroll min-h-0 flex-1 space-y-1 overflow-y-auto py-2">
            {conversations.length === 0 ? (
              <p className="px-1 py-4 text-center text-xs text-slate-400 dark:text-slate-500">
                No conversations yet.
              </p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                    c.id === conversationId
                      ? 'bg-violet-50'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => loadConversation(c.id)}
                    className="min-w-0 flex-1 truncate text-left text-slate-700 dark:text-slate-200"
                    title={c.title}
                  >
                    {c.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeConversation(c.id)}
                    className="opacity-0 transition group-hover:opacity-100"
                    title="Delete conversation"
                  >
                    <Trash2
                      size={13}
                      className="text-slate-400 hover:text-rose-500 dark:text-slate-500"
                    />
                  </button>
                </div>
              ))
            )}
          </div>
        ) : (
          <>
            <div
              ref={threadRef}
              className="app-scroll min-h-0 flex-1 space-y-3 overflow-y-auto py-3"
            >
              {messages.length === 0 ? (
                <div className="space-y-2 px-1 pt-2">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Ask me to build or change this app — I&apos;ll draft it, then you Apply.
                  </p>
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-600 hover:border-violet-300 hover:bg-violet-50/40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                        m.role === 'user'
                          ? 'bg-teal-600 text-white'
                          : 'border border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      {m.role === 'assistant' && m.data ? (
                        <Button
                          size="sm"
                          className="mt-2"
                          onClick={() => {
                            onApply(m.data as Record<string, unknown>)
                            onClose()
                          }}
                        >
                          <Check size={13} /> {applyLabel}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex shrink-0 items-end gap-2 border-t border-slate-200 pt-2 dark:border-slate-800">
              <Textarea
                rows={2}
                value={input}
                placeholder={placeholder}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send(input)
                  }
                }}
                className="flex-1 resize-none"
              />
              <Button onClick={() => send(input)} disabled={pending || input.trim().length < 2}>
                <Send size={14} />
              </Button>
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}
