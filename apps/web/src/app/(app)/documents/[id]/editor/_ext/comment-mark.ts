// Comment mark: highlights a range and carries the stable `commentId` that ties
// it to a document_comments thread. A mark (not a decoration) so it remaps
// through edits and persists in the saved ProseMirror JSON.
import { Mark, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      setComment: (commentId: string) => ReturnType
      unsetComment: (commentId: string) => ReturnType
      resolveCommentMark: (commentId: string, resolved: boolean) => ReturnType
    }
  }
}

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,

  addOptions() {
    return { HTMLAttributes: { class: 'comment-mark' } }
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-comment-id'),
        renderHTML: (attrs) => (attrs.commentId ? { 'data-comment-id': attrs.commentId } : {}),
      },
      resolved: {
        default: false,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-resolved') === 'true',
        renderHTML: (attrs) =>
          attrs.resolved ? { 'data-resolved': 'true', class: 'comment-resolved' } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },

  addCommands() {
    return {
      setComment:
        (commentId) =>
        ({ commands }) =>
          commands.setMark('comment', { commentId, resolved: false }),

      unsetComment:
        (commentId) =>
        ({ state, dispatch, tr }) => {
          const markType = state.schema.marks.comment
          let changed = false
          state.doc.descendants((node, pos) => {
            if (!node.isText) return
            node.marks.forEach((m) => {
              if (m.type === markType && m.attrs.commentId === commentId) {
                tr.removeMark(pos, pos + node.nodeSize, m)
                changed = true
              }
            })
          })
          if (changed && dispatch) dispatch(tr)
          return changed
        },

      resolveCommentMark:
        (commentId, resolved) =>
        ({ state, dispatch, tr }) => {
          const markType = state.schema.marks.comment
          let changed = false
          state.doc.descendants((node, pos) => {
            if (!node.isText) return
            node.marks.forEach((m) => {
              if (m.type === markType && m.attrs.commentId === commentId) {
                const from = pos
                const to = pos + node.nodeSize
                tr.removeMark(from, to, markType)
                tr.addMark(from, to, markType.create({ commentId, resolved }))
                changed = true
              }
            })
          })
          if (changed && dispatch) dispatch(tr)
          return changed
        },
    }
  },
})
