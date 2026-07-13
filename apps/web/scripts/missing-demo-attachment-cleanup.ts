import { createHash } from 'node:crypto'

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export const DEMO_ATTACHMENT_IDS = {
  site: '171d6bb8-4769-44b5-9a74-d2bee68d83de',
  reference: '1821609d-5df0-427d-863c-b2742371af76',
  hero: '6a8804b6-c620-42fa-b0e3-4e2b79e7222a',
} as const

export const DEMO_ATTACHMENT_KEYS = {
  site: 't/362623eb-f615-4610-b2f9-3422dde18cf4/image/1781059128189-1m5ltbtk-demo-site.svg',
  reference:
    't/362623eb-f615-4610-b2f9-3422dde18cf4/document/1781059128328-fv6bzbg4-demo-quick-reference.pdf',
  hero: 't/362623eb-f615-4610-b2f9-3422dde18cf4/image/1781059128057-3jsk7v1y-demo-hero.svg',
} as const

export const RICH_LESSON_ID = 'fc18edf4-247a-4d5e-88bc-bb95cd7c957f'
export const SLIDE_LESSON_ID = 'ecf5bd3d-e13c-47f5-beaf-427bb13e1943'
export const FILE_LESSON_ID = '203b37b1-8287-4e24-a62c-8f8a50a3946a'
export const SITE_SLIDE_ID = '2a6236fa-c706-4288-a2e2-f0b44282d528'
export const HERO_SLIDE_ID = '9d1a7146-5669-4b5e-bb25-752a74d10aa9'
export const CLEANED_HERO_SLIDE_BACKGROUND = '#134e4a'

const SITE_ELEMENT = {
  h: 540,
  w: 480,
  x: 0,
  y: 0,
  id: 'cc6a332e-a3c8-4139-b00b-2c7558935b46',
  fit: 'cover',
  kind: 'image',
  attachmentId: DEMO_ATTACHMENT_IDS.site,
} satisfies JsonValue

const HERO_ELEMENT = {
  h: 540,
  w: 960,
  x: 0,
  y: 0,
  id: '4c34b942-eb76-4c5a-8e04-cd173ab82c36',
  fit: 'cover',
  kind: 'image',
  attachmentId: DEMO_ATTACHMENT_IDS.hero,
} satisfies JsonValue

export const HERO_HTML_PARAGRAPH = `<p><img src="http://localhost:9000/beaconhs-dev/${DEMO_ATTACHMENT_KEYS.hero}" alt="Hero graphic"></p>\n`

function objectValue(value: JsonValue, label: string): Record<string, JsonValue> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function arrayValue(value: JsonValue | undefined, label: string): JsonValue[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JSON contains a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(',')}}`
}

export function contentHash(value: string | JsonValue): string {
  const serialized = typeof value === 'string' ? value : canonicalJson(value)
  return createHash('sha256').update(serialized).digest('hex')
}

function occurrences(value: string, needle: string): number {
  if (!needle) throw new Error('Cannot count an empty token')
  return value.split(needle).length - 1
}

function assertReferenceCount(
  value: string,
  needle: string,
  expected: number,
  label: string,
): void {
  const actual = occurrences(value, needle)
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected} reference(s), found ${actual}`)
  }
}

/** Remove only the exact seeded image paragraph, leaving every other byte intact. */
export function cleanRichLessonHtml(value: string): string {
  assertReferenceCount(value, HERO_HTML_PARAGRAPH, 1, 'Rich lesson hero paragraph')
  assertReferenceCount(value, DEMO_ATTACHMENT_KEYS.hero, 1, 'Rich lesson hero object key')
  for (const id of Object.values(DEMO_ATTACHMENT_IDS)) {
    assertReferenceCount(value, id, 0, `Rich lesson attachment ${id}`)
  }
  const cleaned = value.replace(HERO_HTML_PARAGRAPH, '')
  assertReferenceCount(cleaned, DEMO_ATTACHMENT_KEYS.hero, 0, 'Cleaned rich lesson hero key')
  return cleaned
}

function findSlide(slides: JsonValue[], id: string): Record<string, JsonValue> {
  const matching = slides.filter((slide) => objectValue(slide, 'Slide').id === id)
  if (matching.length !== 1) throw new Error(`Expected exactly one slide ${id}`)
  return objectValue(matching[0]!, `Slide ${id}`)
}

function removeExactElement(
  slide: Record<string, JsonValue>,
  expected: JsonValue,
  label: string,
): void {
  const elements = arrayValue(slide.elements, `${label} elements`)
  const expectedJson = canonicalJson(expected)
  const indexes = elements.flatMap((element, index) =>
    canonicalJson(element) === expectedJson ? [index] : [],
  )
  if (indexes.length !== 1) throw new Error(`${label} did not contain its one exact image element`)
  elements.splice(indexes[0]!, 1)
}

/** Remove the two exact seeded image elements while preserving all unrelated slide JSON. */
export function cleanSlideLesson(value: JsonValue): JsonValue {
  if (!Array.isArray(value)) throw new Error('Slide lesson slides must be an array')
  const before = canonicalJson(value)
  assertReferenceCount(before, DEMO_ATTACHMENT_IDS.site, 1, 'Slide lesson site attachment')
  assertReferenceCount(before, DEMO_ATTACHMENT_IDS.hero, 1, 'Slide lesson hero attachment')
  assertReferenceCount(before, DEMO_ATTACHMENT_IDS.reference, 0, 'Slide lesson PDF attachment')
  for (const key of Object.values(DEMO_ATTACHMENT_KEYS)) {
    assertReferenceCount(before, key, 0, `Slide lesson object key ${key}`)
  }

  const cleaned = structuredClone(value)
  const siteSlide = findSlide(cleaned, SITE_SLIDE_ID)
  const heroSlide = findSlide(cleaned, HERO_SLIDE_ID)
  removeExactElement(siteSlide, SITE_ELEMENT, 'Site slide')
  removeExactElement(heroSlide, HERO_ELEMENT, 'Hero slide')
  if (heroSlide.bgColor !== '#ffffff') {
    throw new Error('Hero slide did not have the exact expected white background')
  }
  heroSlide.bgColor = CLEANED_HERO_SLIDE_BACKGROUND

  const after = canonicalJson(cleaned)
  for (const id of Object.values(DEMO_ATTACHMENT_IDS)) {
    assertReferenceCount(after, id, 0, `Cleaned slide lesson attachment ${id}`)
  }
  return cleaned
}
