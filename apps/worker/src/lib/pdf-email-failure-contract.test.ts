import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const worker = readFileSync(new URL('../workers/pdf.ts', import.meta.url), 'utf8')

describe('PDF email failure visibility contract', () => {
  it('records terminal attachment-generation failures in the email log', () => {
    expect(worker).toContain("if ('email' in data && data.email && isFinalAttempt(job))")
    expect(worker).toContain('recordPdfEmailFailure(job, data.email, err)')
    expect(worker).toContain('.insert(emailLog)')
    expect(worker).toContain("status: 'failed' as const")
    expect(worker).toContain("stage: 'pdf_attachment'")
    expect(worker).toContain('PDF attachment generation failed:')
    expect(worker).toContain(".replace(/https?:\\/\\/\\S+/giu, '[resource]')")
  })
})
