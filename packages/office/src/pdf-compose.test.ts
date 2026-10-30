import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, degrees } from 'pdf-lib'
import { composePdf, imposePages } from './pdf-compose'

// Asymmetric labelled corners make a 180-degree inversion distinguishable from
// merely swapping width and height. Exercise both shared composer entry points.
describe('PDF rotation in document books', () => {
  for (const rotation of [0, 90, 180, 270]) {
    it(`preserves the viewer orientation of a page with /Rotate ${rotation}`, async () => {
      const source = await PDFDocument.create()
      const page = source.addPage([400, 600])
      page.drawText('TOP LEFT', { x: 10, y: 570 })
      page.drawText('BOTTOM RIGHT', { x: 230, y: 20 })
      page.setRotation(degrees(rotation))
      const bytes = await source.save()
      const quarter = rotation === 90 || rotation === 270
      const geometry = { width: quarter ? 600 : 400, height: quarter ? 400 : 600 }
      const composed = await composePdf({ geometry, parts: [{ bytes }], marginPt: 0 })
      const imposed = await PDFDocument.create()
      await imposePages(imposed, bytes, geometry)
      for (const result of [
        await PDFDocument.load(composed),
        await PDFDocument.load(await imposed.save()),
      ]) {
        const output = result.getPage(0)
        expect(output.getSize()).toEqual(geometry)
        expect(output.getRotation().angle).toBe(0)
        const contents = output.node.lookup(PDFName.of('Contents'), PDFArray)
        const stream = contents.lookup(0, PDFRawStream)
        const text = Buffer.from(decodePDFRawStream(stream).decode()).toString()
        const matrices = [
          ...text.matchAll(/([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) cm/g),
        ].map((m) => m.slice(1).map(Number))
        const matrix = matrices[1]!
        // /Rotate is clockwise; the emitted drawing matrix must turn clockwise too.
        const expected =
          rotation === 90
            ? [0, -1, 1, 0]
            : rotation === 180
              ? [-1, 0, 0, -1]
              : rotation === 270
                ? [0, 1, -1, 0]
                : [1, 0, 0, 1]
        expected.forEach((value, i) => expect(matrix[i]).toBeCloseTo(value))
      }
    })
  }
})
