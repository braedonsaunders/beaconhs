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
  | { kind: 'certificate'; tenantId: string; certificateId: string }
  // Skill credential (training_skill_certificates) — renders the same
  // certificate + wallet-card pair as 'certificate' but for an
  // externally-authorised skill assignment.
  | { kind: 'skill_certificate'; tenantId: string; skillCertificateId: string }
  // Generic branded "submission summary" PDF — a key-value table built from a
  // flow's field-map. The ONLY fallback when a record has no assigned PDF
  // document template. All data is inline (no DB load in the worker).
  | {
      kind: 'record_summary'
      tenantId: string
      subjectId: string
      entityType: string
      heading: string
      reference?: string | null
      subtitle?: string | null
      fields: { label: string; value: string }[]
      // Row collections (inspection criteria, log entries, attendees, …)
      // rendered as sectioned tables after the field summary.
      sections?: {
        label: string
        columns: { key: string; label: string }[]
        rows: Record<string, string>[]
        /** Rows dropped past the render cap — surfaced as a "+N more" note. */
        moreRows?: number
      }[]
      // Photo attachments rendered as an image grid.
      photos?: { url: string; caption?: string }[]
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
  // Render a published document version's artifacts (DOCX snapshot → PDF +
  // extracted text). Enqueued by publish; state tracked on the version row.
  | { kind: 'document_version_render'; tenantId: string; documentId: string; versionId: string }
  // On-demand PDF of a document's CURRENT working master (the manager's
  // Write→PDF preview) — transient artifact, never persisted to the document.
  | { kind: 'document_master_pdf'; tenantId: string; documentId: string }
  | { kind: 'document_book'; tenantId: string; bookId: string }
  // Generic multi-part bundle: each part is pre-merged HTML + its own page
  // setup; the worker prints each part and concatenates them (pdfunite) into
  // one artifact. Used for bundled record exports (e.g. a cover page + one
  // merged template per record).
  | {
      kind: 'document_bundle'
      tenantId: string
      parts: {
        html: string
        paperSize: 'letter' | 'a4' | 'legal'
        orientation: 'portrait' | 'landscape'
        marginMm: number
        headerHtml?: string | null
        footerHtml?: string | null
      }[]
      filename: string
      entityType: string
      entityId: string
      email?: PdfEmailPayload
    }
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
  | Extract<PdfJobData, { kind: 'record_summary' }>
  // A tenant PDF template merged with a record's values (the configurable
  // per-record print template); the HTML is merged before enqueue.
  | Extract<PdfJobData, { kind: 'template_pdf' }>
  | Extract<PdfJobData, { kind: 'document_master_pdf' }>
  | Extract<PdfJobData, { kind: 'document_book' }>
  | Extract<PdfJobData, { kind: 'document_bundle' }>

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
    case 'certificate':
      return `pdf|${data.tenantId}|certificate|${data.certificateId}`
    case 'skill_certificate':
      return `pdf|${data.tenantId}|skill_certificate|${data.skillCertificateId}`
    case 'record_summary':
      return `pdf|${data.tenantId}|record_summary|${data.subjectId}`
    case 'template_pdf':
      return `pdf|${data.tenantId}|template_pdf|${data.entityId ?? 'doc'}`
    case 'document_version_render':
      return `pdf|${data.tenantId}|document_version_render|${data.versionId}`
    case 'document_master_pdf':
      return `pdf|${data.tenantId}|document_master_pdf|${data.documentId}`
    case 'document_book':
      return `pdf|${data.tenantId}|document_book|${data.bookId}`
    case 'document_bundle':
      return `pdf|${data.tenantId}|document_bundle|${data.entityId}`
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
  { kind: 'record_summary' | 'template_pdf' | 'document_bundle' }
>

export async function enqueuePdfEmail(pdf: PdfEmailableJobData, email: PdfEmailPayload) {
  const jobId = `${pdfJobId(pdf)}|email|${Date.now()}-${Math.round(Math.random() * 1e6)}`
  await pdfQueue.add(pdf.kind, { ...pdf, email }, { jobId, attempts: 2 })
}

export async function enqueueSlidesImport(data: Extract<PdfJobData, { kind: 'slides_import' }>) {
  // PPTX→PNG conversion is deterministic and the worker replaces the deck
  // atomically, so run a single attempt and surface failures through
  // importStatus='failed' instead of retry loops.
  await addPdfJob(data, { attempts: 1 })
}

/** Render a just-published document version's PDF + text in the background. */
export async function enqueueDocumentVersionRender(
  data: Extract<PdfJobData, { kind: 'document_version_render' }>,
) {
  await addPdfJob(data, { attempts: 2 })
}

/**
 * Re-render a PPTX-mastered deck after the master file changed (a Collabora
 * save through the WOPI host). Uses a unique jobId — a save that lands while a
 * previous render is still active must NOT dedupe away, or the deck would be
 * left stale. The worker guards against out-of-order completion by re-checking
 * the master's version before persisting.
 */
export async function enqueueSlidesRender(data: Extract<PdfJobData, { kind: 'slides_import' }>) {
  const jobId = `${pdfJobId(data)}|r${Date.now()}-${Math.round(Math.random() * 1e6)}`
  await pdfQueue.add(data.kind, data, { attempts: 1, jobId })
}
