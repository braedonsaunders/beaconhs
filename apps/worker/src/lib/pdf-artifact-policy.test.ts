import { describe, expect, it } from 'vitest'
import type { PdfJobData } from '@beaconhs/jobs'
import { resolvePdfArtifactDisposition } from './pdf-artifact-policy'

const TENANT_ID = '10000000-0000-4000-8000-000000000001'
const RESPONSE_ID = '20000000-0000-4000-8000-000000000001'

function summary(overrides: Partial<Extract<PdfJobData, { kind: 'record_summary' }>> = {}) {
  return {
    kind: 'record_summary' as const,
    tenantId: TENANT_ID,
    subjectId: RESPONSE_ID,
    entityType: 'form_response',
    heading: 'Form response',
    fields: [],
    ...overrides,
  }
}

describe('PDF artifact disposition', () => {
  it('persists an explicit form-flow export against its response', () => {
    expect(
      resolvePdfArtifactDisposition(
        summary({ artifactTarget: { kind: 'form_response', responseId: RESPONSE_ID } }),
      ),
    ).toEqual({ kind: 'form_response', responseId: RESPONSE_ID })
  })

  it('keeps an on-demand render transient', () => {
    expect(resolvePdfArtifactDisposition(summary())).toEqual({ kind: 'transient' })
  })

  it('keeps an email render transient and rejects conflicting durable delivery', () => {
    const email = {
      to: ['safety@example.com'],
      subject: 'Response',
      html: '<p>Attached</p>',
      text: 'Attached',
      filename: 'response.pdf',
    }
    expect(resolvePdfArtifactDisposition(summary({ email }))).toEqual({ kind: 'transient' })
    expect(() =>
      resolvePdfArtifactDisposition(
        summary({
          email,
          artifactTarget: { kind: 'form_response', responseId: RESPONSE_ID },
        }),
      ),
    ).toThrow(/cannot also persist/)
  })
})
