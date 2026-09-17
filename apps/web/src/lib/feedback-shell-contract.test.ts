import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('in-app issue reporter contract', () => {
  it('mounts the header control from the authenticated shell', () => {
    const shell = readFileSync(resolve(import.meta.dirname, '../components/app-shell.tsx'), 'utf8')
    const reporter = readFileSync(
      resolve(import.meta.dirname, '../components/feedback-reporter.tsx'),
      'utf8',
    )
    expect(shell).toContain('FeedbackLauncher')
    expect(shell).toContain('canUseFeedback')
    expect(reporter).toContain('data-walkthrough="report-issue"')
  })

  it('keeps the turn route tenant-scoped and destination-gated', () => {
    const route = readFileSync(
      resolve(import.meta.dirname, '../app/(app)/feedback/turn/route.ts'),
      'utf8',
    )
    const github = readFileSync(resolve(import.meta.dirname, './feedback-github.ts'), 'utf8')
    expect(route).toContain("can(ctx, 'feedback.use')")
    expect(route).toContain('createGithubIssuePublisher')
    expect(route).toContain('feedbackGithubRequest')
    expect(github).toContain('secureFetch')
    expect(route).toContain('scope: SCOPE')
    expect(route).toContain("const SCOPE = 'feedback'")
  })
})
