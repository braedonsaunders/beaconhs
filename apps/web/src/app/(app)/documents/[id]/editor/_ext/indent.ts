// Word-style block indentation (margin-left steps) on paragraphs + headings.
// Tab / Shift-Tab indent/outdent, but yield to lists and tables so their own
// Tab behavior (sink list item / move cell) still works.
import { Extension } from '@tiptap/core'

const MAX_INDENT = 8
const STEP_EM = 2.5

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType
      outdent: () => ReturnType
    }
  }
}

export const Indent = Extension.create({
  name: 'indent',

  addOptions() {
    return { types: ['paragraph', 'heading'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => {
              const ml = parseFloat((el as HTMLElement).style.marginLeft || '0')
              return ml ? Math.min(MAX_INDENT, Math.round(ml / STEP_EM)) : 0
            },
            renderHTML: (attrs) =>
              attrs.indent ? { style: `margin-left: ${attrs.indent * STEP_EM}em` } : {},
          },
        },
      },
    ]
  },

  addCommands() {
    const types = this.options.types
    const shift =
      (delta: number) =>
      ({ editor, commands }: { editor: any; commands: any }) =>
        types.every((type) => {
          if (!editor.isActive(type)) return true
          const cur = (editor.getAttributes(type).indent as number) || 0
          const next = Math.max(0, Math.min(MAX_INDENT, cur + delta))
          return commands.updateAttributes(type, { indent: next })
        })
    return {
      indent: () => shift(1),
      outdent: () => shift(-1),
    }
  },

  addKeyboardShortcuts() {
    const yields = () =>
      this.editor.isActive('listItem') ||
      this.editor.isActive('taskItem') ||
      this.editor.isActive('tableCell') ||
      this.editor.isActive('tableHeader')
    return {
      Tab: () => (yields() ? false : this.editor.commands.indent()),
      'Shift-Tab': () => (yields() ? false : this.editor.commands.outdent()),
    }
  },
})
