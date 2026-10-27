import JSZip from 'jszip'

// The visible wording of a DOCX: every text run in the body, headers,
// footers, footnotes and endnotes, in package order, with whitespace
// collapsed. Formatting, images and relationship ids are ignored, so two
// files compare equal when a reader would see the same words.

const WORDING_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/
const TEXT_RUN = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>|<\/w:p>/g

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

function partWording(xml: string): string {
  let out = ''
  for (const match of xml.matchAll(TEXT_RUN)) {
    if (match[1] !== undefined) out += decodeXmlEntities(match[1])
    else out += ' '
  }
  return out
}

/** Normalized reader-visible wording of a DOCX package. */
export async function docxWording(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)
  const parts = Object.keys(zip.files)
    .filter((path) => WORDING_PARTS.test(path))
    .sort()
  let text = ''
  for (const path of parts) {
    const xml = await zip.file(path)?.async('string')
    if (xml) text += ` ${partWording(xml)}`
  }
  return text.replace(/\s+/g, ' ').trim()
}
