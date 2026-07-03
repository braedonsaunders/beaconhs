// Find & replace via a ProseMirror decoration plugin. Matches are transient
// view state (decorations), never written into the document. Custom rather than
// a community package so we control behavior and styling.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

export const findReplacePluginKey = new PluginKey('findReplace')

type Match = { from: number; to: number }
type FindState = {
  searchTerm: string
  caseSensitive: boolean
  matches: Match[]
  activeIndex: number
  decorations: DecorationSet
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      setSearchTerm: (term: string) => ReturnType
      setSearchCaseSensitive: (caseSensitive: boolean) => ReturnType
      findNext: () => ReturnType
      findPrev: () => ReturnType
      replaceCurrent: (replaceTerm: string) => ReturnType
      replaceAll: (replaceTerm: string) => ReturnType
      clearSearch: () => ReturnType
    }
  }
}

function computeMatches(doc: PMNode, term: string, caseSensitive: boolean): Match[] {
  const matches: Match[] = []
  if (!term) return matches
  const needle = caseSensitive ? term : term.toLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    // Collect the block's text leaves with their absolute document positions.
    // String offsets can't be mapped straight onto positions: inline non-text
    // nodes (hard breaks, images) occupy positions but contribute nothing to
    // the text, and mark boundaries split text into multiple leaves — so each
    // match endpoint is translated through this segment table instead.
    const segments: { start: number; pos: number; len: number }[] = []
    let text = ''
    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        segments.push({ start: text.length, pos: pos + 1 + offset, len: child.text.length })
        text += child.text
      }
    })
    if (!text) return false
    const toPos = (strOffset: number): number => {
      for (const s of segments) {
        if (strOffset < s.start + s.len) return s.pos + (strOffset - s.start)
      }
      // Offset past the final character — one past the last segment's end.
      const last = segments[segments.length - 1]!
      return last.pos + last.len
    }
    const hay = caseSensitive ? text : text.toLowerCase()
    let idx = 0
    while ((idx = hay.indexOf(needle, idx)) !== -1) {
      matches.push({ from: toPos(idx), to: toPos(idx + term.length - 1) + 1 })
      idx += Math.max(term.length, 1)
    }
    return false
  })
  return matches
}

function buildDecorations(doc: PMNode, matches: Match[], activeIndex: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty
  // Matches are produced in document order, as DecorationSet expects.
  const decos = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === activeIndex ? 'search-match search-match-active' : 'search-match',
    }),
  )
  return DecorationSet.create(doc, decos)
}

export const FindReplace = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findReplacePluginKey,
        state: {
          init() {
            return {
              searchTerm: '',
              caseSensitive: false,
              matches: [],
              activeIndex: 0,
              decorations: DecorationSet.empty,
            }
          },
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(findReplacePluginKey) as Partial<FindState> | undefined
            if (!meta && !tr.docChanged) return value
            const searchTerm = meta && 'searchTerm' in meta ? meta.searchTerm! : value.searchTerm
            const caseSensitive =
              meta && 'caseSensitive' in meta ? meta.caseSensitive! : value.caseSensitive
            let activeIndex = meta && 'activeIndex' in meta ? meta.activeIndex! : value.activeIndex
            const matches = computeMatches(newState.doc, searchTerm, caseSensitive)
            if (activeIndex >= matches.length) activeIndex = 0
            return {
              searchTerm,
              caseSensitive,
              matches,
              activeIndex,
              decorations: buildDecorations(newState.doc, matches, activeIndex),
            }
          },
        },
        props: {
          decorations(state) {
            return findReplacePluginKey.getState(state)?.decorations
          },
        },
      }),
    ]
  },

  addCommands() {
    return {
      setSearchTerm:
        (term) =>
        ({ state, dispatch }) => {
          if (dispatch)
            dispatch(state.tr.setMeta(findReplacePluginKey, { searchTerm: term, activeIndex: 0 }))
          return true
        },
      setSearchCaseSensitive:
        (caseSensitive) =>
        ({ state, dispatch }) => {
          if (dispatch) dispatch(state.tr.setMeta(findReplacePluginKey, { caseSensitive }))
          return true
        },
      findNext:
        () =>
        ({ state, dispatch }) => {
          const fs = findReplacePluginKey.getState(state)
          if (!fs || fs.matches.length === 0) return false
          const next = (fs.activeIndex + 1) % fs.matches.length
          const m = fs.matches[next]!
          if (dispatch) {
            const tr = state.tr.setMeta(findReplacePluginKey, { activeIndex: next })
            tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView()
            dispatch(tr)
          }
          return true
        },
      findPrev:
        () =>
        ({ state, dispatch }) => {
          const fs = findReplacePluginKey.getState(state)
          if (!fs || fs.matches.length === 0) return false
          const prev = (fs.activeIndex - 1 + fs.matches.length) % fs.matches.length
          const m = fs.matches[prev]!
          if (dispatch) {
            const tr = state.tr.setMeta(findReplacePluginKey, { activeIndex: prev })
            tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView()
            dispatch(tr)
          }
          return true
        },
      replaceCurrent:
        (replaceTerm) =>
        ({ state, dispatch }) => {
          const fs = findReplacePluginKey.getState(state)
          if (!fs || fs.matches.length === 0) return false
          const m = fs.matches[fs.activeIndex] ?? fs.matches[0]!
          if (dispatch) dispatch(state.tr.insertText(replaceTerm, m.from, m.to))
          return true
        },
      replaceAll:
        (replaceTerm) =>
        ({ state, dispatch }) => {
          const fs = findReplacePluginKey.getState(state)
          if (!fs || fs.matches.length === 0) return false
          if (dispatch) {
            const tr = state.tr
            for (let i = fs.matches.length - 1; i >= 0; i--) {
              const m = fs.matches[i]!
              tr.insertText(replaceTerm, m.from, m.to)
            }
            dispatch(tr)
          }
          return true
        },
      clearSearch:
        () =>
        ({ state, dispatch }) => {
          if (dispatch)
            dispatch(state.tr.setMeta(findReplacePluginKey, { searchTerm: '', activeIndex: 0 }))
          return true
        },
    }
  },
})
