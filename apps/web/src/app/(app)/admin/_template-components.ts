import type { Editor } from 'grapesjs'

// Recognize values from their actual markup, so sanitized, saved HTML needs no
// editor-only attributes to recover its bindings on the next open.
const VALUE = /^\{\{\{?\s*[@\w./-]+\s*\}?\}\}$/
const VALUES = /\{\{\{?\s*[@\w./-]+\s*\}?\}\}/g
const TABLE_STRUCTURE = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'COLGROUP'])

/** Keep scalar bindings atomic inside a continuous rich-text editing surface. */
function editableMarkup(input: string): string {
  const root = document.createElement('template')
  root.innerHTML = input
  for (const anchor of root.content.querySelectorAll('[data-bhs-caret]')) {
    const text = document.createTreeWalker(anchor, 4 /* SHOW_TEXT */)
    for (let node = text.nextNode(); node; node = text.nextNode()) {
      ;(node as Text).data = (node as Text).data.replace(/\u200b/g, '')
    }
    anchor.replaceWith(...anchor.childNodes)
  }
  for (const cell of root.content.querySelectorAll('td,th')) {
    if (cell.childNodes.length) continue
    cell.append(document.createTextNode('\u00a0'))
  }
  const walker = document.createTreeWalker(root.content, 4 /* SHOW_TEXT */)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
  for (const node of nodes) {
    const parent = node.parentElement
    const text = node.data
    if (parent?.closest('style,script,textarea,svg')) continue
    if (!text.trim()) continue
    if (parent && TABLE_STRUCTURE.has(parent.tagName)) continue
    // An existing atomic value is already in the correct shape. Never nest it.
    if (parent?.tagName === 'SPAN' && parent.childNodes.length === 1 && VALUE.test(text)) continue
    const matches = [...text.matchAll(VALUES)].filter(
      (match) => !/^\{\{\s*else\s*\}\}$/.test(match[0]),
    )
    if (!matches.length) continue
    const fragment = document.createDocumentFragment()
    const append = (value: string, field = false) => {
      if (!value) return
      // Labels, separators and Handlebars control blocks remain ordinary text.
      // Making each separator another text component prevents natural typing.
      if (!field) {
        fragment.append(document.createTextNode(value))
      } else {
        const span = document.createElement('span')
        span.textContent = value
        fragment.append(span)
      }
    }
    let offset = 0
    for (const match of matches) {
      append(text.slice(offset, match.index))
      append(match[0], true)
      offset = match.index + match[0].length
    }
    append(text.slice(offset))
    node.replaceWith(fragment)
  }
  return root.innerHTML
}

export function installTemplateComponents(editor: Editor): void {
  editor.DomComponents.addType('record-value', {
    isComponent: (el) =>
      el.nodeType === 1 &&
      el.tagName === 'SPAN' &&
      el.childNodes.length === 1 &&
      VALUE.test(el.textContent ?? '')
        ? { type: 'record-value', name: el.textContent ?? 'Record value' }
        : false,
    model: {
      defaults: {
        tagName: 'span',
        name: 'Record value',
        editable: false,
        textable: true,
        droppable: false,
        draggable: true,
        stylable: true,
        traits: [],
      },
    },
    view: {
      onRender() {
        // A parent text block may be in rich-text mode; keep the value atomic.
        // This is view-only and is never written into the printed document.
        this.el.contentEditable = 'false'
      },
    },
  })
  editor.on('load', () => {
    const doc = editor.Canvas.getBody()?.ownerDocument
    if (!doc) return
    const style = doc.createElement('style')
    style.textContent =
      '[data-gjs-type="record-value"]{overflow-wrap:anywhere;white-space:normal;outline:1px dotted #94a3b8;cursor:grab;} td,th{min-height:20px;} td[contenteditable="true"],th[contenteditable="true"]{cursor:text;}'
    doc.head.appendChild(style)
  })
  editor.on('parse:html:before', (options: { input: string | HTMLElement }) => {
    if (typeof options.input === 'string') options.input = editableMarkup(options.input)
  })
}
