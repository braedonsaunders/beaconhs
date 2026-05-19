'use server'

// Server actions for requesting PDF renders.
//
// These enqueue a job onto the `pdfs` BullMQ queue. The worker container
// renders + uploads + links the result, and updates the relevant FK on the
// source row (form_responses.pdfAttachmentId, training_certificates.pdfAttachmentId,
// or inserts an incident_attachments link for incidents).
//
// Callers (route handlers, button onClick) should poll the source row /
// route handler GET endpoint to discover when the PDF is ready.

import { enqueuePdf } from '@beaconhs/jobs'
import { requireRequestContext } from './auth'
import { recordAudit } from './audit'

export type RequestPdfResult = { ok: true } | { ok: false; error: string }

export async function requestIncidentPdf(incidentId: string): Promise<RequestPdfResult> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'No active tenant' }
  await enqueuePdf({ kind: 'incident', tenantId: ctx.tenantId, incidentId })
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: incidentId,
    action: 'export',
    summary: 'Requested incident PDF render',
  })
  return { ok: true }
}

export async function requestFormResponsePdf(responseId: string): Promise<RequestPdfResult> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'No active tenant' }
  await enqueuePdf({ kind: 'form_response', tenantId: ctx.tenantId, responseId })
  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'export',
    summary: 'Requested form response PDF render',
  })
  return { ok: true }
}

export async function requestCertificatePdf(certificateId: string): Promise<RequestPdfResult> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'No active tenant' }
  await enqueuePdf({ kind: 'certificate', tenantId: ctx.tenantId, certificateId })
  await recordAudit(ctx, {
    entityType: 'training_certificate',
    entityId: certificateId,
    action: 'export',
    summary: 'Requested certificate PDF render',
  })
  return { ok: true }
}
