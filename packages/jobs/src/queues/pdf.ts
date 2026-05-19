import { Queue } from 'bullmq'
import { connection } from '../connection'

export type PdfJobData =
  | { kind: 'form_response'; tenantId: string; responseId: string }
  | { kind: 'incident'; tenantId: string; incidentId: string }
  | { kind: 'certificate'; tenantId: string; certificateId: string }

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
