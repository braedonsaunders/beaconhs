'use client'

// Comments rail: threads anchored to `comment` marks. New comments attach to the
// current selection; threads sort by document position; threads whose anchored
// text was deleted move to a "Detached" section (Google-Docs behavior).

import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Check, CornerDownRight, MessageSquarePlus, Trash2, X, RotateCcw } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import { addComment, deleteComment, replyToComment, resolveComment } from '../_actions'
import type { EditorComment } from './_lib'

export function CommentsPanel({
  editor,
  documentId,
  comments,
  onChanged,
  onClose,
}: {
  editor: Editor
  documentId: string
  comments: EditorComment[]
  onChanged: () => Promise<void> | void
  onClose: () => void
}) {
  const [body, setBody] = useState('')
  const [replyFor, setReplyFor] = useState<string | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const [busy, setBusy] = useState(false)

  // Live comment ids + their first document position (recomputed each render).
  const posById = new Map<string, number>()
  const markType = editor.schema.marks.comment
  editor.state.doc.descendants((node, pos) => {
    node.marks.forEach((m) => {
      if (m.type === markType && m.attrs.commentId && !posById.has(m.attrs.commentId)) {
        posById.set(m.attrs.commentId, pos)
      }
    })
  })

  const roots = comments.filter((c) => !c.threadId)
  const repliesByThread = new Map<string, EditorComment[]>()
  for (const c of comments) {
    if (c.threadId) {
      const arr = repliesByThread.get(c.threadId) ?? []
      arr.push(c)
      repliesByThread.set(c.threadId, arr)
    }
  }
  const isLive = (c: EditorComment) => !c.anchorId || posById.has(c.anchorId)
  const sortByPos = (a: EditorComment, b: EditorComment) =>
    (posById.get(a.anchorId ?? '') ?? Number.MAX_SAFE_INTEGER) -
    (posById.get(b.anchorId ?? '') ?? Number.MAX_SAFE_INTEGER)

  const liveRoots = roots.filter(isLive).sort(sortByPos)
  const detachedRoots = roots.filter((r) => r.anchorId && !posById.has(r.anchorId))

  const sel = editor.state.selection
  const hasSelection = !sel.empty
  const quoted = hasSelection ? editor.state.doc.textBetween(sel.from, sel.to, ' ') : ''

  function focusComment(commentId: string | null) {
    if (!commentId) return
    let range: { from: number; to: number } | null = null
    editor.state.doc.descendants((node, pos) => {
      if (range) return false
      if (node.isText && node.marks.some((m) => m.type === markType && m.attrs.commentId === commentId)) {
        range = { from: pos, to: pos + node.nodeSize }
      }
      return true
    })
    if (range) editor.chain().setTextSelection(range).scrollIntoView().run()
  }

  async function submitNew() {
    if (!body.trim() || !hasSelection || busy) return
    setBusy(true)
    const anchorId = crypto.randomUUID()
    editor.chain().focus().setComment(anchorId).run()
    await addComment({ documentId, anchorId, quotedText: quoted.slice(0, 2000), body: body.trim() })
    setBody('')
    await onChanged()
    setBusy(false)
  }

  async function submitReply(threadId: string) {
    if (!replyBody.trim() || busy) return
    setBusy(true)
    await replyToComment({ documentId, threadId, body: replyBody.trim() })
    setReplyBody('')
    setReplyFor(null)
    await onChanged()
    setBusy(false)
  }

  async function toggleResolve(root: EditorComment) {
    setBusy(true)
    const resolved = !root.resolvedAt
    await resolveComment({ id: root.id, resolved })
    if (root.anchorId) editor.commands.resolveCommentMark(root.anchorId, resolved)
    await onChanged()
    setBusy(false)
  }

  async function del(root: EditorComment) {
    if (!window.confirm('Delete this comment thread?')) return
    setBusy(true)
    await deleteComment({ id: root.id })
    if (root.anchorId) editor.commands.unsetComment(root.anchorId)
    await onChanged()
    setBusy(false)
  }

  function renderThread(root: EditorComment, detached = false) {
    const replies = (repliesByThread.get(root.id) ?? []).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    )
    return (
      <div
        key={root.id}
        className={cn(
          'rounded-lg border bg-white dark:bg-slate-900 p-2.5 text-sm shadow-sm',
          root.resolvedAt ? 'border-slate-200 dark:border-slate-800 opacity-70' : 'border-slate-200 dark:border-slate-800',
        )}
      >
        {root.quotedText ? (
          <button
            type="button"
            onClick={() => focusComment(root.anchorId)}
            className={cn(
              'mb-1.5 block w-full truncate rounded border-l-2 px-2 py-0.5 text-left text-xs italic',
              detached
                ? 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-400 dark:text-slate-500'
                : 'border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 text-slate-600 dark:text-slate-300 hover:bg-amber-100 dark:hover:bg-amber-950/60',
            )}
            title={detached ? 'Original text was removed' : 'Jump to comment'}
          >
            “{root.quotedText}”
          </button>
        ) : null}
        <Comment c={root} />
        {replies.map((r) => (
          <div key={r.id} className="mt-2 border-l border-slate-100 dark:border-slate-800 pl-2">
            <Comment c={r} />
          </div>
        ))}

        {replyFor === root.id ? (
          <div className="mt-2">
            <textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              rows={2}
              placeholder="Reply…"
              className="w-full rounded border border-slate-200 dark:border-slate-800 px-2 py-1 text-sm outline-none focus:border-teal-400"
            />
            <div className="mt-1 flex justify-end gap-1.5">
              <button type="button" onClick={() => setReplyFor(null)} className="rounded px-2 py-0.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={() => submitReply(root.id)} className="rounded bg-teal-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-60">
                Reply
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-1.5 flex items-center gap-2 text-xs">
            <button type="button" onClick={() => setReplyFor(root.id)} className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
              <CornerDownRight size={12} /> Reply
            </button>
            <button type="button" onClick={() => toggleResolve(root)} className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-teal-700">
              {root.resolvedAt ? <><RotateCcw size={12} /> Reopen</> : <><Check size={12} /> Resolve</>}
            </button>
            <button type="button" onClick={() => del(root)} className="ml-auto inline-flex items-center gap-1 text-slate-400 dark:text-slate-500 hover:text-rose-600">
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="doc-flyout absolute inset-y-0 right-0 z-30 flex w-80 max-w-[92%] flex-col border-l border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-3 py-2">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Comments</span>
        <button type="button" onClick={onClose} className="grid h-7 w-7 place-items-center rounded text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="Close comments">
          <X size={15} />
        </button>
      </div>

      <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        {hasSelection ? (
          <>
            <div className="mb-1 truncate rounded border-l-2 border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-xs italic text-slate-600 dark:text-slate-300">
              “{quoted}”
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              placeholder="Add a comment…"
              className="w-full rounded border border-slate-200 dark:border-slate-800 px-2 py-1 text-sm outline-none focus:border-teal-400"
            />
            <div className="mt-1 flex justify-end">
              <button type="button" disabled={busy || !body.trim()} onClick={submitNew} className="inline-flex items-center gap-1 rounded bg-teal-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-60">
                <MessageSquarePlus size={13} /> Comment
              </button>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500">Select text in the document to add a comment.</p>
        )}
      </div>

      <div className="app-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {liveRoots.length === 0 && detachedRoots.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-slate-500">No comments yet.</p>
        ) : null}
        {liveRoots.map((r) => renderThread(r))}

        {detachedRoots.length > 0 ? (
          <div className="pt-2">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Detached · original text removed
            </p>
            <div className="space-y-2">{detachedRoots.map((r) => renderThread(r, true))}</div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function Comment({ c }: { c: EditorComment }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">{c.authorName}</span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">{new Date(c.createdAt).toLocaleDateString()}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{c.body}</p>
    </div>
  )
}
