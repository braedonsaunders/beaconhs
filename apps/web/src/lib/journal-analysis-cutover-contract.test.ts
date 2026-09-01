import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const web = (relative: string) => readFileSync(resolve(import.meta.dirname, '..', relative), 'utf8')

describe('journal analysis cutover', () => {
  it('reads stored runs and never calls the model from the dashboard widget', () => {
    const widget = web('app/(app)/insights/_ai-widget.tsx')
    const actions = web('app/(app)/insights/_ai-actions.ts')
    expect(widget).toContain('enqueueJournalAnalysis')
    expect(widget).toContain('loadJournalAnalysisSnapshot')
    expect(widget).toContain('setDays(p.days)')
    expect(widget).not.toContain('runJournalAnalysis')
    expect(widget).not.toContain('analyseJournals')
    expect(actions).toContain('enqueueAiJob')
    expect(actions).not.toContain('analyseJournals')
  })
})
