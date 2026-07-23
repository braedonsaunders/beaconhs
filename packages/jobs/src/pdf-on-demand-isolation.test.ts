import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('on-demand PDF artifact isolation', () => {
  it('uses a viewer-unique queue job instead of the deterministic background id', () => {
    const source = readFileSync(new URL('./queues/pdf.ts', import.meta.url), 'utf8')
    const start = source.indexOf('export async function renderPdfOnDemand')
    const end = source.indexOf('/**\n * Render a PDF then email', start)
    const render = source.slice(start, end)
    expect(render).toContain('getPdfQueue()')
    expect(render).toContain('|view|${randomUUID()}')
    expect(render).not.toContain('await addPdfJob(')
  })
})
