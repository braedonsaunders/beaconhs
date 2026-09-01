import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = (relative: string) => readFileSync(resolve(import.meta.dirname, relative), 'utf8')

describe('journal analysis worker cutover', () => {
  it('scans and runs analysis off the web request path', () => {
    const lib = src('journal-analysis.ts')
    const scheduled = src('../workers/scheduled.ts')
    const index = src('../index.ts')
    expect(lib).toContain('analyseJournals')
    expect(lib).toContain('enqueueAiJob')
    expect(scheduled).toContain('journal_analysis_scan')
    expect(index).toContain("new Worker('ai'")
    expect(index).toContain('lockDuration: 5 * 60 * 1000')
  })
})
