import { describe, expect, it } from 'vitest'
import {
  CLEANED_HERO_SLIDE_BACKGROUND,
  DEMO_ATTACHMENT_IDS,
  DEMO_ATTACHMENT_KEYS,
  FILE_LESSON_ID,
  HERO_HTML_PARAGRAPH,
  HERO_SLIDE_ID,
  SITE_SLIDE_ID,
  canonicalJson,
  cleanRichLessonHtml,
  cleanSlideLesson,
  contentHash,
  type JsonValue,
} from './missing-demo-attachment-cleanup'

function slides(): JsonValue {
  return [
    {
      id: SITE_SLIDE_ID,
      layout: 'canvas',
      bgColor: '#ffffff',
      elements: [
        {
          h: 540,
          w: 480,
          x: 0,
          y: 0,
          id: 'cc6a332e-a3c8-4139-b00b-2c7558935b46',
          fit: 'cover',
          kind: 'image',
          attachmentId: DEMO_ATTACHMENT_IDS.site,
        },
        { id: 'site-copy', kind: 'text', text: 'Keep this' },
      ],
      notes: 'Preserve me',
    },
    {
      id: HERO_SLIDE_ID,
      layout: 'canvas',
      bgColor: '#ffffff',
      elements: [
        {
          h: 540,
          w: 960,
          x: 0,
          y: 0,
          id: '4c34b942-eb76-4c5a-8e04-cd173ab82c36',
          fit: 'cover',
          kind: 'image',
          attachmentId: DEMO_ATTACHMENT_IDS.hero,
        },
        { id: 'hero-copy', kind: 'text', text: 'Readable white copy' },
      ],
    },
    { id: 'unrelated', elements: [], custom: { untouched: true } },
  ]
}

describe('missing demo attachment cleanup transforms', () => {
  it('removes only the exact rich HTML paragraph', () => {
    const before = `\n<h1>Keep</h1>\n${HERO_HTML_PARAGRAPH}<p>Keep trailing content.</p>`
    expect(cleanRichLessonHtml(before)).toBe('\n<h1>Keep</h1>\n<p>Keep trailing content.</p>')
  })

  it('rejects rich HTML with duplicate or unexpected references', () => {
    expect(() => cleanRichLessonHtml(HERO_HTML_PARAGRAPH + HERO_HTML_PARAGRAPH)).toThrow(
      'expected 1 reference(s), found 2',
    )
    expect(() =>
      cleanRichLessonHtml(HERO_HTML_PARAGRAPH.replace('alt="Hero graphic"', 'alt="Changed"')),
    ).toThrow('expected 1 reference(s), found 0')
  })

  it('removes only the two exact slide elements and changes the final background', () => {
    const before = slides()
    const cleaned = cleanSlideLesson(before)
    expect(before).toEqual(slides())
    expect(cleaned).toEqual([
      {
        id: SITE_SLIDE_ID,
        layout: 'canvas',
        bgColor: '#ffffff',
        elements: [{ id: 'site-copy', kind: 'text', text: 'Keep this' }],
        notes: 'Preserve me',
      },
      {
        id: HERO_SLIDE_ID,
        layout: 'canvas',
        bgColor: CLEANED_HERO_SLIDE_BACKGROUND,
        elements: [{ id: 'hero-copy', kind: 'text', text: 'Readable white copy' }],
      },
      { id: 'unrelated', elements: [], custom: { untouched: true } },
    ])
  })

  it('rejects a changed image element or hero background', () => {
    const changedImage = slides() as JsonValue[]
    const site = changedImage[0] as Record<string, JsonValue>
    const elements = site.elements as JsonValue[]
    ;(elements[0] as Record<string, JsonValue>).fit = 'contain'
    expect(() => cleanSlideLesson(changedImage)).toThrow('one exact image element')

    const changedBackground = slides() as JsonValue[]
    ;(changedBackground[1] as Record<string, JsonValue>).bgColor = '#000000'
    expect(() => cleanSlideLesson(changedBackground)).toThrow('exact expected white background')
  })

  it('canonicalizes JSON keys before hashing', () => {
    expect(canonicalJson({ b: 2, a: [true, null] })).toBe('{"a":[true,null],"b":2}')
    expect(contentHash({ b: 2, a: [true, null] })).toBe(contentHash({ a: [true, null], b: 2 }))
  })

  it('keeps all three object keys out of slide cleanup fixtures', () => {
    const serialized = canonicalJson(slides())
    for (const key of Object.values(DEMO_ATTACHMENT_KEYS)) expect(serialized).not.toContain(key)
  })

  it('pins the seeded file lesson to an exact UUID', () => {
    expect(FILE_LESSON_ID).toBe('203b37b1-8287-4e24-a62c-8f8a50a3946a')
  })
})
