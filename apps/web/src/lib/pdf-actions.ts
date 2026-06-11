'use server'

// Server actions for requesting PDF renders.
//
// These enqueue a job onto the `pdfs` BullMQ queue. The worker container
// renders + uploads + links the result, and updates the relevant FK on the
// source row (form_responses.pdfAttachmentId, training_certificates.pdfAttachmentId,
// or inserts an incident_attachments link for incidents).
//
// Wave-6 kinds (hazid / toolbox / ca / document / document_book /
// equipment_workorder / ppe_issue) write a row into `attachments` and rely on
// the GET /pdf route to look up the latest matching attachment by tenant +
// entity + kind, then 307 redirect to a presigned URL.

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

export async function requestSkillCertificatePdf(
  skillCertificateId: string,
): Promise<RequestPdfResult> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'No active tenant' }
  await enqueuePdf({ kind: 'skill_certificate', tenantId: ctx.tenantId, skillCertificateId })
  await recordAudit(ctx, {
    entityType: 'training_skill_certificate',
    entityId: skillCertificateId,
    action: 'export',
    summary: 'Requested skill certificate PDF render',
  })
  return { ok: true }
}

export async function requestHazidPdf(assessmentId: string): Promise<RequestPdfResult> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'No active tenant' }
  await enqueuePdf({ kind: 'hazid', tenantId: ctx.tenantId, assessmentId })
  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: assessmentId,
    action: 'export',
    summary: 'Requested HazID assessment PDF render',
  })
  return { ok: true }
}

export async function requestCaPdf(caId: string): Promise<RequestPdfResult> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'No active tenant' }
  await enqueuePdf({ kind: 'ca', tenantId: ctx.tenantId, caId })
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: caId,
    action: 'export',
    summary: 'Requested corrective action PDF render',
  })
  return { ok: true }
}

export async function requestDocumentPdf(documentId: string): Promise<RequestPdfResult> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'No active tenant' }
  await enqueuePdf({ kind: 'document', tenantId: ctx.tenantId, documentId })
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: documentId,
    action: 'export',
    summary: 'Requested document PDF render',
  })
  return { ok: true }
}

export async function requestDocumentBookPdf(bookId: string): Promise<RequestPdfResult> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'No active tenant' }
  await enqueuePdf({ kind: 'document_book', tenantId: ctx.tenantId, bookId })
  await recordAudit(ctx, {
    entityType: 'document_book',
    entityId: bookId,
    action: 'export',
    summary: 'Requested document book PDF render',
  })
  return { ok: true }
}

export async function requestEquipmentWorkOrderPdf(workOrderId: string): Promise<RequestPdfResult> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'No active tenant' }
  await enqueuePdf({ kind: 'equipment_workorder', tenantId: ctx.tenantId, workOrderId })
  await recordAudit(ctx, {
    entityType: 'equipment_work_order',
    entityId: workOrderId,
    action: 'export',
    summary: 'Requested equipment work order PDF render',
  })
  return { ok: true }
}

export async function requestPpeIssuePdf(issueReportId: string): Promise<RequestPdfResult> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'No active tenant' }
  await enqueuePdf({ kind: 'ppe_issue', tenantId: ctx.tenantId, issueReportId })
  await recordAudit(ctx, {
    entityType: 'ppe_issue_report',
    entityId: issueReportId,
    action: 'export',
    summary: 'Requested PPE issue report PDF render',
  })
  return { ok: true }
}
