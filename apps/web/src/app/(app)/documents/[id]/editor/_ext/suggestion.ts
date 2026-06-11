// Track-changes ("suggesting") — a custom marks-based system (no paid/Yjs deps).
//
//   • insertion mark  → newly typed text (rendered underlined)
//   • deletion mark   → text the user "deleted" (kept, rendered struck-through)
//
// When suggesting is ON: typed/pasted text is auto-marked as an insertion via
// appendTransaction; Backspace/Delete mark text as a deletion instead of
// removing it. Accept/reject commands resolve the marks. v1 tracks INLINE
// content; block-structure changes (split/merge/heading) apply directly.

import { Extension, Mark, mergeAttributes } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'

function nowIso(): string {
  return new Date().toISOString()
}

const dataAttrs = (kind: 'insertion' | 'deletion') => ({
  userId: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-user-id'),
    renderHTML: (a: Record<string, unknown>) => (a.userId ? { 'data-user-id': a.userId } : {}),
  },
  userName: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-user-name'),
    renderHTML: (a: Record<string, unknown>) =>
      a.userName ? { 'data-user-name': a.userName } : {},
  },
  createdAt: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-created-at'),
    renderHTML: (a: Record<string, unknown>) =>
      a.createdAt ? { 'data-created-at': a.createdAt } : {},
  },
  _kind: { default: kind, rendered: false },
})

export const InsertionMark = Mark.create({
  name: 'insertion',
  inclusive: true,
  addOptions() {
    return { HTMLAttributes: { class: 'suggestion-insert', 'data-insertion': 'true' } }
  },
  addAttributes() {
    return dataAttrs('insertion')
  },
  parseHTML() {
    return [{ tag: 'span[data-insertion]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },
})

export const DeletionMark = Mark.create({
  name: 'deletion',
  inclusive: false,
  addOptions() {
    return { HTMLAttributes: { class: 'suggestion-delete', 'data-deletion': 'true' } }
  },
  addAttributes() {
    return dataAttrs('deletion')
  },
  parseHTML() {
    return [{ tag: 'span[data-deletion]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },
})

export type SuggestionRun = { from: number; to: number; kind: 'insert' | 'delete' }

// Ordered list of contiguous insertion/deletion runs in the document.
export function collectSuggestionRuns(state: EditorState): SuggestionRun[] {
  const insType = state.schema.marks.insertion
  const delType = state.schema.marks.deletion
  const runs: SuggestionRun[] = []
  let cur: SuggestionRun | null = null
  state.doc.descendants((node, pos) => {
    if (!node.isText) {
      if (cur) {
        runs.push(cur)
        cur = null
      }
      return
    }
    const kind = node.marks.some((m) => m.type === delType)
      ? 'delete'
      : node.marks.some((m) => m.type === insType)
        ? 'insert'
        : null
    if (!kind) {
      if (cur) {
        runs.push(cur)
        cur = null
      }
      return
    }
    if (cur && cur.kind === kind && cur.to === pos) {
      cur.to = pos + node.nodeSize
    } else {
      if (cur) runs.push(cur)
      cur = { from: pos, to: pos + node.nodeSize, kind }
    }
  })
  if (cur) runs.push(cur)
  return runs
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    suggestion: {
      setSuggesting: (active: boolean) => ReturnType
      setSuggestionUser: (user: { id: string; name: string }) => ReturnType
      acceptAllSuggestions: () => ReturnType
      rejectAllSuggestions: () => ReturnType
      acceptSuggestionAt: () => ReturnType
      rejectSuggestionAt: () => ReturnType
      gotoNextSuggestion: () => ReturnType
      gotoPrevSuggestion: () => ReturnType
    }
  }
}

export const Suggestion = Extension.create({
  name: 'suggestion',

  addStorage() {
    return { active: false, user: { id: '', name: 'You' } as { id: string; name: string } }
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => (this.storage.active ? handleSuggestDelete(this.editor, 'backward') : false),
      Delete: () => (this.storage.active ? handleSuggestDelete(this.editor, 'forward') : false),
    }
  },

  addCommands() {
    return {
      setSuggesting: (active) => () => {
        this.storage.active = active
        return true
      },
      setSuggestionUser: (user) => () => {
        this.storage.user = user
        return true
      },
      acceptAllSuggestions:
        () =>
        ({ state, dispatch, tr }) => {
          applyResolveAll(state, tr, 'accept')
          if (dispatch) {
            tr.setMeta('suggestionOp', true)
            dispatch(tr)
          }
          return true
        },
      rejectAllSuggestions:
        () =>
        ({ state, dispatch, tr }) => {
          applyResolveAll(state, tr, 'reject')
          if (dispatch) {
            tr.setMeta('suggestionOp', true)
            dispatch(tr)
          }
          return true
        },
      acceptSuggestionAt:
        () =>
        ({ state, dispatch, tr }) => {
          const ok = applyResolveAt(state, tr, state.selection.from, 'accept')
          if (ok && dispatch) {
            tr.setMeta('suggestionOp', true)
            dispatch(tr)
          }
          return ok
        },
      rejectSuggestionAt:
        () =>
        ({ state, dispatch, tr }) => {
          const ok = applyResolveAt(state, tr, state.selection.from, 'reject')
          if (ok && dispatch) {
            tr.setMeta('suggestionOp', true)
            dispatch(tr)
          }
          return ok
        },
      gotoNextSuggestion:
        () =>
        ({ state, dispatch }) =>
          gotoSuggestion(state, dispatch, 1),
      gotoPrevSuggestion:
        () =>
        ({ state, dispatch }) =>
          gotoSuggestion(state, dispatch, -1),
    }
  },

  addProseMirrorPlugins() {
    const ext = this
    return [
      new Plugin({
        key: new PluginKey('suggestionInput'),
        appendTransaction(transactions, _oldState, newState) {
          if (!ext.storage.active) return null
          if (!transactions.some((t) => t.docChanged)) return null
          if (transactions.some((t) => t.getMeta('suggestionOp'))) return null
          const insType = newState.schema.marks.insertion
          const delType = newState.schema.marks.deletion
          if (!insType) return null
          const tr = newState.tr
          const stamp = {
            userId: ext.storage.user.id,
            userName: ext.storage.user.name,
            createdAt: nowIso(),
          }
          let changed = false
          transactions.forEach((transaction) => {
            transaction.steps.forEach((step, i) => {
              step.getMap().forEach((_os, _oe, ns, ne) => {
                if (ne <= ns) return
                const after = transaction.mapping.slice(i + 1)
                const from = after.map(ns, 1)
                const to = after.map(ne, -1)
                if (to > from) {
                  tr.addMark(from, to, insType.create(stamp))
                  if (delType) tr.removeMark(from, to, delType)
                  changed = true
                }
              })
            })
          })
          if (!changed) return null
          tr.setMeta('suggestionOp', true)
          return tr
        },
      }),
    ]
  },
})

// --- helpers ---------------------------------------------------------------

function handleSuggestDelete(editor: Editor, dir: 'backward' | 'forward'): boolean {
  const state = editor.state
  const insType = state.schema.marks.insertion
  const delType = state.schema.marks.deletion
  if (!delType) return false
  const sel = state.selection
  let from: number
  let to: number
  if (!sel.empty) {
    from = sel.from
    to = sel.to
  } else {
    const pos = sel.from
    if (dir === 'backward') {
      from = Math.max(0, pos - 1)
      to = pos
    } else {
      from = pos
      to = Math.min(state.doc.content.size, pos + 1)
    }
  }
  if (from >= to) return false

  // All-insertion (the user's own pending insert) → hard delete.
  let allInsertion = true
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText && !node.marks.some((m) => m.type === insType)) allInsertion = false
  })

  const tr = state.tr
  if (allInsertion) {
    tr.delete(from, to)
    tr.setSelection(TextSelection.create(tr.doc, from))
  } else {
    const stamp = { createdAt: nowIso() }
    tr.addMark(from, to, delType.create(stamp))
    // Continue walking in the direction of travel so repeated presses extend.
    const caret = dir === 'backward' ? from : to
    tr.setSelection(TextSelection.create(tr.doc, Math.min(caret, tr.doc.content.size)))
    tr.setMeta('suggestionOp', true)
  }
  editor.view.dispatch(tr)
  return true
}

function applyResolveAll(state: EditorState, tr: Transaction, mode: 'accept' | 'reject'): void {
  const insType = state.schema.marks.insertion
  const delType = state.schema.marks.deletion
  const insRanges: [number, number][] = []
  const delRanges: [number, number][] = []
  state.doc.descendants((node, pos) => {
    if (!node.isText) return
    if (insType && node.marks.some((m) => m.type === insType))
      insRanges.push([pos, pos + node.nodeSize])
    if (delType && node.marks.some((m) => m.type === delType))
      delRanges.push([pos, pos + node.nodeSize])
  })
  if (mode === 'accept') {
    // insertions become permanent (drop mark); deletions are removed.
    insRanges.forEach(([f, t]) => insType && tr.removeMark(f, t, insType))
    delRanges.sort((a, b) => b[0] - a[0]).forEach(([f, t]) => tr.delete(f, t))
  } else {
    // insertions are removed; deletions revert (drop mark).
    delRanges.forEach(([f, t]) => delType && tr.removeMark(f, t, delType))
    insRanges.sort((a, b) => b[0] - a[0]).forEach(([f, t]) => tr.delete(f, t))
  }
}

function applyResolveAt(
  state: EditorState,
  tr: Transaction,
  pos: number,
  mode: 'accept' | 'reject',
): boolean {
  const runs = collectSuggestionRuns(state)
  const run = runs.find((r) => pos >= r.from && pos <= r.to) ?? runs[0]
  if (!run) return false
  const insType = state.schema.marks.insertion
  const delType = state.schema.marks.deletion
  const accept = mode === 'accept'
  if (run.kind === 'insert') {
    if (accept) insType && tr.removeMark(run.from, run.to, insType)
    else tr.delete(run.from, run.to)
  } else {
    if (accept) tr.delete(run.from, run.to)
    else delType && tr.removeMark(run.from, run.to, delType)
  }
  return true
}

function gotoSuggestion(
  state: EditorState,
  dispatch: ((tr: unknown) => void) | undefined,
  dir: 1 | -1,
): boolean {
  const runs = collectSuggestionRuns(state)
  if (runs.length === 0) return false
  const pos = state.selection.from
  let target: SuggestionRun | undefined
  if (dir === 1) target = runs.find((r) => r.from > pos) ?? runs[0]
  else target = [...runs].reverse().find((r) => r.to < pos) ?? runs[runs.length - 1]
  if (!target) return false
  if (dispatch) {
    const tr = state.tr
      .setSelection(TextSelection.create(state.doc, target.from, target.to))
      .scrollIntoView()
    dispatch(tr)
  }
  return true
}
