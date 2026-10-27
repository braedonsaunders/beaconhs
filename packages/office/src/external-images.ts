import JSZip from 'jszip'

// Legacy-imported masters LINK their images instead of embedding them: the
// relationship points at an https URL on the old Beacon's Azure Blob store.
// LibreOffice renders no image for those (and the link dies with the old
// account), so published PDFs silently lost every picture. This module finds
// those external image relationships in any OOXML package (DOCX and PPTX use
// the same relationship machinery) and rewrites them as embedded media parts.

export type ExternalImageRef = {
  /** Zip path of the .rels part, e.g. word/_rels/document.xml.rels */
  relsPath: string
  /** Relationship Id, e.g. rId7 */
  id: string
  url: string
}

export type FetchedImage = { bytes: Buffer; contentType?: string | null }

const RELATIONSHIP = /<Relationship\b[^>]*\/>/g
const IMAGE_TYPE = /\/image$/
const CONTENT_TYPES_PATH = '[Content_Types].xml'

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/x-emf': 'emf',
  'image/x-wmf': 'wmf',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
}
const CONTENT_TYPE_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_CONTENT_TYPE).map(([type, ext]) => [ext, type]),
)

function attr(tag: string, name: string): string | null {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null
}

function isExternalImageRelationship(tag: string): { id: string; url: string } | null {
  const type = attr(tag, 'Type') ?? ''
  if (!IMAGE_TYPE.test(type)) return null
  const target = attr(tag, 'Target') ?? ''
  if (!/^https?:\/\//i.test(target)) return null
  const id = attr(tag, 'Id')
  if (!id) return null
  return { id, url: target }
}

/** Every external (linked, not embedded) image relationship in the package. */
export async function findExternalImages(bytes: Buffer): Promise<ExternalImageRef[]> {
  const zip = await JSZip.loadAsync(bytes)
  const refs: ExternalImageRef[] = []
  for (const path of Object.keys(zip.files)) {
    if (!path.endsWith('.rels')) continue
    const entry = zip.file(path)
    if (!entry) continue
    const xml = await entry.async('string')
    for (const tag of xml.match(RELATIONSHIP) ?? []) {
      const found = isExternalImageRelationship(tag)
      if (found) refs.push({ relsPath: path, ...found })
    }
  }
  return refs
}

/** Directory of the part a .rels file belongs to (word, word/charts, ppt/slides…). */
function sourcePartDir(relsPath: string): string {
  // word/_rels/document.xml.rels → word/document.xml → dir "word"
  const part = relsPath.replace(/\/_rels\//, '/').replace(/\.rels$/, '')
  const slash = part.lastIndexOf('/')
  return slash === -1 ? '' : part.slice(0, slash)
}

/** Zip path where media for this package root lives (word/media, ppt/media). */
function mediaDir(relsPath: string): string {
  const root = relsPath.split('/')[0] ?? ''
  return root ? `${root}/media` : 'media'
}

/** Relationship Target for a media part, relative to the source part's folder. */
function relativeTarget(relsPath: string, mediaPath: string): string {
  const from = sourcePartDir(relsPath).split('/').filter(Boolean)
  const to = mediaPath.split('/').filter(Boolean)
  let common = 0
  while (common < from.length && common < to.length && from[common] === to[common]) common++
  const ups = from.length - common
  return [...Array<string>(ups).fill('..'), ...to.slice(common)].join('/')
}

function extensionFor(url: string, contentType?: string | null): string {
  const fromType = contentType?.split(';')[0]?.trim().toLowerCase()
  if (fromType && EXT_BY_CONTENT_TYPE[fromType]) return EXT_BY_CONTENT_TYPE[fromType]!
  const clean = url.split(/[?#]/)[0] ?? ''
  const ext = clean.split('.').pop()?.toLowerCase() ?? ''
  if (CONTENT_TYPE_BY_EXT[ext] || ext === 'jpeg') return ext === 'jpeg' ? 'jpg' : ext
  return 'png'
}

function ensureContentType(contentTypesXml: string, ext: string): string {
  if (new RegExp(`<Default\\b[^>]*\\bExtension="${ext}"`, 'i').test(contentTypesXml)) {
    return contentTypesXml
  }
  const type = CONTENT_TYPE_BY_EXT[ext] ?? 'image/png'
  return contentTypesXml.replace(
    '</Types>',
    `<Default Extension="${ext}" ContentType="${type}"/></Types>`,
  )
}

function rewriteRelationship(tag: string, target: string): string {
  return tag.replace(/\sTargetMode="[^"]*"/, '').replace(/Target="[^"]*"/, `Target="${target}"`)
}

export type EmbedResult = {
  bytes: Buffer
  embedded: { url: string; mediaPath: string }[]
  failed: { url: string; error: string }[]
}

/**
 * Download every externally linked image and embed it as a media part,
 * rewriting its relationship to point inside the package. Idempotent: a
 * package with no external image relationships comes back byte-identical,
 * and a failed download leaves that relationship untouched (reported in
 * `failed`) so a later run can retry it.
 */
export async function embedExternalImages(
  bytes: Buffer,
  fetchImage: (url: string) => Promise<FetchedImage | null>,
): Promise<EmbedResult> {
  const refs = await findExternalImages(bytes)
  if (refs.length === 0) return { bytes, embedded: [], failed: [] }

  const zip = await JSZip.loadAsync(bytes)
  const usedNames = new Set(Object.keys(zip.files))
  // One download per URL even when several slides/pages link the same image,
  // and one media part per URL (relationships in different parts can share it).
  const mediaByUrl = new Map<string, string>()
  const embedded: EmbedResult['embedded'] = []
  const failed: EmbedResult['failed'] = []
  const failedUrls = new Set<string>()
  const extensions = new Set<string>()
  let counter = 0

  const relsChanges = new Map<string, Map<string, string>>() // relsPath → relId → new target
  for (const ref of refs) {
    let mediaPath = mediaByUrl.get(ref.url)
    if (!mediaPath) {
      if (failedUrls.has(ref.url)) continue
      let fetched: FetchedImage | null
      try {
        fetched = await fetchImage(ref.url)
      } catch (error) {
        fetched = null
        failed.push({
          url: ref.url,
          error: error instanceof Error ? error.message : String(error),
        })
        failedUrls.add(ref.url)
        continue
      }
      if (!fetched || fetched.bytes.length === 0) {
        failed.push({ url: ref.url, error: 'Download returned no bytes' })
        failedUrls.add(ref.url)
        continue
      }
      const ext = extensionFor(ref.url, fetched.contentType)
      extensions.add(ext)
      const dir = mediaDir(ref.relsPath)
      do {
        counter++
        mediaPath = `${dir}/embedded-image-${counter}.${ext}`
      } while (usedNames.has(mediaPath))
      usedNames.add(mediaPath)
      zip.file(mediaPath, fetched.bytes)
      mediaByUrl.set(ref.url, mediaPath)
      embedded.push({ url: ref.url, mediaPath })
    }
    const perRels = relsChanges.get(ref.relsPath) ?? new Map<string, string>()
    perRels.set(ref.id, relativeTarget(ref.relsPath, mediaPath))
    relsChanges.set(ref.relsPath, perRels)
  }

  if (embedded.length === 0) return { bytes, embedded, failed }

  for (const [relsPath, changes] of relsChanges) {
    const entry = zip.file(relsPath)
    if (!entry) continue
    const xml = await entry.async('string')
    const next = xml.replace(RELATIONSHIP, (tag) => {
      const found = isExternalImageRelationship(tag)
      if (!found) return tag
      const target = changes.get(found.id)
      return target ? rewriteRelationship(tag, target) : tag
    })
    if (next !== xml) zip.file(relsPath, next)
  }

  const contentTypes = zip.file(CONTENT_TYPES_PATH)
  if (contentTypes) {
    let xml = await contentTypes.async('string')
    for (const ext of extensions) xml = ensureContentType(xml, ext)
    zip.file(CONTENT_TYPES_PATH, xml)
  }

  return {
    bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    embedded,
    failed,
  }
}
