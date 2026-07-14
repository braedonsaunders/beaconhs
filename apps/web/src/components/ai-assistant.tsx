'use client'

// Reusable AI assistant flyout with PERSISTENT, GLOBAL conversation history.
// Generic: pass a `scope` (+ optional `scopeRefId`) to namespace the threads,
// an `onSend` that runs one feature-specific turn (persisting messages), and an
// `onApply` that consumes a finished assistant message's structured `data`.
// The conversation list + thread + persistence are handled here.

import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react'
import { Check, History, Loader2, Plus, Search, Send, Sparkles, Trash2 } from 'lucide-react'
import { Button, Drawer, Textarea } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import {
  deleteConversation,
  getConversationMessagePage,
  listConversationPage,
  type AiChatMessage,
  type AiConversationPage,
} from '@/lib/ai-conversations'
import { AI_CONVERSATION_SEARCH_MAX_CHARS } from '@/lib/ai-conversation-pagination'

type AiSendResult = {
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
  const [conversationPage, setConversationPage] = useState<AiConversationPage>({
    items: [],
    nextCursor: null,
  })
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [olderCursor, setOlderCursor] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [loadingConversation, setLoadingConversation] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pending, start] = useTransition()
  const threadRef = useRef<HTMLDivElement>(null)
  const historyRequestRef = useRef(0)
  const optimisticSequenceRef = useRef(0)
  const optimisticIdPrefix = useId()

  const refreshConversations = useCallback(
    async (query: string) => {
      const requestId = ++historyRequestRef.current
      setLoadingHistory(true)
      setHistoryError(null)
      try {
        const page = await listConversationPage({ scope, scopeRefId, query })
        if (historyRequestRef.current === requestId) setConversationPage(page)
      } catch {
        if (historyRequestRef.current === requestId) {
          setHistoryError('Conversation history could not be loaded.')
        }
      } finally {
        if (historyRequestRef.current === requestId) setLoadingHistory(false)
      }
    },
    [scope, scopeRefId],
  )

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => void refreshConversations(''), 0)
    return () => window.clearTimeout(timer)
  }, [open, refreshConversations])

  useEffect(() => {
    if (!open || !showHistory) return
    const timer = window.setTimeout(() => void refreshConversations(historyQuery), 250)
    return () => window.clearTimeout(timer)
  }, [historyQuery, open, refreshConversations, showHistory])

  const scrollToBottom = useCallback(() => {
    window.requestAnimationFrame(() => {
      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
    })
  }, [])

  const loadConversation = async (id: string) => {
    setShowHistory(false)
    setLoadingConversation(true)
    setHistoryError(null)
    try {
      const page = await getConversationMessagePage({ conversationId: id })
      setConversationId(id)
      setMessages(page.items)
      setOlderCursor(page.olderCursor)
      scrollToBottom()
    } catch {
      setShowHistory(true)
      toast.error('This conversation could not be loaded.')
    } finally {
      setLoadingConversation(false)
    }
  }

  const newChat = () => {
    setConversationId(null)
    setMessages([])
    setOlderCursor(null)
    setShowHistory(false)
    setInput('')
  }

  const send = (text: string) => {
    const prompt = text.trim()
    if (prompt.length < 2 || pending) return
    setInput('')
    optimisticSequenceRef.current += 1
    const optimisticId = `${optimisticIdPrefix}_${optimisticSequenceRef.current}`
    // Optimistic user bubble.
    setMessages((m) => [
      ...m,
      { id: optimisticId, role: 'user', content: prompt, data: null, createdAt: '' },
    ])
    scrollToBottom()
    start(async () => {
      try {
        const res = await onSend(conversationId, prompt)
        if (!res.ok) toast.error(res.error ?? 'The assistant could not respond')
        const cid = res.conversationId ?? conversationId
        if (cid) {
          setConversationId(cid)
          const page = await getConversationMessagePage({ conversationId: cid })
          setMessages(page.items)
          setOlderCursor(page.olderCursor)
          scrollToBottom()
        } else {
          setMessages((current) => current.filter((message) => message.id !== optimisticId))
        }
        await refreshConversations(historyQuery)
      } catch {
        setMessages((current) => current.filter((message) => message.id !== optimisticId))
        toast.error('The assistant could not respond. Please try again.')
      }
    })
  }

  const loadOlderMessages = async () => {
    if (!conversationId || !olderCursor || loadingOlder) return
    const scroller = threadRef.current
    const previousHeight = scroller?.scrollHeight ?? 0
    const previousTop = scroller?.scrollTop ?? 0
    setLoadingOlder(true)
    try {
      const page = await getConversationMessagePage({
        conversationId,
        cursor: olderCursor,
      })
      setMessages((current) => {
        const ids = new Set(page.items.map((message) => message.id))
        return [...page.items, ...current.filter((message) => !ids.has(message.id))]
      })
      setOlderCursor(page.olderCursor)
      window.requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop = previousTop + scroller.scrollHeight - previousHeight
      })
    } catch {
      toast.error('Older messages could not be loaded.')
    } finally {
      setLoadingOlder(false)
    }
  }

  const loadMoreConversations = async () => {
    if (!conversationPage.nextCursor || loadingMore) return
    setLoadingMore(true)
    setHistoryError(null)
    try {
      const next = await listConversationPage({
        scope,
        scopeRefId,
        query: historyQuery,
        cursor: conversationPage.nextCursor,
      })
      setConversationPage((current) => {
        const seen = new Set(current.items.map((item) => item.id))
        return {
          items: [...current.items, ...next.items.filter((item) => !seen.has(item.id))],
          nextCursor: next.nextCursor,
        }
      })
    } catch {
      setHistoryError('More conversations could not be loaded.')
    } finally {
      setLoadingMore(false)
    }
  }

  const removeConversation = (id: string) => {
    start(async () => {
      try {
        await deleteConversation(id)
        if (id === conversationId) newChat()
        setConversationPage((page) => ({
          ...page,
          items: page.items.filter((item) => item.id !== id),
        }))
        await refreshConversations(historyQuery)
      } catch {
        toast.error('The conversation could not be deleted.')
      }
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
            <label className="relative mb-2 block">
              <span className="sr-only">Search chats</span>
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={historyQuery}
                maxLength={AI_CONVERSATION_SEARCH_MAX_CHARS}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="Search chats"
                className="h-9 w-full rounded-md border border-slate-200 bg-white pr-8 pl-8 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              {loadingHistory ? (
                <Loader2 className="absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-slate-400" />
              ) : null}
            </label>
            {historyError ? (
              <p role="alert" className="px-1 py-2 text-xs text-red-600 dark:text-red-400">
                {historyError}
              </p>
            ) : null}
            {!loadingHistory && conversationPage.items.length === 0 ? (
              <p className="px-1 py-4 text-center text-xs text-slate-400 dark:text-slate-500">
                {historyQuery ? 'No matching chats.' : 'No conversations yet.'}
              </p>
            ) : (
              conversationPage.items.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                    c.id === conversationId
                      ? 'bg-violet-50 dark:bg-violet-950/40'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void loadConversation(c.id)}
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
            {conversationPage.nextCursor ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 w-full justify-center"
                disabled={loadingMore}
                onClick={() => void loadMoreConversations()}
              >
                {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
                Load more
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div
              ref={threadRef}
              className="app-scroll min-h-0 flex-1 space-y-3 overflow-y-auto py-3"
            >
              {loadingConversation ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                  <span className="sr-only">Loading conversation</span>
                </div>
              ) : messages.length === 0 ? (
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
                <>
                  {olderCursor ? (
                    <div className="flex justify-center pb-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={loadingOlder}
                        onClick={() => void loadOlderMessages()}
                      >
                        {loadingOlder ? <Loader2 size={14} className="animate-spin" /> : null}
                        Load older messages
                      </Button>
                    </div>
                  ) : null}
                  {messages.map((m) => (
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
                  ))}
                </>
              )}
            </div>

            <div className="flex shrink-0 items-end gap-2 border-t border-slate-200 pt-2 dark:border-slate-800">
              <Textarea
                rows={2}
                value={input}
                maxLength={8_000}
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
