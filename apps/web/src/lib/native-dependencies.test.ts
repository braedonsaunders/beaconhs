import { describe, expect, it } from 'vitest'

function createMinimalPdf(): Uint8Array {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << >> /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((object) => {
    const offset = pdf.length
    pdf += object
    return offset
  })
  const xrefOffset = pdf.length
  const entries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `)
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries.join('\n')}\n` +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`

  return new TextEncoder().encode(pdf)
}

describe('native production dependencies', () => {
  it('loads the canvas backend and emits a real PNG', async () => {
    const { createCanvas } = await import('@napi-rs/canvas')
    const canvas = createCanvas(2, 2)
    const context = canvas.getContext('2d')
    context.fillStyle = '#0f766e'
    context.fillRect(0, 0, 2, 2)

    const png = canvas.toBuffer('image/png')
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
    expect(png.byteLength).toBeGreaterThan(40)
  })

  it('renders a PDF page through unpdf with the native canvas backend', async () => {
    const { renderPageAsImage } = await import('unpdf')
    const image = await renderPageAsImage(createMinimalPdf(), 1, {
      canvasImport: () => import('@napi-rs/canvas'),
      toDataURL: true,
      width: 2,
    })

    expect(image).toMatch(/^data:image\/png;base64,/)
  })
})
