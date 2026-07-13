// PDF worker.
//
// Consumes the `pdfs` BullMQ queue and renders all worker-rendered PDF kinds.
// On-demand route renders return transient object-store artifacts; the web
// route streams the bytes back and deletes the temporary object. Long-lived
// bundle/background outputs still persist attachment rows where the PDF is the
// durable artifact of record.

import type { Job } from 'bullmq'
import { asc, desc, eq } from 'drizzle-orm'
import { db, withTenant } from '@beaconhs/db'
import {
  attachments,
  documentBookItems,
  documentBooks,
  documentVersions,
  documents,
  people,
  tenants,
  trainingCertificates,
  trainingCourses,
  trainingRecords,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillCertificates,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import QRCode from 'qrcode'
import {
  renderCertificatePdf,
  renderHtmlDocumentPdf,
  renderRecordSummaryPdf,
} from '@beaconhs/forms-pdf'
import {
  enqueueEmail,
  type PdfEmailPayload,
  type PdfJobData,
  type RenderedPdfArtifact,
} from '@beaconhs/jobs'
import {
  deleteObject,
  getObject,
  newAttachmentKey,
  newTenantObjectKey,
  presignGet,
  putObject,
} from '@beaconhs/storage'
import { importSlidesFromPptx } from './slides-import'
import { renderDocumentMasterPdf, renderDocumentVersion } from './document-render'
import { pdfUnite } from '@beaconhs/office'
import { audit } from '@beaconhs/audit'
import { appBaseUrl } from '../lib/app-base-url'

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
    throw err
  }
}

async function dispatchPdf(data: PdfJobData): Promise<unknown> {
  switch (data.kind) {
    case 'certificate':
      return await renderCertificate(data.tenantId, data.certificateId)
    case 'skill_certificate':
      return await renderSkillCertificate(data.tenantId, data.skillCertificateId)
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
    case 'slides_import':
      return await importSlidesFromPptx(data)
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
  const bytes = await getObject({ key: artifact.r2Key })
  await enqueueEmail({
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    attachments: [
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
  return storeTransientPdfArtifact({
    tenantId: data.tenantId,
    pdf,
    filename,
    r2Key,
    entityType: data.entityType,
    entityId: data.subjectId,
    summary: `Rendered ${data.heading} PDF`,
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
  return storeTransientPdfArtifact({
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

// --- certificate ----------------------------------------------------------

// Verify-URL QR as a PNG data URL, embedded into both the certificate and
// the wallet card. margin:2 keeps a quiet zone even where the template lays
// the code straight onto the parchment background.
async function makeVerifyQr(verifyUrl: string): Promise<string> {
  return QRCode.toDataURL(verifyUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 8,
    color: { dark: '#0f172a', light: '#ffffff' },
  })
}

async function renderCertificate(tenantId: string, certificateId: string): Promise<void> {
  const result = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        cert: trainingCertificates,
        record: trainingRecords,
        person: people,
        course: trainingCourses,
        tenant: tenants,
      })
      .from(trainingCertificates)
      .innerJoin(trainingRecords, eq(trainingRecords.id, trainingCertificates.recordId))
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .innerJoin(tenants, eq(tenants.id, trainingCertificates.tenantId))
      .where(eq(trainingCertificates.id, certificateId))
      .limit(1)
    if (!row) return null
    // Resolve photo URL if any
    let photoUrl: string | null = null
    if (row.person.photoAttachmentId) {
      const [photoAtt] = await tx
        .select({ r2Key: attachments.r2Key })
        .from(attachments)
        .where(eq(attachments.id, row.person.photoAttachmentId))
        .limit(1)
      if (photoAtt) photoUrl = await presignGet({ key: photoAtt.r2Key, expiresInSeconds: 900 })
    }
    return { ...row, photoUrl }
  })

  if (!result) {
    console.warn(`[pdf] certificate ${certificateId} not found`)
    return
  }
  const { cert, record, person, course, tenant: t, photoUrl } = result

  // Public verify URL — encoded into the QR + printed in the footer text.
  const verifyUrl = `${appBaseUrl()}/verify/${cert.verifyToken}`
  const qrDataUrl = await makeVerifyQr(verifyUrl)

  const { certificate, wallet } = await renderCertificatePdf({
    tenantName: t.name,
    tenantLogoUrl: t.branding.logoUrl,
    primaryColor: t.branding.primaryColor,
    variant: 'completion',
    recipient: {
      fullName: `${person.firstName} ${person.lastName}`,
      employeeNo: person.employeeNo,
    },
    credential: { code: course.code, name: course.name },
    completedOn: record.completedOn,
    expiresOn: record.expiresOn,
    instructor: record.instructor,
    grade: record.grade,
    verifyUrl,
    verifyToken: cert.verifyToken,
    qrDataUrl,
    certificateId: cert.id,
    generatedAt: new Date(),
    wallet: {
      tenantName: t.name,
      tenantLogoUrl: t.branding.logoUrl,
      primaryColor: t.branding.primaryColor,
      variant: 'completion',
      recipient: {
        fullName: `${person.firstName} ${person.lastName}`,
        employeeNo: person.employeeNo,
        photoUrl,
      },
      credential: { code: course.code, name: course.name },
      completedOn: record.completedOn,
      expiresOn: record.expiresOn,
      verifyUrl,
      verifyToken: cert.verifyToken,
      qrDataUrl,
      cardId: cert.id,
    },
  })

  const stamp = Date.now()
  const certFilename = `certificate-${course.code}-${person.lastName}-${stamp}.pdf`
  const walletFilename = `wallet-${course.code}-${person.lastName}-${stamp}.pdf`
  const certKey = newAttachmentKey({ tenantId, kind: 'document', filename: certFilename })
  const walletKey = newAttachmentKey({ tenantId, kind: 'document', filename: walletFilename })

  await Promise.all([
    putObject({
      key: certKey,
      body: certificate,
      contentType: 'application/pdf',
      contentDisposition: 'inline',
    }),
    putObject({
      key: walletKey,
      body: wallet,
      contentType: 'application/pdf',
      contentDisposition: 'inline',
    }),
  ])

  await withTenant(db, tenantId, async (tx) => {
    const [certAtt] = await tx
      .insert(attachments)
      .values({
        tenantId,
        kind: 'document',
        r2Key: certKey,
        contentType: 'application/pdf',
        sizeBytes: certificate.length,
        filename: certFilename,
      })
      .returning()
    const [walletAtt] = await tx
      .insert(attachments)
      .values({
        tenantId,
        kind: 'document',
        r2Key: walletKey,
        contentType: 'application/pdf',
        sizeBytes: wallet.length,
        filename: walletFilename,
      })
      .returning()
    if (certAtt) {
      await tx
        .update(trainingCertificates)
        .set({ pdfAttachmentId: certAtt.id })
        .where(eq(trainingCertificates.id, certificateId))
    }
    await audit(tx, {
      tenantId,
      entityType: 'training_certificate',
      entityId: certificateId,
      action: 'export',
      summary: `Rendered certificate + wallet PDFs for ${person.firstName} ${person.lastName} / ${course.code}`,
      metadata: {
        certificateAttachmentId: certAtt?.id,
        walletAttachmentId: walletAtt?.id,
        certificateBytes: certificate.length,
        walletBytes: wallet.length,
      },
    })
  })

  console.log(
    `[pdf] certificate ${certificateId} rendered (cert ${certificate.length}B, wallet ${wallet.length}B)`,
  )
}

// --- skill certificate ------------------------------------------------------
//
// Same certificate + wallet pair as 'certificate', driven by a
// training_skill_certificates row → skill assignment → skill type →
// authority. Renders with variant 'qualification' so the templates swap the
// headline + phrasing and print the issuing authority.

async function renderSkillCertificate(tenantId: string, skillCertificateId: string): Promise<void> {
  const result = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        cert: trainingSkillCertificates,
        assignment: trainingSkillAssignments,
        skillType: trainingSkillTypes,
        authority: trainingSkillAuthorities,
        person: people,
        tenant: tenants,
      })
      .from(trainingSkillCertificates)
      .innerJoin(
        trainingSkillAssignments,
        eq(trainingSkillAssignments.id, trainingSkillCertificates.skillAssignmentId),
      )
      .innerJoin(
        trainingSkillTypes,
        eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId),
      )
      .innerJoin(
        trainingSkillAuthorities,
        eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
      )
      .innerJoin(people, eq(people.id, trainingSkillAssignments.personId))
      .innerJoin(tenants, eq(tenants.id, trainingSkillCertificates.tenantId))
      .where(eq(trainingSkillCertificates.id, skillCertificateId))
      .limit(1)
    if (!row) return null
    let photoUrl: string | null = null
    if (row.person.photoAttachmentId) {
      const [photoAtt] = await tx
        .select({ r2Key: attachments.r2Key })
        .from(attachments)
        .where(eq(attachments.id, row.person.photoAttachmentId))
        .limit(1)
      if (photoAtt) photoUrl = await presignGet({ key: photoAtt.r2Key, expiresInSeconds: 900 })
    }
    return { ...row, photoUrl }
  })

  if (!result) {
    console.warn(`[pdf] skill_certificate ${skillCertificateId} not found`)
    return
  }
  const { cert, assignment, skillType, authority, person, tenant: t, photoUrl } = result

  const verifyUrl = `${appBaseUrl()}/verify/${cert.verifyToken}`
  const qrDataUrl = await makeVerifyQr(verifyUrl)
  const fullName = `${person.firstName} ${person.lastName}`

  const { certificate, wallet } = await renderCertificatePdf({
    tenantName: t.name,
    tenantLogoUrl: t.branding.logoUrl,
    primaryColor: t.branding.primaryColor,
    variant: 'qualification',
    recipient: { fullName, employeeNo: person.employeeNo },
    credential: { code: skillType.code, name: skillType.name },
    authorityName: authority.name,
    completedOn: assignment.grantedOn,
    expiresOn: assignment.expiresOn,
    verifyUrl,
    verifyToken: cert.verifyToken,
    qrDataUrl,
    certificateId: cert.id,
    generatedAt: new Date(),
    wallet: {
      tenantName: t.name,
      tenantLogoUrl: t.branding.logoUrl,
      primaryColor: t.branding.primaryColor,
      variant: 'qualification',
      recipient: { fullName, employeeNo: person.employeeNo, photoUrl },
      credential: { code: skillType.code, name: skillType.name },
      authorityName: authority.name,
      completedOn: assignment.grantedOn,
      expiresOn: assignment.expiresOn,
      verifyUrl,
      verifyToken: cert.verifyToken,
      qrDataUrl,
      cardId: cert.id,
    },
  })

  const stamp = Date.now()
  const safeSkill = (skillType.code || skillType.name).replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 40)
  const certFilename = `skill-certificate-${safeSkill}-${person.lastName}-${stamp}.pdf`
  const walletFilename = `skill-wallet-${safeSkill}-${person.lastName}-${stamp}.pdf`
  const certKey = newAttachmentKey({ tenantId, kind: 'document', filename: certFilename })
  const walletKey = newAttachmentKey({ tenantId, kind: 'document', filename: walletFilename })

  await Promise.all([
    putObject({
      key: certKey,
      body: certificate,
      contentType: 'application/pdf',
      contentDisposition: 'inline',
    }),
    putObject({
      key: walletKey,
      body: wallet,
      contentType: 'application/pdf',
      contentDisposition: 'inline',
    }),
  ])

  await withTenant(db, tenantId, async (tx) => {
    const [certAtt] = await tx
      .insert(attachments)
      .values({
        tenantId,
        kind: 'document',
        r2Key: certKey,
        contentType: 'application/pdf',
        sizeBytes: certificate.length,
        filename: certFilename,
      })
      .returning()
    const [walletAtt] = await tx
      .insert(attachments)
      .values({
        tenantId,
        kind: 'document',
        r2Key: walletKey,
        contentType: 'application/pdf',
        sizeBytes: wallet.length,
        filename: walletFilename,
      })
      .returning()
    if (certAtt) {
      await tx
        .update(trainingSkillCertificates)
        .set({ pdfAttachmentId: certAtt.id })
        .where(eq(trainingSkillCertificates.id, skillCertificateId))
    }
    await audit(tx, {
      tenantId,
      entityType: 'training_skill_certificate',
      entityId: skillCertificateId,
      action: 'export',
      summary: `Rendered skill certificate + wallet PDFs for ${fullName} / ${skillType.name}`,
      metadata: {
        certificateAttachmentId: certAtt?.id,
        walletAttachmentId: walletAtt?.id,
        certificateBytes: certificate.length,
        walletBytes: wallet.length,
      },
    })
  })

  console.log(
    `[pdf] skill_certificate ${skillCertificateId} rendered (cert ${certificate.length}B, wallet ${wallet.length}B)`,
  )
}

// --- Shared helpers for on-demand PDF kinds --------------------------------
//
// On-demand PDFs are transient artifacts: the worker renders to object storage
// so the web route can stream the bytes back, then the route deletes the object.
// Do not create attachment rows for these renders; clicking "PDF" should not
// mutate domain file lists or create stale generated artifacts.

type StoredPdfResult = RenderedPdfArtifact

async function storeTransientPdfArtifact(args: {
  tenantId: string
  pdf: Buffer
  filename: string
  r2Key: string
  entityType: string
  entityId: string
  summary: string
}): Promise<StoredPdfResult> {
  await putObject({
    key: args.r2Key,
    body: args.pdf,
    contentType: 'application/pdf',
    contentDisposition: 'inline',
  })

  await withTenant(db, args.tenantId, async (tx) => {
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
// Books concatenate the members' published version PDFs (rendered from their
// DOCX snapshots) behind a generated cover + table of contents. File-only
// documents contribute their uploaded PDF; members without a published PDF are
// listed in the contents as unavailable rather than silently dropped.

function escapeBookHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function renderDocumentBook(tenantId: string, bookId: string): Promise<StoredPdfResult> {
  const data = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ b: documentBooks, tenant: tenants })
      .from(documentBooks)
      .innerJoin(tenants, eq(tenants.id, documentBooks.tenantId))
      .where(eq(documentBooks.id, bookId))
      .limit(1)
    if (!row) return null

    const items = await tx
      .select({ item: documentBookItems, doc: documents })
      .from(documentBookItems)
      .innerJoin(documents, eq(documents.id, documentBookItems.documentId))
      .where(eq(documentBookItems.bookId, bookId))
      .orderBy(asc(documentBookItems.position))

    const entries = await Promise.all(
      items.map(async (i) => {
        const [v] = await tx
          .select({
            version: documentVersions.version,
            pdfAttachmentId: documentVersions.pdfAttachmentId,
            contentAttachmentId: documentVersions.contentAttachmentId,
          })
          .from(documentVersions)
          .where(eq(documentVersions.documentId, i.doc.id))
          .orderBy(desc(documentVersions.version))
          .limit(1)
        let pdfKey: string | null = null
        const attachmentId = v?.pdfAttachmentId ?? v?.contentAttachmentId ?? null
        if (attachmentId) {
          const [att] = await tx
            .select({ key: attachments.r2Key, contentType: attachments.contentType })
            .from(attachments)
            .where(eq(attachments.id, attachmentId))
            .limit(1)
          if (att && (v?.pdfAttachmentId || att.contentType === 'application/pdf')) {
            pdfKey = att.key
          }
        }
        return { title: i.doc.title, key: i.doc.key, version: v?.version ?? null, pdfKey }
      }),
    )

    return { ...row, entries }
  })

  if (!data) {
    throw new Error(`Document book ${bookId} not found`)
  }

  const b = data.b
  const title = b.title
  const toc = data.entries
    .map((e, i) => {
      const label = `${i + 1}. ${escapeBookHtml(e.title)}${e.version ? ` — v${e.version}` : ''}`
      const note = e.pdfKey ? '' : ' <em>(no published PDF)</em>'
      return `<li style="margin:4px 0">${label} <span style="color:#64748b">${escapeBookHtml(e.key)}</span>${note}</li>`
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

  const parts: Buffer[] = [coverPdf]
  for (const e of data.entries) {
    if (e.pdfKey) parts.push(await getObject({ key: e.pdfKey }))
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
