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

/** The part a .rels file describes (word/_rels/document.xml.rels → word/document.xml). */
function sourcePartPath(relsPath: string): string {
  return relsPath.replace(/\/_rels\//, '/').replace(/\.rels$/, '')
}

const BLIP = /<(?:[A-Za-z0-9]+:)?blip\b[^>]*>/g

/**
 * A DrawingML picture LINKS its image with `r:link` and EMBEDS it with
 * `r:embed`. Once a relationship points inside the package, its pictures must
 * use `r:embed` — renderers ignore a `r:link` to a package part, so the
 * picture silently disappears even though the media is in the file.
 */
function linksToEmbeds(xml: string, ids: ReadonlySet<string>): { xml: string; changed: number } {
  let changed = 0
  const next = xml.replace(BLIP, (tag) => {
    const link = /\s([A-Za-z0-9]+):link="([^"]*)"/.exec(tag)
    if (!link || !ids.has(link[2]!)) return tag
    changed++
    const prefix = link[1]!
    const withoutLink = tag.replace(link[0], '')
    const embedAttr = new RegExp(`\\s${prefix}:embed="[^"]*"`)
    return embedAttr.test(withoutLink)
      ? withoutLink.replace(embedAttr, ` ${prefix}:embed="${link[2]}"`)
      : withoutLink.replace(/^(<(?:[A-Za-z0-9]+:)?blip)\b/, `$1 ${prefix}:embed="${link[2]}"`)
  })
  return { xml: next, changed }
}

/** Package-internal image relationships of one part: id → zip path of the media. */
function internalImageTargets(relsPath: string, relsXml: string): Map<string, string> {
  const targets = new Map<string, string>()
  const dir = sourcePartDir(relsPath).split('/').filter(Boolean)
  for (const tag of relsXml.match(RELATIONSHIP) ?? []) {
    if (!IMAGE_TYPE.test(attr(tag, 'Type') ?? '')) continue
    if ((attr(tag, 'TargetMode') ?? '').toLowerCase() === 'external') continue
    const id = attr(tag, 'Id')
    const target = attr(tag, 'Target')
    if (!id || !target) continue
    const segments = target.startsWith('/') ? [] : [...dir]
    for (const segment of target.replace(/^\//, '').split('/')) {
      if (segment === '..') segments.pop()
      else if (segment && segment !== '.') segments.push(segment)
    }
    targets.set(id, segments.join('/'))
  }
  return targets
}

/** Pixel size of a PNG, JPEG, GIF or BMP image; null for anything else. */
function imagePixelSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (bytes.length >= 10 && bytes.toString('latin1', 0, 3) === 'GIF') {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  }
  if (bytes.length >= 26 && bytes.toString('latin1', 0, 2) === 'BM') {
    return { width: Math.abs(bytes.readInt32LE(18)), height: Math.abs(bytes.readInt32LE(22)) }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1]!
      const length = bytes.readUInt16BE(offset + 2)
      const isFrame =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrame) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) }
      }
      offset += 2 + length
    }
  }
  return null
}

const DRAWING = /<w:drawing>[\s\S]*?<\/w:drawing>/g
// Letter page inside default margins; pictures larger than this are scaled down.
const MAX_CX = 5_943_600
const MAX_CY = 8_229_600

/**
 * The legacy export gave every linked picture a placeholder height, so once
 * the picture renders it is squashed. Restore each embedded picture's aspect
 * ratio from its image: keep the authored width (within the page), derive
 * the height. Pictures already within 2% of their image's shape are untouched.
 */
async function fitPictureExtents(
  zip: JSZip,
  xml: string,
  targets: ReadonlyMap<string, string>,
): Promise<{ xml: string; changed: number }> {
  const sizes = new Map<string, { width: number; height: number } | null>()
  let changed = 0
  let next = xml
  for (const drawing of xml.match(DRAWING) ?? []) {
    const embed = /<(?:[A-Za-z0-9]+:)?blip\b[^>]*\s[A-Za-z0-9]+:embed="([^"]*)"/.exec(drawing)?.[1]
    const mediaPath = embed ? targets.get(embed) : undefined
    if (!mediaPath) continue
    if (!sizes.has(mediaPath)) {
      const media = zip.file(mediaPath)
      sizes.set(mediaPath, media ? imagePixelSize(await media.async('nodebuffer')) : null)
    }
    const size = sizes.get(mediaPath)
    const extent = /<wp:extent\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(drawing)
    if (!size || !extent || size.width <= 0 || size.height <= 0) continue
    let cx = Number(extent[1])
    let cy = Number(extent[2])
    const ratio = size.height / size.width
    if (cx <= 0 || Math.abs(cy / cx - ratio) / ratio <= 0.02) continue
    cx = Math.min(cx, MAX_CX)
    cy = Math.round(cx * ratio)
    if (cy > MAX_CY) {
      cx = Math.round((cx * MAX_CY) / cy)
      cy = MAX_CY
    }
    const fitted = drawing
      .replace(/(<wp:extent\b[^>]*\bcx=")\d+("[^>]*\bcy=")\d+"/, `$1${cx}$2${cy}"`)
      .replace(/(<a:ext\b[^>]*\bcx=")\d+("[^>]*\bcy=")\d+"/, `$1${cx}$2${cy}"`)
    if (fitted !== drawing) {
      next = next.replace(drawing, fitted)
      changed++
    }
  }
  return { xml: next, changed }
}

/**
 * Repair pictures an earlier embed pass left broken: those still `r:link`ing
 * an image that is now inside the package, and those still carrying the
 * legacy placeholder size. Returns the input unchanged when nothing needs it.
 */
export async function repairLinkedEmbeddedImages(
  bytes: Buffer,
): Promise<{ bytes: Buffer; repaired: number }> {
  const zip = await JSZip.loadAsync(bytes)
  let repaired = 0
  for (const relsPath of Object.keys(zip.files)) {
    if (!relsPath.endsWith('.rels')) continue
    const relsXml = await zip.file(relsPath)?.async('string')
    if (!relsXml) continue
    const targets = internalImageTargets(relsPath, relsXml)
    if (targets.size === 0) continue
    const partPath = sourcePartPath(relsPath)
    const part = zip.file(partPath)
    if (!part) continue
    const original = await part.async('string')
    const relinked = linksToEmbeds(original, new Set(targets.keys()))
    const fitted = await fitPictureExtents(zip, relinked.xml, targets)
    if (fitted.xml === original) continue
    repaired += Math.max(relinked.changed, fitted.changed)
    zip.file(partPath, fitted.xml)
  }
  if (repaired === 0) return { bytes, repaired }
  return {
    bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    repaired,
  }
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
    const partPath = sourcePartPath(relsPath)
    const part = zip.file(partPath)
    if (part) {
      const original = await part.async('string')
      const relinked = linksToEmbeds(original, new Set(changes.keys()))
      const fitted = await fitPictureExtents(
        zip,
        relinked.xml,
        internalImageTargets(relsPath, next),
      )
      if (fitted.xml !== original) zip.file(partPath, fitted.xml)
    }
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
