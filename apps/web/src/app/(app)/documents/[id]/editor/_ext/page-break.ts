// Manual page break. In the editor it renders as a labelled dashed divider
// (via a node view); serialized HTML is a minimal <div data-page-break> that
// the PDF template maps to `break-before: page`.
import { Node, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      setPageBreak: () => ReturnType
    }
  }
}

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }]
  },

  // Clean serialization for export / PDF — no editor chrome.
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': 'true' })]
  },

  // In-editor visual.
  addNodeView() {
    return () => {
      const dom = document.createElement('div')
      dom.className = 'pm-page-break'
      dom.setAttribute('contenteditable', 'false')
      const label = document.createElement('span')
      label.textContent = 'Page break'
      dom.appendChild(label)
      return { dom }
    }
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name })
            .run(),
    }
  },
})
