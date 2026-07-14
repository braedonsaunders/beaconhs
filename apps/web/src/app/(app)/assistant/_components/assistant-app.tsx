'use client'

// The assistant experience: multi-conversation sidebar + streaming thread with
// tool-use cards + composer. Streams via the UI-message protocol (readUIMessageStream)
// so the SAME parts[] renderer serves live tokens and reloaded transcripts.

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessageChunk,
} from 'ai'
import {
  MoreHorizontal,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Send,
  Search,
  Share2,
  Sparkles,
  Square,
  Trash2,
  Users,
} from 'lucide-react'
import { Button, EmptyState, cn } from '@beaconhs/ui'
import { confirmDialog } from '@/lib/confirm'
import { MAX_ASSISTANT_PROMPT_CHARS } from '@/lib/assistant/limits'
import {
  AI_CONVERSATION_SEARCH_MAX_CHARS,
  AI_CONVERSATION_TITLE_MAX_CHARS,
} from '@/lib/ai-conversation-pagination'
import {
  getConversationMessagePage,
  listConversationPage,
  listSharedConversationPage,
  type AiChatMessage,
  type AiConversationPage,
  type AiConversationSummary,
} from '@/lib/ai-conversations'
import { toast } from '@/lib/toast'
import { deleteAssistantConversation, renameAssistantConversation } from '../_actions'
import { MessageParts } from './message-parts'
import { ShareDrawer } from './share-drawer'
import { DocumentReaderProvider } from './document-reader'

type Role = 'user' | 'assistant' | 'system'
type ChatMessage = { id: string; role: Role; parts: unknown[] }
type Convo = AiConversationSummary

function toChatMessage(message: AiChatMessage): ChatMessage {
  const storedParts = message.data && (message.data as { parts?: unknown }).parts
  return {
    id: message.id,
    role: message.role,
    parts:
      Array.isArray(storedParts) && storedParts.length > 0
        ? storedParts
        : [{ type: 'text', text: message.content }],
  }
}

function mergeConversations(
  current: AiConversationSummary[],
  incoming: AiConversationSummary[],
): AiConversationSummary[] {
  const seen = new Set(current.map((item) => item.id))
  return [...current, ...incoming.filter((item) => !seen.has(item.id))]
}

function withPinnedConversation(
  page: AiConversationPage,
  pinned: AiConversationSummary | null,
  shared: boolean,
): AiConversationPage {
  if (
    !pinned ||
    Boolean(pinned.shared) !== shared ||
    page.items.some((item) => item.id === pinned.id)
  ) {
    return page
  }
  return { ...page, items: [pinned, ...page.items] }
}

function withLastAssistantParts(list: ChatMessage[], parts: unknown[]): ChatMessage[] {
  const copy = list.slice()
  for (let index = copy.length - 1; index >= 0; index -= 1) {
    const message = copy[index]
    if (message && message.role === 'assistant') {
      copy[index] = { ...message, parts }
      break
    }
  }
  return copy
}

export function AssistantApp({
  ownConversations,
  sharedConversations,
  activeId,
  initialMessages,
  initialOlderCursor,
  access,
  canWrite,
  aiEnabled,
  initialPrompt,
  defaultSidebarCollapsed = false,
}: {
  ownConversations: AiConversationPage
  sharedConversations: AiConversationPage
  activeId: string | null
  initialMessages: ChatMessage[]
  initialOlderCursor: string | null
  access: 'owner' | 'shared' | 'none'
  canWrite: boolean
  aiEnabled: boolean
  initialPrompt?: string
  defaultSidebarCollapsed?: boolean
}) {
  const router = useRouter()
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [olderCursor, setOlderCursor] = useState(initialOlderCursor)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [ownPage, setOwnPage] = useState(ownConversations)
  const [sharedPage, setSharedPage] = useState(sharedConversations)
  const [chatQuery, setChatQuery] = useState('')
  const [searchingChats, setSearchingChats] = useState(false)
  const [loadingOwn, setLoadingOwn] = useState(false)
  const [loadingShared, setLoadingShared] = useState(false)
  const [sidebarError, setSidebarError] = useState<string | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(activeId)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [shareFor, setShareFor] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(defaultSidebarCollapsed)
  const [, startTransition] = useTransition()
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const searchRequestRef = useRef(0)
  const skippedInitialSearch = useRef(false)
  const pinnedConversationRef = useRef<AiConversationSummary | null>(
    [...ownConversations.items, ...sharedConversations.items].find(
      (item) => item.id === activeId,
    ) ?? null,
  )
  const autoSentPrompt = useRef<string | null>(null)
  const readOnly = access === 'shared'
  const canSend = aiEnabled && !readOnly

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [activeId])

  useEffect(() => {
    if (!skippedInitialSearch.current) {
      skippedInitialSearch.current = true
      return
    }
    const requestId = ++searchRequestRef.current
    const timer = window.setTimeout(() => {
      setSearchingChats(true)
      setSidebarError(null)
      void Promise.all([
        listConversationPage({ scope: 'assistant', query: chatQuery }),
        listSharedConversationPage({ scope: 'assistant', query: chatQuery }),
      ])
        .then(([own, shared]) => {
          if (searchRequestRef.current !== requestId) return
          const pin = chatQuery.trim() ? null : pinnedConversationRef.current
          setOwnPage(withPinnedConversation(own, pin, false))
          setSharedPage(withPinnedConversation(shared, pin, true))
        })
        .catch(() => {
          if (searchRequestRef.current === requestId) {
            setSidebarError('Conversation search failed. Try again.')
          }
        })
        .finally(() => {
          if (searchRequestRef.current === requestId) setSearchingChats(false)
        })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [chatQuery])

  const scrollToBottom = useCallback(() => {
    window.requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }))
  }, [])

  const reconcileMessages = useCallback(async (conversationId: string) => {
    const page = await getConversationMessagePage({ conversationId })
    setMessages(page.items.map(toChatMessage))
    setOlderCursor(page.olderCursor)
  }, [])

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim()
      if (!text || abortRef.current || !canSend) return
      if (text.length > MAX_ASSISTANT_PROMPT_CHARS) {
        setError(
          `Messages must be ${MAX_ASSISTANT_PROMPT_CHARS.toLocaleString()} characters or fewer.`,
        )
        return
      }

      const conversationId = currentId
      let resolvedConversationId = conversationId
      const ac = new AbortController()
      abortRef.current = ac
      setError(null)
      setInput('')
      setSidebarOpen(false)
      const stamp = Date.now()
      setMessages((prev) => [
        ...prev,
        { id: `u-${stamp}`, role: 'user', parts: [{ type: 'text', text }] },
        { id: `a-${stamp}`, role: 'assistant', parts: [] },
      ])
      scrollToBottom()
      setStreaming(true)
      try {
        const res = await fetch('/assistant/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ conversationId, prompt: text }),
          signal: ac.signal,
        })
        const responseConversationId = res.headers.get('x-conversation-id')
        if (responseConversationId) {
          resolvedConversationId = responseConversationId
          setCurrentId(responseConversationId)
          if (!conversationId) {
            window.history.replaceState(null, '', `/assistant/${responseConversationId}`)
          }
        }
        if (!res.ok || !res.body) {
          setError(
            res.status === 503
              ? "The assistant isn't configured for this workspace yet. An admin can enable it under Admin → AI."
              : res.status === 403
                ? 'You can only continue conversations you own.'
                : 'The assistant could not respond. Please try again.',
          )
          return
        }
        // The HTTP body is an SSE byte stream — parse it into UIMessageChunks
        // before handing it to readUIMessageStream (matches the SDK transport).
        const chunkStream = parseJsonEventStream({
          stream: res.body,
          schema: uiMessageChunkSchema,
        }).pipeThrough(
          new TransformStream<{ success: boolean; value?: UIMessageChunk }, UIMessageChunk>({
            transform(part, controller) {
              if (part.success && part.value) controller.enqueue(part.value)
            },
          }),
        )
        for await (const message of readUIMessageStream({ stream: chunkStream })) {
          setMessages((prev) => withLastAssistantParts(prev, message.parts as unknown[]))
          scrollToBottom()
        }
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') {
          setError('The assistant could not respond. Please try again.')
        }
      } finally {
        if ((ac.signal.aborted || !resolvedConversationId) && !resolvedConversationId) {
          setMessages((prev) =>
            prev.filter((message) => message.id !== `u-${stamp}` && message.id !== `a-${stamp}`),
          )
        } else if (resolvedConversationId) {
          if (ac.signal.aborted) {
            await new Promise((resolve) => window.setTimeout(resolve, 150))
          }
          try {
            await reconcileMessages(resolvedConversationId)
            setOwnPage((page) => {
              const current = page.items.find((item) => item.id === resolvedConversationId)
              if (!current) return page
              return {
                ...page,
                items: [
                  current,
                  ...page.items.filter((item) => item.id !== resolvedConversationId),
                ],
              }
            })
          } catch {
            setMessages((prev) => prev.filter((message) => message.id !== `a-${stamp}`))
            setError((current) => current ?? 'The saved conversation could not be refreshed.')
          }
        }
        setStreaming(false)
        if (abortRef.current === ac) abortRef.current = null
        if (resolvedConversationId && !conversationId) {
          router.replace(`/assistant/${resolvedConversationId}`, { scroll: false })
        } else {
          startTransition(() => router.refresh())
        }
      }
    },
    [canSend, currentId, reconcileMessages, router, scrollToBottom],
  )

  // Auto-send a prompt passed via ?q= (from the ⌘K launcher) once per distinct
  // query. Wait for any active turn to finish so navigation cannot drop it.
  useEffect(() => {
    const prompt = initialPrompt?.trim()
    if (!prompt || !canSend || streaming || abortRef.current || autoSentPrompt.current === prompt) {
      return
    }
    autoSentPrompt.current = prompt
    void send(prompt)
  }, [canSend, initialPrompt, send, streaming])

  function stop() {
    abortRef.current?.abort()
  }

  async function loadOlderMessages() {
    if (!currentId || !olderCursor || loadingOlder) return
    const scroller = threadRef.current
    const previousHeight = scroller?.scrollHeight ?? 0
    const previousTop = scroller?.scrollTop ?? 0
    setLoadingOlder(true)
    try {
      const page = await getConversationMessagePage({
        conversationId: currentId,
        cursor: olderCursor,
      })
      setMessages((current) => {
        const ids = new Set(page.items.map((message) => message.id))
        return [
          ...page.items.map(toChatMessage),
          ...current.filter((message) => !ids.has(message.id)),
        ]
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

  async function loadMoreConversations(kind: 'own' | 'shared') {
    const page = kind === 'own' ? ownPage : sharedPage
    if (!page.nextCursor || (kind === 'own' ? loadingOwn : loadingShared)) return
    if (kind === 'own') setLoadingOwn(true)
    else setLoadingShared(true)
    setSidebarError(null)
    try {
      const requestId = searchRequestRef.current
      const next =
        kind === 'own'
          ? await listConversationPage({
              scope: 'assistant',
              query: chatQuery,
              cursor: page.nextCursor,
            })
          : await listSharedConversationPage({
              scope: 'assistant',
              query: chatQuery,
              cursor: page.nextCursor,
            })
      if (searchRequestRef.current !== requestId) return
      const update = (current: AiConversationPage): AiConversationPage => ({
        items: mergeConversations(current.items, next.items),
        nextCursor: next.nextCursor,
      })
      if (kind === 'own') setOwnPage(update)
      else setSharedPage(update)
    } catch {
      setSidebarError('More conversations could not be loaded.')
    } finally {
      if (kind === 'own') setLoadingOwn(false)
      else setLoadingShared(false)
    }
  }

  function toggleSidebar() {
    setSidebarCollapsed((v) => {
      const next = !v
      // Persist via cookie so the page re-renders with the right width (no flash
      // / hydration mismatch), matching the main app sidebar's approach.
      document.cookie = `assistant_sidebar_collapsed=${next ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`
      return next
    })
  }

  function onComposerKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault()
      void send(input)
    }
  }

  async function doRename(id: string, title: string) {
    setRenamingId(null)
    if (!title.trim()) return
    try {
      await renameAssistantConversation(id, title.trim())
      if (pinnedConversationRef.current?.id === id) {
        pinnedConversationRef.current = { ...pinnedConversationRef.current, title: title.trim() }
      }
      setOwnPage((page) => ({
        ...page,
        items: page.items.map((item) => (item.id === id ? { ...item, title: title.trim() } : item)),
      }))
      startTransition(() => router.refresh())
    } catch {
      toast.error(`Chat titles must be ${AI_CONVERSATION_TITLE_MAX_CHARS} characters or fewer.`)
    }
  }

  async function doDelete(id: string) {
    setMenuFor(null)
    if (
      !(await confirmDialog({
        message: 'Delete this conversation? This cannot be undone.',
        tone: 'danger',
      }))
    )
      return
    await deleteAssistantConversation(id)
    setOwnPage((page) => ({
      ...page,
      items: page.items.filter((item) => item.id !== id),
    }))
    if (id === currentId) router.push('/assistant')
    else startTransition(() => router.refresh())
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 p-3">
        <Link href="/assistant" className="min-w-0 flex-1">
          <Button variant="outline" className="w-full justify-start gap-2">
            <Plus className="h-4 w-4" />
            New chat
          </Button>
        </Link>
        <button
          type="button"
          onClick={toggleSidebar}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 lg:flex dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      <div className="px-3 pb-2">
        <label className="relative block">
          <span className="sr-only">Search chats</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={chatQuery}
            maxLength={AI_CONVERSATION_SEARCH_MAX_CHARS}
            onChange={(event) => setChatQuery(event.target.value)}
            placeholder="Search chats"
            className="h-9 w-full rounded-md border border-slate-200 bg-white pr-8 pl-8 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          {searchingChats ? (
            <Loader2 className="absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-slate-400" />
          ) : null}
        </label>
      </div>
      <div className="app-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-3">
        {sidebarError ? (
          <p role="alert" className="px-2 text-xs text-red-600 dark:text-red-400">
            {sidebarError}
          </p>
        ) : null}
        <ConvoSection
          label="Your chats"
          convos={ownPage.items}
          currentId={currentId}
          menuFor={menuFor}
          setMenuFor={setMenuFor}
          renamingId={renamingId}
          setRenamingId={setRenamingId}
          onRename={doRename}
          onShare={(id) => {
            setMenuFor(null)
            setShareFor(id)
          }}
          onDelete={doDelete}
          hasMore={ownPage.nextCursor !== null}
          loadingMore={loadingOwn}
          onLoadMore={() => void loadMoreConversations('own')}
          emptyLabel={chatQuery ? 'No matching chats.' : 'No conversations yet.'}
        />
        {sharedPage.items.length > 0 ? (
          <ConvoSection
            label="Shared with you"
            convos={sharedPage.items}
            currentId={currentId}
            shared
            hasMore={sharedPage.nextCursor !== null}
            loadingMore={loadingShared}
            onLoadMore={() => void loadMoreConversations('shared')}
          />
        ) : null}
      </div>
    </div>
  )

  return (
    <DocumentReaderProvider>
      <div className="flex h-full min-h-0">
        {/* Desktop sidebar — collapses to a thin icon rail */}
        {sidebarCollapsed ? (
          <aside className="hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-white py-3 lg:flex dark:border-slate-800 dark:bg-slate-900">
            <button
              type="button"
              onClick={toggleSidebar}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              className="flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
            <Link
              href="/assistant"
              title="New chat"
              aria-label="New chat"
              className="flex h-9 w-9 items-center justify-center rounded-md text-teal-700 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/40"
            >
              <Plus className="h-4 w-4" />
            </Link>
          </aside>
        ) : (
          <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col dark:border-slate-800 dark:bg-slate-900">
            {sidebar}
          </aside>
        )}

        {/* Mobile sidebar drawer */}
        {sidebarOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 w-72 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              {sidebar}
            </div>
          </div>
        ) : null}

        {/* Thread pane */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-3 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800"
              aria-label="Conversations"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <Sparkles className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              Assistant
            </div>
            {readOnly ? (
              <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                Shared · read-only
              </span>
            ) : currentId ? (
              <button
                type="button"
                onClick={() => setShareFor(currentId)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <Share2 className="h-3.5 w-3.5" />
                Share
              </button>
            ) : null}
          </header>

          <div ref={threadRef} className="app-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-6">
              {olderCursor && messages.length > 0 ? (
                <div className="mb-5 flex justify-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={loadingOlder}
                    onClick={() => void loadOlderMessages()}
                  >
                    {loadingOlder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Load older messages
                  </Button>
                </div>
              ) : null}
              {messages.length === 0 ? (
                <Welcome onPick={(t) => setInput(t)} canSend={canSend} />
              ) : (
                <div className="space-y-6">
                  {messages.map((m) =>
                    m.role === 'system' ? null : (
                      <MessageRow key={m.id} message={m} streaming={streaming} />
                    ),
                  )}
                </div>
              )}
              {error ? (
                <div
                  role="alert"
                  className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
                >
                  {error}
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* Composer */}
          <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="mx-auto w-full max-w-3xl">
              {readOnly ? (
                <p className="py-2 text-center text-sm text-slate-500 dark:text-slate-400">
                  This conversation was shared with you. Only the owner can continue it.
                </p>
              ) : !aiEnabled ? (
                <p className="py-2 text-center text-sm text-slate-500 dark:text-slate-400">
                  The assistant isn’t configured for this workspace yet. An admin can enable it
                  under Admin → AI.
                </p>
              ) : (
                <div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onComposerKey}
                    maxLength={MAX_ASSISTANT_PROMPT_CHARS}
                    rows={1}
                    placeholder="Ask about incidents, corrective actions, training, documents…"
                    className="max-h-40 flex-1 resize-none appearance-none overflow-y-auto border-0 bg-transparent px-2 py-1.5 text-base text-slate-900 shadow-none outline-none placeholder:text-slate-400 focus:border-0 focus:ring-0 focus:outline-none sm:text-sm dark:text-slate-100"
                  />
                  {streaming ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={stop}
                      aria-label="Stop"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="icon"
                      onClick={() => void send(input)}
                      disabled={!input.trim()}
                      aria-label="Send"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
              {canWrite && !readOnly ? (
                <p className="mt-1.5 text-center text-[11px] text-slate-400 dark:text-slate-500">
                  The assistant drafts changes for your approval — nothing is created until you
                  confirm.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <ShareDrawer
          conversationId={shareFor}
          open={shareFor !== null}
          onClose={() => setShareFor(null)}
        />
      </div>
    </DocumentReaderProvider>
  )
}

function MessageRow({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  if (message.role === 'user') {
    const text = (
      message.parts.find((p) => (p as { type?: string })?.type === 'text') as
        { text?: string } | undefined
    )?.text
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-teal-700 px-4 py-2 text-sm whitespace-pre-wrap text-white">
          {text}
        </div>
      </div>
    )
  }
  const empty = message.parts.length === 0
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-teal-700 text-white shadow-sm">
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        {empty && streaming ? <ThinkingDots /> : <MessageParts parts={message.parts} />}
      </div>
    </div>
  )
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1.5 text-slate-400">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  )
}

const SUGGESTIONS = [
  'How many open incidents do we have, and summarize the most recent one?',
  'List corrective actions that are overdue.',
  "What's on my plate right now?",
  'Find documents about lockout / tagout.',
]

function Welcome({ onPick, canSend }: { onPick: (t: string) => void; canSend: boolean }) {
  return (
    <div className="pt-10">
      <EmptyState
        icon={<Sparkles />}
        title="Ask the Assistant"
        description="Find and understand your safety data — incidents, corrective actions, training, documents and more. Answers are scoped to what you’re allowed to see."
      />
      {canSend ? (
        <div className="mx-auto mt-6 grid max-w-2xl gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-600 shadow-sm transition-colors hover:border-teal-300 hover:bg-teal-50/40 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-teal-800 dark:hover:bg-teal-950/30 dark:hover:text-slate-100"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ConvoSection({
  label,
  convos,
  currentId,
  shared,
  menuFor,
  setMenuFor,
  renamingId,
  setRenamingId,
  onRename,
  onShare,
  onDelete,
  hasMore,
  loadingMore,
  onLoadMore,
  emptyLabel = 'No conversations yet.',
}: {
  label: string
  convos: Convo[]
  currentId: string | null
  shared?: boolean
  menuFor?: string | null
  setMenuFor?: (id: string | null) => void
  renamingId?: string | null
  setRenamingId?: (id: string | null) => void
  onRename?: (id: string, title: string) => void
  onShare?: (id: string) => void
  onDelete?: (id: string) => void
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  emptyLabel?: string
}) {
  if (convos.length === 0 && !shared) {
    return (
      <div>
        <SectionLabel>{label}</SectionLabel>
        <p className="px-2 py-1 text-xs text-slate-400 dark:text-slate-500">{emptyLabel}</p>
      </div>
    )
  }
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <ul className="space-y-0.5">
        {convos.map((c) => {
          const active = c.id === currentId
          if (renamingId === c.id) {
            return (
              <li key={c.id} className="px-1">
                <input
                  autoFocus
                  defaultValue={c.title}
                  maxLength={AI_CONVERSATION_TITLE_MAX_CHARS}
                  onBlur={(e) => onRename?.(c.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onRename?.(c.id, (e.target as HTMLInputElement).value)
                    if (e.key === 'Escape') setRenamingId?.(null)
                  }}
                  className="w-full rounded-md border border-teal-400 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none dark:bg-slate-950 dark:text-slate-100"
                />
              </li>
            )
          }
          return (
            <li key={c.id} className="group relative">
              <Link
                href={`/assistant/${c.id}`}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                  active
                    ? 'bg-teal-50 text-teal-900 dark:bg-teal-950/50 dark:text-teal-100'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                {shared ? <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : null}
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
              </Link>
              {!shared ? (
                <button
                  type="button"
                  onClick={() => setMenuFor?.(menuFor === c.id ? null : c.id)}
                  className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-1 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700"
                  aria-label="Conversation actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              ) : null}
              {menuFor === c.id ? (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuFor?.(null)} />
                  <div className="absolute top-9 right-1 z-20 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    <MenuItem
                      icon={<Pencil className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setMenuFor?.(null)
                        setRenamingId?.(c.id)
                      }}
                    >
                      Rename
                    </MenuItem>
                    <MenuItem
                      icon={<Share2 className="h-3.5 w-3.5" />}
                      onClick={() => onShare?.(c.id)}
                    >
                      Share
                    </MenuItem>
                    <MenuItem
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                      destructive
                      onClick={() => onDelete?.(c.id)}
                    >
                      Delete
                    </MenuItem>
                  </div>
                </>
              ) : null}
            </li>
          )
        })}
      </ul>
      {hasMore ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-center text-xs"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Load more
        </Button>
      ) : null}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
      {children}
    </div>
  )
}

function MenuItem({
  icon,
  children,
  onClick,
  destructive,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
        destructive
          ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
      )}
    >
      {icon}
      {children}
    </button>
  )
}
