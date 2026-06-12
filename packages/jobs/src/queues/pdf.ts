import { Queue, type JobsOptions } from 'bullmq'
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

function pdfJobId(data: PdfJobData): string {
  switch (data.kind) {
    case 'form_response':
      return `pdf|${data.tenantId}|form_response|${data.responseId}`
    case 'incident':
      return `pdf|${data.tenantId}|incident|${data.incidentId}`
    case 'certificate':
      return `pdf|${data.tenantId}|certificate|${data.certificateId}`
    case 'skill_certificate':
      return `pdf|${data.tenantId}|skill_certificate|${data.skillCertificateId}`
    case 'hazid':
      return `pdf|${data.tenantId}|hazid|${data.assessmentId}`
    case 'ca':
      return `pdf|${data.tenantId}|ca|${data.caId}`
    case 'document':
      return `pdf|${data.tenantId}|document|${data.documentId}`
    case 'document_book':
      return `pdf|${data.tenantId}|document_book|${data.bookId}`
    case 'equipment_workorder':
      return `pdf|${data.tenantId}|equipment_workorder|${data.workOrderId}`
    case 'ppe_issue':
      return `pdf|${data.tenantId}|ppe_issue|${data.issueReportId}`
    case 'hazid_signed_report':
      return `pdf|${data.tenantId}|hazid_signed_report|${data.reportId}`
    case 'slides_import':
      return `pdf|${data.tenantId}|slides_import|${data.target}|${data.targetId}|${data.attachmentId}`
  }
}

async function addPdfJob(data: PdfJobData, opts?: JobsOptions) {
  const jobId = pdfJobId(data)
  const existing = await pdfQueue.getJob(jobId)
  if (existing) {
    const state = await existing.getState()
    if (state !== 'completed' && state !== 'failed') return existing

    // The route only re-enqueues when the artifact is still missing. If the
    // previous job has already ended, clear it so a legitimate retry can run.
    await existing.remove()
  }

  return pdfQueue.add(data.kind, data, { ...opts, jobId })
}

export async function enqueuePdf(data: PdfJobData) {
  await addPdfJob(data)
}

export async function enqueueSlidesImport(data: Extract<PdfJobData, { kind: 'slides_import' }>) {
  // PPTX→PNG conversion is deterministic; a retry after partial failure would
  // duplicate appended slides, so run a single attempt and surface failures
  // through importStatus='failed' instead.
  await addPdfJob(data, { attempts: 1 })
}
