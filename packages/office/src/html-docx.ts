import JSZip from 'jszip'
import { parse, type DefaultTreeAdapterMap } from 'parse5'

type ChildNode = DefaultTreeAdapterMap['childNode']
type Element = DefaultTreeAdapterMap['element']
type ParentNode = DefaultTreeAdapterMap['parentNode']

type RunFormat = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
  superscript?: boolean
  subscript?: boolean
  hyperlink?: boolean
}

type ParagraphOptions = {
  style?: string
  numId?: number
  level?: number
  indent?: number
  format?: RunFormat
}

const FIXED_ZIP_DATE = new Date('2000-01-01T00:00:00.000Z')
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'div',
  'dl',
  'fieldset',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
])

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node
}

function isText(node: ChildNode): node is DefaultTreeAdapterMap['textNode'] {
  return node.nodeName === '#text'
}

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function attr(element: Element, name: string): string | null {
  return element.attrs.find((candidate) => candidate.name === name)?.value ?? null
}

function childNodes(node: ParentNode): ChildNode[] {
  return node.childNodes
}

function findElement(node: ParentNode, tagName: string): Element | null {
  for (const child of childNodes(node)) {
    if (!isElement(child)) continue
    if (child.tagName === tagName) return child
    const nested = findElement(child, tagName)
    if (nested) return nested
  }
  return null
}

function plainText(nodes: readonly ChildNode[]): string {
  let result = ''
  for (const node of nodes) {
    if (isText(node)) result += node.value
    else if (isElement(node)) {
      if (node.tagName === 'br') result += '\n'
      else result += plainText(node.childNodes)
    }
  }
  return result
}

class WordRenderer {
  private readonly hyperlinks: { id: string; target: string }[] = []

  private addHyperlink(target: string): string {
    const id = `rId${this.hyperlinks.length + 3}`
    this.hyperlinks.push({ id, target })
    return id
  }

  private run(text: string, format: RunFormat = {}): string {
    if (!text) return ''
    const properties = [
      format.bold ? '<w:b/>' : '',
      format.italic ? '<w:i/>' : '',
      format.underline || format.hyperlink ? '<w:u w:val="single"/>' : '',
      format.strike ? '<w:strike/>' : '',
      format.code
        ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>'
        : '',
      format.superscript ? '<w:vertAlign w:val="superscript"/>' : '',
      format.subscript ? '<w:vertAlign w:val="subscript"/>' : '',
      format.hyperlink ? '<w:color w:val="0563C1"/>' : '',
    ].join('')
    const parts = text.split('\n')
    const body = parts
      .map((part, index) => `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${xml(part)}</w:t>`)
      .join('')
    return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}${body}</w:r>`
  }

  private inline(nodes: readonly ChildNode[], inherited: RunFormat = {}): string {
    let output = ''
    for (const node of nodes) {
      if (isText(node)) {
        output += this.run(node.value.replace(/\s+/g, ' '), inherited)
        continue
      }
      if (!isElement(node)) continue
      const tag = node.tagName
      if (tag === 'br') {
        output += '<w:r><w:br/></w:r>'
        continue
      }
      const format: RunFormat = {
        ...inherited,
        bold: inherited.bold || tag === 'b' || tag === 'strong',
        italic: inherited.italic || tag === 'i' || tag === 'em',
        underline: inherited.underline || tag === 'u',
        strike: inherited.strike || tag === 's' || tag === 'del',
        code: inherited.code || tag === 'code' || tag === 'kbd',
        superscript: inherited.superscript || tag === 'sup',
        subscript: inherited.subscript || tag === 'sub',
      }
      if (tag === 'a') {
        const href = attr(node, 'href')
        if (href && /^(?:https?:|mailto:)/i.test(href)) {
          const id = this.addHyperlink(href)
          output += `<w:hyperlink r:id="${id}" w:history="1">${this.inline(node.childNodes, { ...format, hyperlink: true })}</w:hyperlink>`
          continue
        }
      }
      output += this.inline(node.childNodes, format)
    }
    return output
  }

  private paragraph(nodes: readonly ChildNode[], options: ParagraphOptions = {}): string {
    const properties = [
      options.style ? `<w:pStyle w:val="${xml(options.style)}"/>` : '',
      options.numId
        ? `<w:numPr><w:ilvl w:val="${Math.max(0, Math.min(8, options.level ?? 0))}"/><w:numId w:val="${options.numId}"/></w:numPr>`
        : '',
      options.indent ? `<w:ind w:left="${options.indent}"/>` : '',
    ].join('')
    const runs = this.inline(nodes, options.format)
    return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${runs || '<w:r><w:t/></w:r>'}</w:p>`
  }

  private renderList(list: Element, level: number): string[] {
    const output: string[] = []
    const numId = list.tagName === 'ol' ? 2 : 1
    for (const child of list.childNodes) {
      if (!isElement(child) || child.tagName !== 'li') continue
      const nestedLists: Element[] = []
      const inlineChildren = child.childNodes.filter((node) => {
        if (isElement(node) && (node.tagName === 'ul' || node.tagName === 'ol')) {
          nestedLists.push(node)
          return false
        }
        return true
      })
      output.push(this.paragraph(inlineChildren, { numId, level }))
      for (const nested of nestedLists) output.push(...this.renderList(nested, level + 1))
    }
    return output
  }

  private tableRows(table: Element): Element[] {
    const rows: Element[] = []
    const visit = (element: Element): void => {
      for (const child of element.childNodes) {
        if (!isElement(child)) continue
        if (child.tagName === 'tr') rows.push(child)
        else if (['thead', 'tbody', 'tfoot'].includes(child.tagName)) visit(child)
      }
    }
    visit(table)
    return rows
  }

  private renderTable(table: Element): string {
    const rows = this.tableRows(table)
      .map((row) => {
        const cells = row.childNodes
          .filter(
            (node): node is Element =>
              isElement(node) && (node.tagName === 'td' || node.tagName === 'th'),
          )
          .map((cell) => {
            const blocks = this.blocks(cell.childNodes, cell.tagName === 'th' ? { bold: true } : {})
            return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${blocks.join('') || '<w:p/>'}</w:tc>`
          })
          .join('')
        return cells ? `<w:tr>${cells}</w:tr>` : ''
      })
      .join('')
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="777777"/><w:left w:val="single" w:sz="4" w:color="777777"/><w:bottom w:val="single" w:sz="4" w:color="777777"/><w:right w:val="single" w:sz="4" w:color="777777"/><w:insideH w:val="single" w:sz="4" w:color="777777"/><w:insideV w:val="single" w:sz="4" w:color="777777"/></w:tblBorders></w:tblPr>${rows}</w:tbl>`
  }

  private renderBlock(element: Element, inheritedFormat: RunFormat): string[] {
    const tag = element.tagName
    if (/^h[1-6]$/.test(tag)) {
      return [this.paragraph(element.childNodes, { style: `Heading${tag.slice(1)}` })]
    }
    if (tag === 'ul' || tag === 'ol') return this.renderList(element, 0)
    if (tag === 'table') return [this.renderTable(element)]
    if (tag === 'pre') {
      const value = plainText(element.childNodes).replace(/\r\n?/g, '\n')
      const textNode: DefaultTreeAdapterMap['textNode'] = {
        nodeName: '#text',
        parentNode: null,
        value,
      }
      return [this.paragraph([textNode], { format: { code: true } })]
    }
    if (tag === 'blockquote') {
      const nested = this.blocks(element.childNodes, inheritedFormat)
      return nested.map((paragraph) =>
        paragraph.startsWith('<w:p>')
          ? paragraph.replace('<w:p>', '<w:p><w:pPr><w:ind w:left="720"/></w:pPr>')
          : paragraph,
      )
    }
    if (tag === 'hr') {
      return [
        '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>',
      ]
    }
    if (tag === 'div' || tag === 'section' || tag === 'article') {
      const containsBlock = element.childNodes.some(
        (child) => isElement(child) && BLOCK_TAGS.has(child.tagName),
      )
      if (containsBlock) return this.blocks(element.childNodes, inheritedFormat)
    }
    return [this.paragraph(element.childNodes, { format: inheritedFormat })]
  }

  blocks(nodes: readonly ChildNode[], inheritedFormat: RunFormat = {}): string[] {
    const output: string[] = []
    let inline: ChildNode[] = []
    const flush = (): void => {
      if (!inline.length) return
      if (inline.some((node) => !isText(node) || node.value.trim())) {
        output.push(this.paragraph(inline, { format: inheritedFormat }))
      }
      inline = []
    }
    for (const node of nodes) {
      if (isElement(node) && BLOCK_TAGS.has(node.tagName)) {
        flush()
        output.push(...this.renderBlock(node, inheritedFormat))
      } else if (isText(node) || isElement(node)) {
        inline.push(node)
      }
    }
    flush()
    return output
  }

  relationshipsXml(): string {
    const hyperlinks = this.hyperlinks
      .map(
        ({ id, target }) =>
          `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(target)}" TargetMode="External"/>`,
      )
      .join('')
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${hyperlinks}</Relationships>`
  }
}

function numberingLevel(level: number, format: 'bullet' | 'decimal'): string {
  const left = 720 * (level + 1)
  const text = format === 'bullet' ? '•' : `%${level + 1}.`
  return `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="${left}"/></w:tabs><w:ind w:left="${left}" w:hanging="360"/></w:pPr>${format === 'bullet' ? '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr>' : ''}</w:lvl>`
}

function numberingXml(): string {
  const levels = (format: 'bullet' | 'decimal') =>
    Array.from({ length: 9 }, (_, level) => numberingLevel(level, format)).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels('bullet')}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="multilevel"/>${levels('decimal')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
}

function stylesXml(): string {
  const headings = Array.from({ length: 6 }, (_, index) => {
    const level = index + 1
    const size = [32, 28, 26, 24, 22, 20][index]!
    return `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="${9 + level}"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${index}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${headings}</w:styles>`
}

function addXml(zip: JSZip, path: string, value: string): void {
  // DOCX readers resolve parts by path and do not require ZIP directory
  // entries. Avoid JSZip's auto-created directories because their implicit
  // current timestamps make otherwise identical documents nondeterministic.
  zip.file(path, value, { date: FIXED_ZIP_DATE, createFolders: false })
}

/** Build a deterministic, editable DOCX from already-sanitized HTML. */
export async function buildDocxFromHtml(html: Buffer): Promise<Buffer> {
  const document = parse(html.toString('utf8'))
  const body = findElement(document, 'body')
  if (!body) throw new Error('HTML input does not contain a body element')
  const renderer = new WordRenderer()
  const content = renderer.blocks(body.childNodes).join('') || '<w:p/>'
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${content}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`

  const zip = new JSZip()
  addXml(
    zip,
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
  )
  addXml(
    zip,
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>',
  )
  addXml(zip, 'word/document.xml', documentXml)
  addXml(zip, 'word/styles.xml', stylesXml())
  addXml(zip, 'word/numbering.xml', numberingXml())
  addXml(zip, 'word/_rels/document.xml.rels', renderer.relationshipsXml())
  addXml(
    zip,
    'docProps/core.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>BeaconHS migration</dc:creator><cp:lastModifiedBy>BeaconHS migration</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>',
  )
  addXml(
    zip,
    'docProps/app.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>BeaconHS</Application><AppVersion>1.0</AppVersion></Properties>',
  )
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'UNIX',
  })
}
