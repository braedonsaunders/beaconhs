'use client'

// The assistant experience: multi-conversation sidebar + streaming thread with
// tool-use cards + composer. Streams via the UI-message protocol (readUIMessageStream)
// so the SAME parts[] renderer serves live tokens and reloaded transcripts.

import { useEffect, useRef, useState, useTransition } from 'react'
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
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Send,
  Share2,
  Sparkles,
  Square,
  Trash2,
  Users,
} from 'lucide-react'
import { Button, EmptyState, cn } from '@beaconhs/ui'
import { deleteAssistantConversation, renameAssistantConversation } from '../_actions'
import { MessageParts } from './message-parts'
import { ShareDrawer } from './share-drawer'

type Role = 'user' | 'assistant' | 'system'
type ChatMessage = { id: string; role: Role; parts: unknown[] }
type Convo = { id: string; title: string; updatedAt: string; shared?: boolean }

export function AssistantApp({
  ownConversations,
  sharedConversations,
  activeId,
  initialMessages,
  access,
  canWrite,
  aiEnabled,
  initialPrompt,
  defaultSidebarCollapsed = false,
}: {
  ownConversations: Convo[]
  sharedConversations: Convo[]
  activeId: string | null
  initialMessages: ChatMessage[]
  access: 'owner' | 'shared' | 'none'
  canWrite: boolean
  aiEnabled: boolean
  initialPrompt?: string
  defaultSidebarCollapsed?: boolean
}) {
  const router = useRouter()
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
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
  const autoSent = useRef(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  // Auto-send a prompt passed via ?q= (from the ⌘K launcher), exactly once.
  useEffect(() => {
    if (initialPrompt && !autoSent.current && aiEnabled && access !== 'shared') {
      autoSent.current = true
      send(initialPrompt)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const readOnly = access === 'shared'
  const canSend = aiEnabled && !readOnly

  function withLastAssistantParts(list: ChatMessage[], parts: unknown[]): ChatMessage[] {
    const copy = list.slice()
    for (let i = copy.length - 1; i >= 0; i--) {
      const m = copy[i]
      if (m && m.role === 'assistant') {
        copy[i] = { ...m, parts }
        break
      }
    }
    return copy
  }

  async function send(textArg?: string) {
    const text = (typeof textArg === 'string' ? textArg : input).trim()
    if (!text || streaming || !canSend) return
    setError(null)
    setInput('')
    setSidebarOpen(false)
    const stamp = Date.now()
    setMessages((prev) => [
      ...prev,
      { id: `u-${stamp}`, role: 'user', parts: [{ type: 'text', text }] },
      { id: `a-${stamp}`, role: 'assistant', parts: [] },
    ])
    setStreaming(true)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const res = await fetch('/assistant/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId: currentId, prompt: text }),
        signal: ac.signal,
      })
      if (!res.ok || !res.body) {
        setError(
          res.status === 503
            ? "The assistant isn't configured for this workspace yet. An admin can enable it under Admin → AI."
            : res.status === 403
              ? 'You can only continue conversations you own.'
              : 'The assistant could not respond. Please try again.',
        )
        setMessages((prev) => prev.filter((m) => m.id !== `a-${stamp}`))
        return
      }
      const newId = res.headers.get('x-conversation-id')
      if (newId && !currentId) {
        setCurrentId(newId)
        window.history.replaceState(null, '', `/assistant/${newId}`)
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
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        setError('The assistant could not respond. Please try again.')
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
      startTransition(() => router.refresh())
    }
  }

  function stop() {
    abortRef.current?.abort()
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
      send()
    }
  }

  async function doRename(id: string, title: string) {
    setRenamingId(null)
    if (!title.trim()) return
    await renameAssistantConversation(id, title.trim())
    startTransition(() => router.refresh())
  }

  async function doDelete(id: string) {
    setMenuFor(null)
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return
    await deleteAssistantConversation(id)
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
      <div className="app-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-3">
        <ConvoSection
          label="Your chats"
          convos={ownConversations}
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
        />
        {sharedConversations.length > 0 ? (
          <ConvoSection
            label="Shared with you"
            convos={sharedConversations}
            currentId={currentId}
            shared
          />
        ) : null}
      </div>
    </div>
  )

  return (
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

        <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            {messages.length === 0 ? (
              <Welcome onPick={(t) => setInput(t)} canSend={canSend} />
            ) : (
              <div className="space-y-6">
                {messages.map((m) =>
                  m.role === 'system' ? null : (
                    <MessageRow key={m.id} message={m} streaming={streaming} />
                  ),
                )}
                {error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                    {error}
                  </div>
                ) : null}
              </div>
            )}
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
                The assistant isn’t configured for this workspace yet. An admin can enable it under
                Admin → AI.
              </p>
            ) : (
              <div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-950">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onComposerKey}
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
                    onClick={() => send()}
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
  )
}

function MessageRow({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  if (message.role === 'user') {
    const text = (
      message.parts.find((p) => (p as { type?: string })?.type === 'text') as
        | { text?: string }
        | undefined
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
}) {
  if (convos.length === 0 && !shared) {
    return (
      <div>
        <SectionLabel>{label}</SectionLabel>
        <p className="px-2 py-1 text-xs text-slate-400 dark:text-slate-500">
          No conversations yet.
        </p>
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
