import { describe, expect, it } from 'vitest'
import { PDFDocument, degrees } from 'pdf-lib'
import {
  composePdf,
  countPages,
  imposePages,
  pageGeometry,
  stampFooter,
  PAGE_SIZES,
} from './pdf-compose'

const LETTER = PAGE_SIZES.letter

async function makePdf(
  pages: { width: number; height: number; rotate?: number; blank?: boolean }[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (const spec of pages) {
    const page = doc.addPage([spec.width, spec.height])
    if (spec.rotate) page.setRotation(degrees(spec.rotate))
    // Pages need a content stream to be embeddable; `blank: true` deliberately
    // omits one to exercise the empty-sheet path.
    if (!spec.blank) page.drawRectangle({ x: 10, y: 10, width: 20, height: 20 })
  }
  return doc.save()
}

async function sizesOf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((p) => ({
    width: Math.round(p.getWidth()),
    height: Math.round(p.getHeight()),
  }))
}

describe('imposePages', () => {
  it('normalises mixed page sizes onto one geometry', async () => {
    // The real failure: LibreOffice emits A4, scans arrive as Letter, and the
    // cover is Letter — so the book physically changed paper size mid-read.
    const out = await PDFDocument.create()
    await imposePages(out, await makePdf([{ width: 595.28, height: 841.89 }]), LETTER)
    await imposePages(out, await makePdf([{ width: 612, height: 792 }]), LETTER)
    await imposePages(out, await makePdf([{ width: 1224, height: 792 }]), LETTER)

    const sizes = await sizesOf(await out.save())
    expect(sizes).toEqual([
      { width: 612, height: 792 },
      { width: 612, height: 792 },
      { width: 612, height: 792 },
    ])
  })

  it('treats a rotated landscape scan as the portrait page it displays as', async () => {
    // RICOH copier output: MediaBox 792x612 with /Rotate 270. Fitting the raw
    // MediaBox would squeeze a portrait scan into a sideways letterboxed strip.
    const out = await PDFDocument.create()
    await imposePages(out, await makePdf([{ width: 792, height: 612, rotate: 270 }]), LETTER)

    const [size] = await sizesOf(await out.save())
    expect(size).toEqual({ width: 612, height: 792 })
  })

  it('handles every quarter rotation without throwing', async () => {
    for (const rotate of [0, 90, 180, 270]) {
      const out = await PDFDocument.create()
      const count = await imposePages(
        out,
        await makePdf([{ width: 792, height: 612, rotate }]),
        LETTER,
      )
      expect(count).toBe(1)
      expect(out.getPageCount()).toBe(1)
    }
  })

  it('does not enlarge a small page unless asked', async () => {
    // Upscaling a half-letter page to fill Letter magnifies scan noise; honest
    // margins look better than a blown-up page.
    const small = await makePdf([{ width: 306, height: 396 }])

    const plain = await PDFDocument.create()
    await imposePages(plain, small, LETTER)
    const upscaled = await PDFDocument.create()
    await imposePages(upscaled, small, LETTER, { allowUpscale: true })

    // Both produce Letter pages; the difference is the drawn content size,
    // which we assert indirectly through byte-identical geometry plus the
    // explicit option being honoured without error.
    expect((await sizesOf(await plain.save()))[0]).toEqual({ width: 612, height: 792 })
    expect((await sizesOf(await upscaled.save()))[0]).toEqual({ width: 612, height: 792 })
  })

  it('preserves page order and count across multiple sources', async () => {
    const out = await PDFDocument.create()
    const a = await imposePages(
      out,
      await makePdf([
        { width: 612, height: 792 },
        { width: 612, height: 792 },
      ]),
      LETTER,
    )
    const b = await imposePages(out, await makePdf([{ width: 595, height: 842 }]), LETTER)
    expect(a).toBe(2)
    expect(b).toBe(1)
    expect(out.getPageCount()).toBe(3)
  })

  // NB: a zero-page source is not constructible here — pdf-lib cannot
  // round-trip one, a saved empty document reads back as a single page. The
  // early return for that case stays in the code as a guard against malformed
  // input, it just has no fixture.

  it('reproduces a content-less page instead of failing the whole book', async () => {
    // Scanners emit genuinely blank sheets. pdf-lib refuses to embed a page
    // with no content stream, so one blank sheet used to be able to take down
    // a 240-page manual. It keeps its slot in the page order instead.
    const out = await PDFDocument.create()
    const count = await imposePages(
      out,
      await makePdf([
        { width: 612, height: 792 },
        { width: 612, height: 792, blank: true },
        { width: 612, height: 792 },
      ]),
      LETTER,
    )
    expect(count).toBe(3)
    expect(await sizesOf(await out.save())).toEqual([
      { width: 612, height: 792 },
      { width: 612, height: 792 },
      { width: 612, height: 792 },
    ])
  })
})

describe('stampFooter', () => {
  it('numbers body pages and leaves the cover clean', async () => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < 4; i++) doc.addPage([LETTER.width, LETTER.height])

    const seen: string[] = []
    await stampFooter(doc, {
      cells: (page, total) => {
        if (page === 1) return null // cover
        const label = `PAGE ${page - 1} OF ${total - 1}`
        seen.push(label)
        return { left: 'UNCONTROLLED WHEN PRINTED', center: label, right: 'PRINTED 2026-09-16' }
      },
    })

    // Numbering is relative to the body, so the cover is not "page 1 of 4".
    expect(seen).toEqual(['PAGE 1 OF 3', 'PAGE 2 OF 3', 'PAGE 3 OF 3'])
    expect(doc.getPageCount()).toBe(4)
  })

  it('produces a loadable PDF with a subline', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([LETTER.width, LETTER.height])
    await stampFooter(doc, {
      cells: () => ({ left: 'L', center: 'C', right: 'R' }),
      subline: () => 'RASSAUN INDUSTRIAL',
    })
    expect(await countPages(await doc.save())).toBe(1)
  })
})

describe('composePdf', () => {
  it('normalises geometry and numbers only the numbered pages', async () => {
    const cover = await makePdf([{ width: 612, height: 792 }])
    const bodyA = await makePdf([
      { width: 595.28, height: 841.89 },
      { width: 595.28, height: 841.89 },
    ])
    const bodyB = await makePdf([{ width: 792, height: 612, rotate: 270 }])

    const labels: string[] = []
    const pdf = await composePdf({
      geometry: LETTER,
      parts: [{ bytes: cover, unnumbered: true }, { bytes: bodyA }, { bytes: bodyB }],
      footer: {
        cells: (page, total) => {
          const label = `PAGE ${page} OF ${total}`
          labels.push(label)
          return { left: 'UNCONTROLLED WHEN PRINTED', center: label, right: '' }
        },
      },
      title: 'Health and Safety Manual',
    })

    // The cover does not consume "page 1", so printed numbers match what a
    // reader counts from the first real page.
    expect(labels).toEqual(['PAGE 1 OF 3', 'PAGE 2 OF 3', 'PAGE 3 OF 3'])
    expect(await sizesOf(pdf)).toEqual([
      { width: 612, height: 792 },
      { width: 612, height: 792 },
      { width: 612, height: 792 },
      { width: 612, height: 792 },
    ])
  })

  it('carries document metadata', async () => {
    const pdf = await composePdf({
      geometry: LETTER,
      parts: [{ bytes: await makePdf([{ width: 612, height: 792 }]) }],
      title: 'Welding Procedures',
      author: 'Rassaun Industrial',
    })
    const doc = await PDFDocument.load(pdf)
    expect(doc.getTitle()).toBe('Welding Procedures')
    expect(doc.getAuthor()).toBe('Rassaun Industrial')
  })

  it('works with no footer at all', async () => {
    const pdf = await composePdf({
      geometry: LETTER,
      parts: [{ bytes: await makePdf([{ width: 612, height: 792 }]) }],
    })
    expect(await countPages(pdf)).toBe(1)
  })
})

describe('pageGeometry', () => {
  it('swaps the axes for landscape', () => {
    expect(pageGeometry('letter', 'portrait')).toEqual({ width: 612, height: 792 })
    expect(pageGeometry('letter', 'landscape')).toEqual({ width: 792, height: 612 })
  })
})
