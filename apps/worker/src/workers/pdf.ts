// PDF worker.
//
// Consumes the `pdfs` BullMQ queue and renders all worker-rendered PDF kinds.
// On-demand route renders return transient object-store artifacts; the web
// route streams the bytes back and deletes the temporary object. Long-lived
// bundle/background outputs still persist attachment rows where the PDF is the
// durable artifact of record.

import type { Job } from 'bullmq'
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import {
  db,
  lockFormResponseForMutation,
  MAX_DOCUMENT_BOOK_ITEMS,
  resolveDocumentBookItems,
  withSuperAdmin,
  withTenant,
} from '@beaconhs/db'
import {
  attachments,
  documentBookItems,
  documentBooks,
  documentVersions,
  documents,
  emailLog,
  formResponses,
  tenants,
} from '@beaconhs/db/schema'
import { renderHtmlDocumentPdf, renderRecordSummaryPdf } from '@beaconhs/forms-pdf'
import {
  enqueueEmail,
  type PdfEmailPayload,
  type PdfJobData,
  type RenderedPdfArtifact,
} from '@beaconhs/jobs'
import {
  deleteObject,
  getObject,
  headObject,
  newAttachmentKey,
  newTenantObjectKey,
  putObject,
} from '@beaconhs/storage'
import { renderDocumentMasterPdf, renderDocumentVersion } from './document-render'
import { pdfUnite } from '@beaconhs/office'
import { audit } from '@beaconhs/audit'
import { assertEmailAttachmentSize } from '../lib/email-attachment-policy'
import { commitExternalArtifact } from '../lib/external-artifact-commit'
import {
  resolvePdfArtifactDisposition,
  type PdfArtifactDisposition,
} from '../lib/pdf-artifact-policy'

const MAX_GENERATED_PDF_BYTES = 200 * 1024 * 1024
const MAX_DOCUMENT_BOOK_SOURCE_BYTES = 50 * 1024 * 1024
const MAX_DOCUMENT_BOOK_TOTAL_SOURCE_BYTES = 250 * 1024 * 1024

function assertGeneratedPdf(pdf: Buffer): void {
  if (pdf.length === 0 || pdf.length > MAX_GENERATED_PDF_BYTES) {
    throw new Error('Generated PDF must be between 1 byte and 200 MiB.')
  }
}

export async function processPdf(job: Job<PdfJobData, unknown>): Promise<unknown> {
  const data = job.data
  try {
    const result = await dispatchPdf(data)
    // Flows attachPdf path: once rendered + stored, email the PDF as an attachment.
    if ('email' in data && data.email && isRenderedArtifact(result)) {
      await emailRenderedPdf(data.email, result)
    }
    return result
  } catch (err) {
    console.error(`[pdf] job ${job.id} failed:`, err)
    if ('email' in data && data.email && isFinalAttempt(job)) {
      await recordPdfEmailFailure(job, data.email, err).catch((logError: unknown) => {
        console.error(`[pdf] job ${job.id} email failure could not be logged:`, logError)
      })
    }
    throw err
  }
}

function isFinalAttempt(job: Job<PdfJobData, unknown>): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
}

async function recordPdfEmailFailure(
  job: Job<PdfJobData, unknown>,
  email: PdfEmailPayload,
  error: unknown,
): Promise<void> {
  const jobId = String(job.id ?? '')
  const failureDetail = (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/\S+/giu, '[resource]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
  const message = `PDF attachment generation failed: ${failureDetail || 'Unknown PDF error'}`.slice(
    0,
    4_000,
  )
  const recipients = [
    ...new Set(email.to.map((recipient) => recipient.trim().toLowerCase())),
  ].filter(Boolean)
  if (!email.tenantId || recipients.length === 0) return

  await withSuperAdmin(db, async (tx) => {
    const existing = jobId
      ? await tx
          .select({ recipientPrimary: emailLog.recipientPrimary })
          .from(emailLog)
          .where(and(eq(emailLog.jobId, jobId), eq(emailLog.subject, email.subject)))
      : []
    const recorded = new Set(existing.map((row) => row.recipientPrimary).filter(Boolean))
    const missing = recipients.filter((recipient) => !recorded.has(recipient))
    if (missing.length === 0) return

    await tx.insert(emailLog).values(
      missing.map((recipient) => ({
        tenantId: email.tenantId,
        jobId,
        recipients: [recipient],
        recipientPrimary: recipient,
        cc: [],
        bcc: [],
        fromAddr: 'unavailable',
        subject: email.subject,
        htmlSize: Buffer.byteLength(email.html, 'utf8'),
        textSize: Buffer.byteLength(email.text, 'utf8'),
        htmlBody: email.html,
        textBody: email.text,
        status: 'failed' as const,
        categoryKey: email.category ?? null,
        errorMessage: message,
        meta: {
          tenantId: email.tenantId,
          category: email.category,
          stage: 'pdf_attachment',
          attempt: job.attemptsMade + 1,
          pdfJobId: jobId,
        },
      })),
    )
  })
}

async function dispatchPdf(data: PdfJobData): Promise<unknown> {
  switch (data.kind) {
    case 'record_summary':
      return await renderRecordSummary(data)
    case 'template_pdf':
      return await renderTemplatePdf(data)
    case 'document_version_render':
      return await renderDocumentVersion(data)
    case 'document_master_pdf':
      return await renderDocumentMasterPdf(data)
    case 'document_book':
      return await renderDocumentBook(data.tenantId, data.bookId)
    case 'document_bundle':
      return await renderDocumentBundle(data)
  }
}

function isRenderedArtifact(v: unknown): v is RenderedPdfArtifact {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as RenderedPdfArtifact).r2Key === 'string' &&
    typeof (v as RenderedPdfArtifact).filename === 'string'
  )
}

async function emailRenderedPdf(
  email: PdfEmailPayload,
  artifact: RenderedPdfArtifact,
): Promise<void> {
  // A storage read failure must FAIL the job (BullMQ retries; renders are
  // idempotent transient artifacts) — swallowing it would silently drop the
  // flow's configured email while the job reports success.
  assertEmailAttachmentSize(artifact.sizeBytes)
  const metadata = await headObject({ key: artifact.r2Key })
  if (!metadata) throw new Error('Rendered PDF object was not found before email delivery.')
  assertEmailAttachmentSize(metadata.contentLength)
  if (metadata.contentLength !== artifact.sizeBytes) {
    throw new Error('Rendered PDF object size changed before email delivery.')
  }
  const bytes = await getObject({ key: artifact.r2Key })
  if (bytes.length !== artifact.sizeBytes) {
    throw new Error('Rendered PDF object size changed during email delivery.')
  }
  await enqueueEmail({
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    attachments: [
      ...(email.attachments ?? []),
      {
        filename: email.filename || artifact.filename,
        content: bytes.toString('base64'),
        contentType: 'application/pdf',
      },
    ],
    meta: { tenantId: email.tenantId, category: email.category },
  })
  // The transient render artifact has served its purpose once attached.
  try {
    await deleteObject({ key: artifact.r2Key })
  } catch {
    /* best-effort cleanup */
  }
}

// --- record_summary -------------------------------------------------------

async function renderRecordSummary(
  data: Extract<PdfJobData, { kind: 'record_summary' }>,
): Promise<StoredPdfResult> {
  const tenantName = await withTenant(db, data.tenantId, async (tx) => {
    const [t] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, data.tenantId))
      .limit(1)
    return t?.name ?? 'BeaconHS'
  })
  const pdf = await renderRecordSummaryPdf({
    tenantName,
    heading: data.heading,
    reference: data.reference ?? null,
    subtitle: data.subtitle ?? null,
    fields: data.fields,
    sections: data.sections,
    photos: data.photos,
  })
  const stamp = Date.now()
  const ref = data.reference || data.subjectId.slice(0, 8)
  const filename = data.filename || `${data.entityType}-${ref}-${stamp}.pdf`
  const r2Key = newTenantObjectKey({
    tenantId: data.tenantId,
    scope: '_transient/pdfs/record-summary',
    filename: `${data.subjectId}-${stamp}.pdf`,
  })
  return storePdfArtifact({
    tenantId: data.tenantId,
    pdf,
    filename,
    r2Key,
    entityType: data.entityType,
    entityId: data.subjectId,
    summary: `Rendered ${data.heading} PDF`,
    disposition: resolvePdfArtifactDisposition(data),
  })
}

// --- template_pdf (tenant PDF document template) --------------------------
// The HTML is already merged by the flow executor; print it on the chosen page.
async function renderTemplatePdf(
  data: Extract<PdfJobData, { kind: 'template_pdf' }>,
): Promise<StoredPdfResult> {
  const pdf = await renderHtmlDocumentPdf({
    bodyHtml: data.html,
    paperSize: data.paperSize,
    orientation: data.orientation,
    marginMm: data.marginMm,
    headerHtml: data.headerHtml ?? null,
    footerHtml: data.footerHtml ?? null,
  })
  const stamp = Date.now()
  const entityType = data.entityType ?? 'document'
  const entityId = data.entityId ?? 'doc'
  const filename = data.filename || `${entityType}-${stamp}.pdf`
  return storePdfArtifact({
    tenantId: data.tenantId,
    pdf,
    filename,
    r2Key: newTenantObjectKey({
      tenantId: data.tenantId,
      scope: '_transient/pdfs/template',
      filename: `${entityId}-${stamp}.pdf`,
    }),
    entityType,
    entityId,
    summary: 'Rendered PDF document template',
    disposition: resolvePdfArtifactDisposition(data),
  })
}

// --- document_bundle (multi-part concatenated PDF) --------------------------
// Each part is pre-merged HTML with its own page setup; print each part and
// concatenate with pdfunite into a single artifact.
async function renderDocumentBundle(
  data: Extract<PdfJobData, { kind: 'document_bundle' }>,
): Promise<StoredPdfResult> {
  if (data.parts.length === 0) {
    throw new Error('document_bundle job has no parts')
  }
  const parts: Buffer[] = []
  for (const part of data.parts) {
    parts.push(
      await renderHtmlDocumentPdf({
        bodyHtml: part.html,
        paperSize: part.paperSize,
        orientation: part.orientation,
        marginMm: part.marginMm,
        headerHtml: part.headerHtml ?? null,
        footerHtml: part.footerHtml ?? null,
      }),
    )
  }
  const pdf = parts.length === 1 ? parts[0]! : await pdfUnite(parts)

  const stamp = Date.now()
  return storeTransientPdfArtifact({
    tenantId: data.tenantId,
    pdf,
    filename: data.filename,
    r2Key: newTenantObjectKey({
      tenantId: data.tenantId,
      scope: '_transient/pdfs/bundles',
      filename: `${data.entityId}-${stamp}.pdf`,
    }),
    entityType: data.entityType,
    entityId: data.entityId,
    summary: `Rendered bundled PDF (${data.parts.length} parts)`,
  })
}

// --- Shared helpers for on-demand PDF kinds --------------------------------
//
// On-demand PDFs are transient artifacts: the worker renders to object storage
// so the web route can stream the bytes back, then the route deletes the object.
// Do not create attachment rows for these renders; clicking "PDF" should not
// mutate domain file lists or create stale generated artifacts.

type StoredPdfResult = RenderedPdfArtifact

type PdfArtifactInput = {
  tenantId: string
  pdf: Buffer
  filename: string
  r2Key: string
  entityType: string
  entityId: string
  summary: string
}

async function storePdfArtifact(
  args: PdfArtifactInput & { disposition: PdfArtifactDisposition },
): Promise<StoredPdfResult> {
  if (args.disposition.kind === 'form_response') {
    if (args.entityType !== 'form_response' || args.entityId !== args.disposition.responseId) {
      throw new Error('Durable PDF target does not match the rendered form response.')
    }
    return storeFormResponsePdfArtifact(args, args.disposition.responseId)
  }
  return storeTransientPdfArtifact(args)
}

async function storeFormResponsePdfArtifact(
  args: PdfArtifactInput,
  responseId: string,
): Promise<StoredPdfResult> {
  assertGeneratedPdf(args.pdf)

  const filename = `form-response-${responseId}.pdf`
  // Generated PDFs are immutable storage artifacts. Always stage the
  // replacement at a fresh key: overwriting the currently referenced key
  // before the response/parent locks are acquired would make a rolled-back
  // database transaction expose bytes that no longer match its metadata.
  const r2Key = newAttachmentKey({ tenantId: args.tenantId, kind: 'document', filename })
  const write = () =>
    putObject({
      key: r2Key,
      body: args.pdf,
      contentType: 'application/pdf',
      contentDisposition: 'inline',
    })
  const persist = () =>
    withTenant(db, args.tenantId, async (tx) => {
      const locked = await lockFormResponseForMutation(tx, args.tenantId, responseId)
      if (!locked) throw new Error(`Form response ${responseId} not found for durable PDF export.`)
      const previousAttachmentId = locked.pdfAttachmentId
      const [createdAttachment] = await tx
        .insert(attachments)
        .values({
          tenantId: args.tenantId,
          kind: 'document',
          r2Key,
          contentType: 'application/pdf',
          sizeBytes: args.pdf.length,
          filename,
        })
        .returning({ id: attachments.id })
      if (!createdAttachment) throw new Error('Form response PDF attachment was not created.')
      const attachmentId = createdAttachment.id

      const [updatedResponse] = await tx
        .update(formResponses)
        .set({ pdfAttachmentId: attachmentId })
        .where(
          and(
            eq(formResponses.id, responseId),
            eq(formResponses.tenantId, args.tenantId),
            isNull(formResponses.deletedAt),
          ),
        )
        .returning({ id: formResponses.id })
      if (!updatedResponse) throw new Error('Form response disappeared while its PDF was saving.')

      if (previousAttachmentId && previousAttachmentId !== attachmentId) {
        // form_responses.pdf_attachment_id is written only by this durable
        // artifact path, so the previous row is owned by this response. The
        // attachment deletion trigger records object removal in the durable
        // outbox in this same transaction.
        const [deletedAttachment] = await tx
          .delete(attachments)
          .where(
            and(
              eq(attachments.id, previousAttachmentId),
              eq(attachments.tenantId, args.tenantId),
              eq(attachments.kind, 'document'),
            ),
          )
          .returning({ id: attachments.id })
        if (!deletedAttachment) {
          throw new Error('The previous form response PDF attachment could not be retired.')
        }
      }

      await audit(tx, {
        tenantId: args.tenantId,
        entityType: args.entityType,
        entityId: responseId,
        action: 'export',
        summary: args.summary,
        metadata: {
          attachmentId,
          previousAttachmentId,
          r2Key,
          sizeBytes: args.pdf.length,
          transient: false,
        },
      })
      return attachmentId
    })

  const attachmentId = await commitExternalArtifact({
    write,
    persist,
    rollback: () => deleteObject({ key: r2Key }),
  })

  return {
    attachmentId,
    r2Key,
    sizeBytes: args.pdf.length,
    filename,
  }
}

async function storeTransientPdfArtifact(args: PdfArtifactInput): Promise<StoredPdfResult> {
  assertGeneratedPdf(args.pdf)

  await commitExternalArtifact({
    write: () =>
      putObject({
        key: args.r2Key,
        body: args.pdf,
        contentType: 'application/pdf',
        contentDisposition: 'inline',
        lifecycle: 'transient',
      }),
    persist: () =>
      withTenant(db, args.tenantId, async (tx) => {
        await audit(tx, {
          tenantId: args.tenantId,
          entityType: args.entityType,
          entityId: args.entityId,
          action: 'export',
          summary: args.summary,
          metadata: {
            attachmentId: null,
            r2Key: args.r2Key,
            sizeBytes: args.pdf.length,
            transient: true,
          },
        })
      }),
    rollback: () => deleteObject({ key: args.r2Key }),
  })

  return {
    attachmentId: null,
    r2Key: args.r2Key,
    sizeBytes: args.pdf.length,
    filename: args.filename,
  }
}

// --- document --------------------------------------------------------------

// --- document_book ---------------------------------------------------------
//
// Published books concatenate the exact immutable versions pinned when the
// book was published. Draft manager previews resolve each member's latest
// published version. Missing pins, versions, attachment metadata, or PDF bytes
// fail the render; a book must never silently omit part of its publication.

function escapeBookHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function renderDocumentBook(tenantId: string, bookId: string): Promise<StoredPdfResult> {
  const data = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ b: documentBooks, tenant: tenants })
      .from(documentBooks)
      .innerJoin(tenants, eq(tenants.id, documentBooks.tenantId))
      .where(
        and(
          eq(documentBooks.id, bookId),
          eq(documentBooks.tenantId, tenantId),
          eq(tenants.id, tenantId),
        ),
      )
      .limit(1)
    if (!row) return null
    if (row.b.status === 'published' && !row.b.publishedAt) {
      throw new Error('Published document book is missing its publication timestamp.')
    }

    const items = await tx
      .select({ item: documentBookItems, doc: documents })
      .from(documentBookItems)
      .innerJoin(
        documents,
        and(
          eq(documents.tenantId, documentBookItems.tenantId),
          eq(documents.id, documentBookItems.documentId),
        ),
      )
      .where(
        and(
          eq(documentBookItems.bookId, bookId),
          eq(documentBookItems.tenantId, tenantId),
          eq(documents.tenantId, tenantId),
        ),
      )
      .orderBy(asc(documentBookItems.position))
      .limit(MAX_DOCUMENT_BOOK_ITEMS + 1)
    if (items.length > MAX_DOCUMENT_BOOK_ITEMS) {
      throw new Error(`Document books may contain at most ${MAX_DOCUMENT_BOOK_ITEMS} documents.`)
    }

    const documentIds = items.map((item) => item.doc.id)
    const versions =
      documentIds.length === 0
        ? []
        : row.b.status === 'published'
          ? await (async () => {
              const pinnedIds = items.map(({ item, doc }) => {
                if (!item.documentVersionId) {
                  throw new Error(`Published book item ${doc.key} has no pinned document version.`)
                }
                return item.documentVersionId
              })
              return tx
                .select({
                  id: documentVersions.id,
                  documentId: documentVersions.documentId,
                  version: documentVersions.version,
                  pdfAttachmentId: documentVersions.pdfAttachmentId,
                  contentAttachmentId: documentVersions.contentAttachmentId,
                })
                .from(documentVersions)
                .where(
                  and(
                    eq(documentVersions.tenantId, tenantId),
                    inArray(documentVersions.id, pinnedIds),
                    isNotNull(documentVersions.publishedAt),
                  ),
                )
            })()
          : await tx
              .selectDistinctOn([documentVersions.documentId], {
                id: documentVersions.id,
                documentId: documentVersions.documentId,
                version: documentVersions.version,
                pdfAttachmentId: documentVersions.pdfAttachmentId,
                contentAttachmentId: documentVersions.contentAttachmentId,
              })
              .from(documentVersions)
              .where(
                and(
                  eq(documentVersions.tenantId, tenantId),
                  inArray(documentVersions.documentId, documentIds),
                  isNotNull(documentVersions.publishedAt),
                ),
              )
              .orderBy(asc(documentVersions.documentId), desc(documentVersions.version))
    const attachmentIds = [
      ...new Set(
        versions
          .map((version) => version.pdfAttachmentId ?? version.contentAttachmentId)
          .filter((id): id is string => id !== null),
      ),
    ]
    const attachmentRows =
      attachmentIds.length === 0
        ? []
        : await tx
            .select({
              id: attachments.id,
              key: attachments.r2Key,
              kind: attachments.kind,
              contentType: attachments.contentType,
              sizeBytes: attachments.sizeBytes,
            })
            .from(attachments)
            .where(and(eq(attachments.tenantId, tenantId), inArray(attachments.id, attachmentIds)))
    const resolvedItems = resolveDocumentBookItems({
      mode: row.b.status === 'published' ? 'published-render' : 'draft-render',
      items: items.map(({ item, doc }) => ({
        itemId: item.id,
        documentId: doc.id,
        documentTitle: doc.title,
        documentKey: doc.key,
        documentStatus: doc.status,
        documentDeletedAt: doc.deletedAt,
        pinnedVersionId: item.documentVersionId,
      })),
      versions,
      attachments: attachmentRows,
    })
    const entries = resolvedItems.map((item) => ({
      title: item.documentTitle,
      key: item.documentKey,
      version: item.version,
      pdfKey: item.attachmentKey,
      sizeBytes: item.sizeBytes,
    }))

    return { ...row, entries }
  })

  if (!data) {
    throw new Error(`Document book ${bookId} not found`)
  }

  const b = data.b
  const title = b.title
  const toc = data.entries
    .map((e, i) => {
      const label = `${i + 1}. ${escapeBookHtml(e.title)} — v${e.version}`
      return `<li style="margin:4px 0">${label} <span style="color:#64748b">${escapeBookHtml(e.key)}</span></li>`
    })
    .join('')
  const coverHtml = `
    <div style="font-family: Arial, Helvetica, sans-serif; padding-top: 96px;">
      <div style="color:#64748b; font-size:12px;">${escapeBookHtml(data.tenant.name)}</div>
      <h1 style="font-size:30px; margin:8px 0 4px 0;">${escapeBookHtml(title)}</h1>
      ${b.description ? `<p style="color:#334155">${escapeBookHtml(b.description)}</p>` : ''}
      <h2 style="font-size:14px; margin-top:48px; text-transform:uppercase; letter-spacing:0.05em; color:#334155;">Contents</h2>
      <ol style="list-style:none; padding:0; font-size:13px;">${toc}</ol>
    </div>`
  const coverPdf = await renderHtmlDocumentPdf({
    bodyHtml: coverHtml,
    paperSize: 'letter',
    orientation: 'portrait',
    marginMm: 18,
    headerHtml: null,
    footerHtml: null,
  })
  assertGeneratedPdf(coverPdf)

  const parts: Buffer[] = [coverPdf]
  let totalSourceBytes = coverPdf.length
  for (const e of data.entries) {
    const metadata = await headObject({ key: e.pdfKey })
    if (!metadata) throw new Error(`Published PDF object is missing for document ${e.key}.`)
    if (
      metadata.contentLength <= 0 ||
      metadata.contentLength !== e.sizeBytes ||
      metadata.contentLength > MAX_DOCUMENT_BOOK_SOURCE_BYTES ||
      totalSourceBytes + metadata.contentLength > MAX_DOCUMENT_BOOK_TOTAL_SOURCE_BYTES
    ) {
      throw new Error(`Published PDF for document ${e.key} exceeds the document-book size limit.`)
    }
    const bytes = await getObject({ key: e.pdfKey })
    if (
      bytes.length !== metadata.contentLength ||
      !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
    ) {
      throw new Error(`Published PDF for document ${e.key} is missing, truncated, or invalid.`)
    }
    totalSourceBytes += bytes.length
    parts.push(bytes)
  }
  const pdf = await pdfUnite(parts)

  const stamp = Date.now()
  const stored = await storeTransientPdfArtifact({
    tenantId,
    pdf,
    filename: `document-book-${bookId.slice(0, 8)}-${stamp}.pdf`,
    r2Key: newTenantObjectKey({
      tenantId,
      scope: '_transient/pdfs/document-books',
      filename: `${bookId}-${stamp}.pdf`,
    }),
    entityType: 'document_book',
    entityId: bookId,
    summary: 'Rendered document book PDF',
  })

  console.log(`[pdf] document_book ${bookId} rendered (${pdf.length} bytes)`)
  return stored
}
