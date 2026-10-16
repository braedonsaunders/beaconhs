import type { Editor } from 'grapesjs'

// Recognize values from their actual markup, so sanitized, saved HTML needs no
// editor-only attributes to recover its bindings on the next open.
const VALUE = /^\{\{\{?\s*[@\w./-]+\s*\}?\}\}$/
const VALUES = /\{\{\{?\s*[@\w./-]+\s*\}?\}\}/g
const TABLE_STRUCTURE = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'COLGROUP'])

/** Give bare cell labels and scalar bindings their own editable/movable elements. */
function editableMarkup(input: string): string {
  const root = document.createElement('template')
  root.innerHTML = input
  for (const cell of root.content.querySelectorAll('td,th')) {
    if (cell.childNodes.length) continue
    const span = document.createElement('span')
    span.textContent = '\u00a0'
    cell.append(span)
  }
  const walker = document.createTreeWalker(root.content, 4 /* SHOW_TEXT */)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
  for (const node of nodes) {
    const parent = node.parentElement
    const text = node.data
    if (!parent || parent.closest('style,script,textarea,svg')) continue
    const bareCell = parent.tagName === 'TD' || parent.tagName === 'TH'
    if (!text.trim() && !bareCell) continue
    if (TABLE_STRUCTURE.has(parent.tagName)) continue
    // An existing atomic value is already in the correct shape. Never nest it.
    if (parent.tagName === 'SPAN' && parent.childNodes.length === 1 && VALUE.test(text)) continue
    const matches = [...text.matchAll(VALUES)].filter(
      (match) => !/^\{\{\s*else\s*\}\}$/.test(match[0]),
    )
    if (!matches.length && !bareCell) continue
    const fragment = document.createDocumentFragment()
    const append = (value: string, field = false) => {
      if (!value) return
      // Control blocks must remain raw text in their original scope. Wrapping
      // {{#if}} or {{/each}} separately would create unbalanced rendered spans.
      if (!field && /\{\{[#/]|\{\{else\b/.test(value)) {
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
      '[data-gjs-type="record-value"]{overflow-wrap:anywhere;white-space:normal;outline:1px dotted #94a3b8;cursor:grab;} td,th{min-height:20px;}'
    doc.head.appendChild(style)
  })
  editor.on('parse:html:before', (options: { input: string | HTMLElement }) => {
    if (typeof options.input === 'string') options.input = editableMarkup(options.input)
  })
}
