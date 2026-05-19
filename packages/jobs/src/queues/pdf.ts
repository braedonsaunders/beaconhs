import { Queue } from 'bullmq'
import { connection } from '../connection'

export type PdfJobData =
  | { kind: 'form_response'; tenantId: string; responseId: string }
  | { kind: 'incident'; tenantId: string; incidentId: string }
  | { kind: 'certificate'; tenantId: string; certificateId: string }
  | { kind: 'hazid'; tenantId: string; assessmentId: string }
  | { kind: 'lift_plan'; tenantId: string; liftPlanId: string }
  | { kind: 'toolbox'; tenantId: string; journalId: string }
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
