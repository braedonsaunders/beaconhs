import type { PdfJobData } from '@beaconhs/jobs'

export type PdfArtifactDisposition =
  { kind: 'transient' } | { kind: 'form_response'; responseId: string }

export function resolvePdfArtifactDisposition(data: PdfJobData): PdfArtifactDisposition {
  if (data.kind !== 'record_summary' && data.kind !== 'template_pdf') {
    return { kind: 'transient' }
  }
  if (data.email && data.artifactTarget) {
    throw new Error('A PDF email job cannot also persist a durable artifact.')
  }
  return data.artifactTarget ?? { kind: 'transient' }
}
