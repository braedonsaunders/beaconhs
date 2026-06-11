import { Queue } from 'bullmq'
import { connection } from '../connection'

export type PdfJobData =
  | { kind: 'form_response'; tenantId: string; responseId: string }
  | { kind: 'incident'; tenantId: string; incidentId: string }
  | { kind: 'certificate'; tenantId: string; certificateId: string }
  // Skill credential (training_skill_certificates) — renders the same
  // certificate + wallet-card pair as 'certificate' but for an
  // externally-authorised skill assignment.
  | { kind: 'skill_certificate'; tenantId: string; skillCertificateId: string }
  | { kind: 'hazid'; tenantId: string; assessmentId: string }
  | { kind: 'ca'; tenantId: string; caId: string }
  | { kind: 'document'; tenantId: string; documentId: string }
  | { kind: 'document_book'; tenantId: string; bookId: string }
  | { kind: 'equipment_workorder'; tenantId: string; workOrderId: string }
  | { kind: 'ppe_issue'; tenantId: string; issueReportId: string }
  // Wave-7: bundle N hazid assessments into a single signed-report PDF.
  // The builder inserts a `hazid_signed_reports` row with status='pending';
  // the worker flips it to 'rendering', concatenates per-assessment HTML +
  // a cover page, prints once, then stamps pdfAttachmentId/status='completed'.
  | { kind: 'hazid_signed_report'; tenantId: string; reportId: string }
  // LMS: convert an uploaded PowerPoint into per-slide PNG images + notes and
  // write the resulting Slide[] onto a training lesson or library content item.
  | {
      kind: 'slides_import'
      tenantId: string
      target: 'lesson' | 'content_item'
      targetId: string
      attachmentId: string
    }

export const pdfQueue = new Queue<PdfJobData>('pdfs', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 15_000 },
    removeOnComplete: { age: 3 * 24 * 3600 },
    removeOnFail: { age: 30 * 24 * 3600 },
  },
})

export async function enqueuePdf(data: PdfJobData) {
  await pdfQueue.add(data.kind, data)
}

export async function enqueueSlidesImport(data: Extract<PdfJobData, { kind: 'slides_import' }>) {
  // PPTX→PNG conversion is deterministic; a retry after partial failure would
  // duplicate appended slides, so run a single attempt and surface failures
  // through importStatus='failed' instead.
  await pdfQueue.add(data.kind, data, { attempts: 1 })
}
