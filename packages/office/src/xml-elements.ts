import { SaxesParser } from 'saxes'

type ElementRange = { start: number; end: number }

/** Find balanced outer elements in one parser pass; retain the original XML bytes. */
function elementRanges(xml: string, name: string): ElementRange[] {
  const ranges: ElementRange[] = []
  const parser = new SaxesParser({
    fragment: !xml.startsWith('<?xml') && !xml.startsWith('\ufeff<?xml'),
    xmlns: false,
  })
  let depth = 0,
    start = 0
  parser.on('opentagstart', (tag) => {
    if (tag.name !== name) return
    if (depth++ === 0) start = xml.lastIndexOf('<', parser.position - 1)
  })
  parser.on('closetag', (tag) => {
    if (tag.name === name && --depth === 0) ranges.push({ start, end: parser.position })
  })
  parser.write(xml).close()
  return ranges
}

export function xmlElements(xml: string, name: string): string[] {
  return elementRanges(xml, name).map(({ start, end }) => xml.slice(start, end))
}

export function rewriteXmlElements(
  xml: string,
  name: string,
  transform: (element: string) => string,
): string {
  const parts: string[] = []
  let offset = 0
  for (const { start, end } of elementRanges(xml, name)) {
    parts.push(xml.slice(offset, start), transform(xml.slice(start, end)))
    offset = end
  }
  parts.push(xml.slice(offset))
  return parts.join('')
}
