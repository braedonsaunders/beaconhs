import { Queue, QueueEvents, type JobsOptions } from 'bullmq'
import { connection } from '../connection'

// When a PDF job carries an `email` payload, the worker emails the rendered PDF
// as an attachment after rendering (used by the Flows send_email attachPdf path,
// so the submit never blocks waiting on Chromium).
export type PdfEmailPayload = {
  to: string[]
  subject: string
  html: string
  text: string
  filename: string
  category?: string
  tenantId?: string
}

export type PdfJobData =
  | { kind: 'form_response'; tenantId: string; responseId: string; email?: PdfEmailPayload }
  | { kind: 'incident'; tenantId: string; incidentId: string; email?: PdfEmailPayload }
  | { kind: 'certificate'; tenantId: string; certificateId: string }
  // Skill credential (training_skill_certificates) — renders the same
  // certificate + wallet-card pair as 'certificate' but for an
  // externally-authorised skill assignment.
  | { kind: 'skill_certificate'; tenantId: string; skillCertificateId: string }
  | { kind: 'hazid'; tenantId: string; assessmentId: string; email?: PdfEmailPayload }
  | { kind: 'ca'; tenantId: string; caId: string; email?: PdfEmailPayload }
  // Generic branded "submission summary" PDF — a key-value table built from a
  // flow's field-map. Fills the gap for modules without a bespoke renderer
  // (journals, inspections). All data is inline (no DB load in the worker).
  | {
      kind: 'record_summary'
      tenantId: string
      subjectId: string
      entityType: string
      heading: string
      reference?: string | null
      subtitle?: string | null
      fields: { label: string; value: string }[]
      filename?: string
      email?: PdfEmailPayload
    }
  // Tenant PDF DOCUMENT template (paper-size builder). The HTML is already
  // merged (compiled template + record values) by the flow executor; the worker
  // only prints it with the page setup. {{page}}/{{pages}} in header/footer are
  // kept for the printer's page-number substitution.
  | {
      kind: 'template_pdf'
      tenantId: string
      html: string
      paperSize: 'letter' | 'a4' | 'legal'
      orientation: 'portrait' | 'landscape'
      marginMm: number
      headerHtml?: string | null
      footerHtml?: string | null
      entityType?: string
      entityId?: string
      filename?: string
      email?: PdfEmailPayload
    }
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

export type OnDemandPdfJobData =
  | Extract<PdfJobData, { kind: 'form_response' }>
  | Extract<PdfJobData, { kind: 'incident' }>
  | Extract<PdfJobData, { kind: 'hazid' }>
  | Extract<PdfJobData, { kind: 'ca' }>
  | Extract<PdfJobData, { kind: 'record_summary' }>
  | Extract<PdfJobData, { kind: 'document' }>
  | Extract<PdfJobData, { kind: 'document_book' }>
  | Extract<PdfJobData, { kind: 'equipment_workorder' }>
  | Extract<PdfJobData, { kind: 'ppe_issue' }>

export type RenderedPdfArtifact = {
  attachmentId?: string | null
  r2Key: string
  sizeBytes: number
  filename: string
}

export const pdfQueue = new Queue<PdfJobData, unknown>('pdfs', {
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
    case 'record_summary':
      return `pdf|${data.tenantId}|record_summary|${data.subjectId}`
    case 'template_pdf':
      return `pdf|${data.tenantId}|template_pdf|${data.entityId ?? 'doc'}`
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

    // Completed PDF jobs are render records, not caches. Clear the old job so
    // an explicit PDF request can generate a fresh artifact on demand.
    await existing.remove()
  }

  return pdfQueue.add(data.kind, data, { ...opts, jobId })
}

export async function enqueuePdf(data: PdfJobData) {
  await addPdfJob(data)
}

function isRenderedPdfArtifact(value: unknown): value is RenderedPdfArtifact {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<RenderedPdfArtifact>
  return (
    (result.attachmentId === undefined ||
      result.attachmentId === null ||
      typeof result.attachmentId === 'string') &&
    typeof result.r2Key === 'string' &&
    typeof result.sizeBytes === 'number' &&
    typeof result.filename === 'string'
  )
}

export async function renderPdfOnDemand(
  data: OnDemandPdfJobData,
  opts: { timeoutMs?: number } = {},
): Promise<RenderedPdfArtifact> {
  const job = await addPdfJob(data, {
    attempts: 1,
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 24 * 3600 },
  })
  const events = new QueueEvents('pdfs', { connection })
  await events.waitUntilReady()
  try {
    const result = await job.waitUntilFinished(events, opts.timeoutMs ?? 60_000)
    if (!isRenderedPdfArtifact(result)) {
      throw new Error(`PDF job ${job.id} completed without a generated PDF artifact`)
    }
    return result
  } finally {
    await events.close()
  }
}

/**
 * Render a PDF then email it as an attachment (the Flows `send_email` attachPdf
 * path). Uses a unique jobId so it never dedups away an on-demand "view PDF" job
 * or vice-versa; the worker emails after rendering. Fire-and-forget — the caller
 * (a submit action) does not wait on Chromium.
 */
export type PdfEmailableJobData = Extract<
  PdfJobData,
  { kind: 'form_response' | 'incident' | 'hazid' | 'ca' | 'record_summary' | 'template_pdf' }
>

export async function enqueuePdfEmail(pdf: PdfEmailableJobData, email: PdfEmailPayload) {
  const jobId = `${pdfJobId(pdf)}|email|${Date.now()}-${Math.round(Math.random() * 1e6)}`
  await pdfQueue.add(pdf.kind, { ...pdf, email }, { jobId, attempts: 2 })
}

export async function enqueueSlidesImport(data: Extract<PdfJobData, { kind: 'slides_import' }>) {
  // PPTX→PNG conversion is deterministic; a retry after partial failure would
  // duplicate appended slides, so run a single attempt and surface failures
  // through importStatus='failed' instead.
  await addPdfJob(data, { attempts: 1 })
}
