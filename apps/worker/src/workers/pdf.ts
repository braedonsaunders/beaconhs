// PDF worker.
//
// Consumes the `pdfs` BullMQ queue and renders all worker-rendered PDF kinds.
// On-demand route renders return transient object-store artifacts; the web
// route streams the bytes back and deletes the temporary object. Long-lived
// bundle/background outputs still persist attachment rows where the PDF is the
// durable artifact of record.

import type { Job } from 'bullmq'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db, loadEntitiesForFormPickers, withTenant, type Database } from '@beaconhs/db'
import { entityDisplayName } from '@beaconhs/forms-core'
import {
  attachments,
  caCompleteSteps,
  caPhotos,
  correctiveActions,
  departments,
  documentBookItems,
  documentBooks,
  documentVersions,
  documents,
  equipmentItems,
  equipmentTypes,
  equipmentWorkOrders,
  formResponses,
  formTemplateVersions,
  formTemplates,
  hazidAssessmentHazards,
  hazidAssessmentPPE,
  hazidAssessmentPhotos,
  hazidAssessmentQuestions,
  hazidAssessmentSignatures,
  hazidAssessmentTasks,
  hazidAssessmentTypes,
  hazidAssessments,
  hazidHazards,
  hazidSignedReports,
  hazidTasks,
  incidentAttachments,
  incidentInjuries,
  incidentLostTimeEvents,
  incidentPeople,
  incidents,
  orgUnits,
  people,
  ppeIssueReports,
  ppeItems,
  ppeTypes,
  tenants,
  tenantUsers,
  trainingCertificates,
  trainingCourses,
  trainingRecords,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillCertificates,
  trainingSkillTypes,
  user,
} from '@beaconhs/db/schema'
import QRCode from 'qrcode'
import {
  renderCaPdf,
  renderCertificatePdf,
  renderEquipmentWorkOrderPdf,
  renderFormPdf,
  renderHazidPdf,
  renderHazidSignedReportPdf,
  renderHtmlDocumentPdf,
  renderIncidentPdf,
  renderPpeIssuePdf,
  renderRecordSummaryPdf,
  type HazidRenderInput,
} from '@beaconhs/forms-pdf'
import {
  enqueueEmail,
  type PdfEmailPayload,
  type PdfJobData,
  type RenderedPdfArtifact,
} from '@beaconhs/jobs'
import { deleteObject, getObject, presignGet, publicUrl, putObject } from '@beaconhs/storage'
import { importSlidesFromPptx } from './slides-import'
import { renderDocumentVersion } from './document-render'
import { pdfUnite } from '../lib/office'
import { audit } from '@beaconhs/audit'
import { appBaseUrl } from '../lib/app-base-url'
import { escapeHtml } from '../lib/escape-html'

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
    case 'form_response':
      return await renderFormResponse(data.tenantId, data.responseId)
    case 'incident':
      return await renderIncident(data.tenantId, data.incidentId)
    case 'certificate':
      return await renderCertificate(data.tenantId, data.certificateId)
    case 'skill_certificate':
      return await renderSkillCertificate(data.tenantId, data.skillCertificateId)
    case 'hazid':
      return await renderHazid(data.tenantId, data.assessmentId)
    case 'ca':
      return await renderCa(data.tenantId, data.caId)
    case 'record_summary':
      return await renderRecordSummary(data)
    case 'template_pdf':
      return await renderTemplatePdf(data)
    case 'document_version_render':
      return await renderDocumentVersion(data)
    case 'document_book':
      return await renderDocumentBook(data.tenantId, data.bookId)
    case 'equipment_workorder':
      return await renderEquipmentWorkOrder(data.tenantId, data.workOrderId)
    case 'ppe_issue':
      return await renderPpeIssue(data.tenantId, data.issueReportId)
    case 'hazid_signed_report':
      return await renderHazidSignedReport(data.tenantId, data.reportId)
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
  })
  const stamp = Date.now()
  const ref = data.reference || data.subjectId.slice(0, 8)
  const filename = data.filename || `${data.entityType}-${ref}-${stamp}.pdf`
  const r2Key = `tmp/pdfs/record-summary/${data.tenantId}/${data.subjectId}-${stamp}.pdf`
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
    r2Key: `tmp/pdfs/template/${data.tenantId}/${entityId}-${stamp}.pdf`,
    entityType,
    entityId,
    summary: 'Rendered PDF document template',
  })
}

// --- form_response --------------------------------------------------------

async function renderFormResponse(tenantId: string, responseId: string): Promise<StoredPdfResult> {
  const result = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        response: formResponses,
        template: formTemplates,
        version: formTemplateVersions,
        site: orgUnits,
        tenant: tenants,
      })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .innerJoin(formTemplateVersions, eq(formTemplateVersions.id, formResponses.templateVersionId))
      .leftJoin(orgUnits, eq(orgUnits.id, formResponses.siteOrgUnitId))
      .innerJoin(tenants, eq(tenants.id, formResponses.tenantId))
      .where(eq(formResponses.id, responseId))
      .limit(1)
    return row
  })

  if (!result) {
    throw new Error(`Form response ${responseId} not found`)
  }

  const title =
    typeof result.version.schema.title === 'object'
      ? (result.version.schema.title.en ?? result.template.name)
      : result.template.name

  // Resolve any picker-bound entity attributes BEFORE the render call so
  // `entity_attr` formula fields in the PDF show the same live values the
  // filler did. RLS-scoped via withTenant.
  const entitiesByField = await withTenant(db, tenantId, async (tx) =>
    loadEntitiesForFormPickers(tx, result.version.schema, result.response.data),
  )

  // Collapse the attr maps to a `{ fieldId: displayName }` lookup so picker
  // fields themselves print the entity's name (e.g. the Lift Plan "Job
  // Number" shows the project name) instead of the stored id.
  const pickerLabelsByField: Record<string, string> = {}
  for (const [fieldId, attrs] of Object.entries(entitiesByField)) {
    const name = entityDisplayName(attrs)
    if (name) pickerLabelsByField[fieldId] = name
  }

  const pdf = await renderFormPdf({
    schema: result.version.schema,
    values: result.response.data,
    entitiesByField,
    pickerLabelsByField,
    metadata: {
      title,
      reference: result.response.id.slice(0, 8),
      // Timestamps store UTC; label the zone so the document of record is
      // unambiguous for field users in other timezones.
      submittedAt: result.response.submittedAt
        ? `${result.response.submittedAt.toISOString().slice(0, 19).replace('T', ' ')} UTC`
        : undefined,
      siteName: result.site?.name,
      tenantName: result.tenant.name,
      tenantLogoUrl: result.tenant.branding.logoUrl,
      primaryColor: result.tenant.branding.primaryColor,
    },
    customCss: result.version.schema.pdf?.css,
    customHeaderHtml: result.version.schema.pdf?.header,
    customFooterHtml: result.version.schema.pdf?.footer,
    pageSize: result.version.schema.pdf?.pageSize ?? 'Letter',
  })

  const stamp = Date.now()
  const filename = `form-${responseId.slice(0, 8)}-${stamp}.pdf`
  const r2Key = `tmp/pdfs/form-responses/${tenantId}/${responseId}-${stamp}.pdf`
  const stored = await storeTransientPdfArtifact({
    tenantId,
    pdf,
    filename,
    r2Key,
    entityType: 'form_response',
    entityId: responseId,
    summary: 'Rendered form response PDF',
  })

  console.log(`[pdf] form_response ${responseId} rendered (${pdf.length} bytes) → ${r2Key}`)
  return stored
}

// --- incident -------------------------------------------------------------

async function renderIncident(tenantId: string, incidentId: string): Promise<StoredPdfResult> {
  const result = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        incident: incidents,
        site: orgUnits,
        department: departments,
        supervisor: people,
        tenant: tenants,
      })
      .from(incidents)
      .leftJoin(orgUnits, eq(orgUnits.id, incidents.siteOrgUnitId))
      .leftJoin(departments, eq(departments.id, incidents.departmentId))
      .leftJoin(people, eq(people.id, incidents.supervisorPersonId))
      .innerJoin(tenants, eq(tenants.id, incidents.tenantId))
      .where(eq(incidents.id, incidentId))
      .limit(1)
    if (!row) return null

    const injuries = await tx
      .select({ injury: incidentInjuries, person: people })
      .from(incidentInjuries)
      .leftJoin(people, eq(people.id, incidentInjuries.personId))
      .where(eq(incidentInjuries.incidentId, incidentId))

    const lostTime = await tx
      .select()
      .from(incidentLostTimeEvents)
      .where(eq(incidentLostTimeEvents.incidentId, incidentId))
      .orderBy(asc(incidentLostTimeEvents.validFrom))

    const involved = await tx
      .select({ link: incidentPeople, person: people })
      .from(incidentPeople)
      .leftJoin(people, eq(people.id, incidentPeople.personId))
      .where(eq(incidentPeople.incidentId, incidentId))

    const photos = await tx
      .select({ link: incidentAttachments, att: attachments })
      .from(incidentAttachments)
      .innerJoin(attachments, eq(attachments.id, incidentAttachments.attachmentId))
      .where(eq(incidentAttachments.incidentId, incidentId))

    return { ...row, injuries, lostTime, involved, photos }
  })

  if (!result) {
    throw new Error(`Incident ${incidentId} not found`)
  }
  const i = result.incident
  const t = result.tenant

  const pdf = await renderIncidentPdf({
    tenantName: t.name,
    tenantLogoUrl: t.branding.logoUrl,
    primaryColor: t.branding.primaryColor,
    incident: {
      reference: i.reference,
      title: i.title,
      description: i.description,
      type: i.type,
      severity: i.severity,
      status: i.status,
      occurredAt: i.occurredAt,
      reportedAt: i.reportedAt,
      closedAt: i.closedAt,
      siteName: result.site?.name ?? null,
      location: i.location,
      departmentName: result.department?.name ?? null,
      weather: i.weather,
      classification: i.classification ?? {},
      supervisorName: result.supervisor
        ? `${result.supervisor.firstName} ${result.supervisor.lastName}`
        : null,
      foremanText: i.foremanText,
      externalPeopleInvolved: i.externalPeopleInvolved,
      witnesses: i.witnesses,
      eventsLeadingUp: i.eventsLeadingUp,
      immediateActionTaken: i.immediateActionTaken,
      ppeWorn: i.ppeWorn,
      criticalInjury: i.criticalInjury,
      ministryOfLabourNotified: i.ministryOfLabourNotified,
      emsNotified: i.emsNotified,
      firstAidReceived: i.firstAidReceived,
      firstAidProvider: i.firstAidProvider,
      medicalAttentionReceived: i.medicalAttentionReceived,
      treatedAtHospital: i.treatedAtHospital,
      treatedInCity: i.treatedInCity,
      transportation: i.transportation,
      lostTime: i.lostTime,
      lostTimeFirstDay: i.lostTimeFirstDay,
      lostTimeLastDay: i.lostTimeLastDay,
      lostTimeDays: i.lostTimeDays,
      modifiedDuty: i.modifiedDuty,
      modifiedDutyFirstDay: i.modifiedDutyFirstDay,
      modifiedDutyLastDay: i.modifiedDutyLastDay,
      modifiedDutyDays: i.modifiedDutyDays,
      externallyReportable: i.externallyReportable,
      actualSeverity: i.actualSeverity,
      potentialSeverity: i.potentialSeverity,
      rootCause: i.rootCause,
      contributingFactors: i.contributingFactors ?? [],
    },
    involved: result.involved.map((row) => ({
      name: row.person
        ? `${row.person.firstName} ${row.person.lastName}`
        : (row.link.personNameText ?? 'Unknown'),
      role: row.link.role,
    })),
    injuries: result.injuries.map((row) => ({
      personName: row.person
        ? `${row.person.firstName} ${row.person.lastName}`
        : (row.injury.personName ?? 'Unknown'),
      bodyParts: row.injury.bodyParts ?? [],
      injuryTypes: row.injury.injuryTypes ?? [],
      treatment: row.injury.treatment,
      treatedAtFacility: row.injury.treatedAtFacility,
      workedHoursPriorTo: row.injury.workedHoursPriorTo,
    })),
    lostTimeEvents: result.lostTime.map((e) => ({
      status: e.status,
      validFrom: e.validFrom,
      validTo: e.validTo,
      notes: e.notes,
    })),
    photos: result.photos.map((p) => ({
      url: publicUrl(p.att.r2Key),
      caption: p.link.caption,
    })),
    generatedAt: new Date(),
  })

  const stamp = Date.now()
  const filename = `incident-${i.reference || incidentId.slice(0, 8)}-${stamp}.pdf`
  const r2Key = `tmp/pdfs/incidents/${tenantId}/${incidentId}-${stamp}.pdf`
  const stored = await storeTransientPdfArtifact({
    tenantId,
    pdf,
    filename,
    r2Key,
    entityType: 'incident',
    entityId: incidentId,
    summary: 'Rendered incident PDF',
  })

  console.log(`[pdf] incident ${incidentId} rendered (${pdf.length} bytes) → ${r2Key}`)
  return stored
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
      if (photoAtt) photoUrl = publicUrl(photoAtt.r2Key)
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
  const certKey = `pdfs/certificates/${certificateId}-cert-${stamp}.pdf`
  const walletKey = `pdfs/certificates/${certificateId}-wallet-${stamp}.pdf`

  await Promise.all([
    putObject({ key: certKey, body: certificate, contentType: 'application/pdf' }),
    putObject({ key: walletKey, body: wallet, contentType: 'application/pdf' }),
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
        certificateUrl: publicUrl(certKey),
        walletUrl: publicUrl(walletKey),
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
      if (photoAtt) photoUrl = publicUrl(photoAtt.r2Key)
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
  const certKey = `pdfs/skill-certificates/${skillCertificateId}-cert-${stamp}.pdf`
  const walletKey = `pdfs/skill-certificates/${skillCertificateId}-wallet-${stamp}.pdf`

  await Promise.all([
    putObject({ key: certKey, body: certificate, contentType: 'application/pdf' }),
    putObject({ key: walletKey, body: wallet, contentType: 'application/pdf' }),
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
        certificateUrl: publicUrl(certKey),
        walletUrl: publicUrl(walletKey),
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
  await putObject({ key: args.r2Key, body: args.pdf, contentType: 'application/pdf' })

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
        url: publicUrl(args.r2Key),
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

function personName(p: { firstName: string; lastName: string } | null | undefined): string | null {
  if (!p) return null
  return `${p.firstName} ${p.lastName}`
}

function memberDisplayName(args: {
  member?: { displayName: string | null } | null
  user?: { name: string | null } | null
}): string | null {
  return args.user?.name ?? args.member?.displayName ?? null
}

// --- hazid -----------------------------------------------------------------

// Shape returned from the per-assessment loader. Holds the tenant + the joined
// project/site/supervisor metadata as well as every child sub-table needed to
// render the HazID template. The signed-report bundler re-uses this loader so
// the per-assessment output inside a bundle matches the standalone PDF exactly.
type HazidLoadedAssessment = {
  a: typeof hazidAssessments.$inferSelect
  type: typeof hazidAssessmentTypes.$inferSelect | null
  site: typeof orgUnits.$inferSelect | null
  supervisor: typeof people.$inferSelect | null
  tenant: typeof tenants.$inferSelect
  projectName: string | null
  tasks: {
    row: typeof hazidAssessmentTasks.$inferSelect
    task: typeof hazidTasks.$inferSelect | null
  }[]
  taskHazards: { id: string; name: string }[]
  hazards: {
    row: typeof hazidAssessmentHazards.$inferSelect
    library: typeof hazidHazards.$inferSelect | null
  }[]
  ppe: (typeof hazidAssessmentPPE.$inferSelect)[]
  questions: (typeof hazidAssessmentQuestions.$inferSelect)[]
  signatures: {
    row: typeof hazidAssessmentSignatures.$inferSelect
    person: typeof people.$inferSelect | null
  }[]
  photos: {
    link: typeof hazidAssessmentPhotos.$inferSelect
    att: typeof attachments.$inferSelect
  }[]
}

// Loads everything needed to render a single HazID assessment as a PDF, using
// the supplied transaction (already RLS-scoped via withTenant). Returns null
// when the assessment row is missing.
async function loadHazidAssessment(
  tx: Database,
  assessmentId: string,
): Promise<HazidLoadedAssessment | null> {
  const [row] = await tx
    .select({
      a: hazidAssessments,
      type: hazidAssessmentTypes,
      site: orgUnits,
      supervisor: people,
      tenant: tenants,
    })
    .from(hazidAssessments)
    .leftJoin(hazidAssessmentTypes, eq(hazidAssessmentTypes.id, hazidAssessments.assessmentTypeId))
    .leftJoin(orgUnits, eq(orgUnits.id, hazidAssessments.siteOrgUnitId))
    .leftJoin(people, eq(people.id, hazidAssessments.supervisorPersonId))
    .innerJoin(tenants, eq(tenants.id, hazidAssessments.tenantId))
    .where(eq(hazidAssessments.id, assessmentId))
    .limit(1)
  if (!row) return null

  let projectName: string | null = null
  if (row.a.projectOrgUnitId) {
    const [proj] = await tx
      .select({ name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.id, row.a.projectOrgUnitId))
      .limit(1)
    projectName = proj?.name ?? null
  }

  const tasks = await tx
    .select({ row: hazidAssessmentTasks, task: hazidTasks })
    .from(hazidAssessmentTasks)
    .leftJoin(hazidTasks, eq(hazidTasks.id, hazidAssessmentTasks.taskId))
    .where(eq(hazidAssessmentTasks.assessmentId, assessmentId))
    .orderBy(asc(hazidAssessmentTasks.entityOrder))

  const hazards = await tx
    .select({ row: hazidAssessmentHazards, library: hazidHazards })
    .from(hazidAssessmentHazards)
    .leftJoin(hazidHazards, eq(hazidHazards.id, hazidAssessmentHazards.hazardId))
    .where(eq(hazidAssessmentHazards.assessmentId, assessmentId))
    .orderBy(asc(hazidAssessmentHazards.entityOrder))

  const taskHazardIds = [...new Set(tasks.flatMap((t) => t.row.hazardIds))]
  const taskHazards =
    taskHazardIds.length > 0
      ? await tx
          .select({ id: hazidHazards.id, name: hazidHazards.name })
          .from(hazidHazards)
          .where(inArray(hazidHazards.id, taskHazardIds))
      : []

  const ppe = await tx
    .select()
    .from(hazidAssessmentPPE)
    .where(eq(hazidAssessmentPPE.assessmentId, assessmentId))
    .orderBy(asc(hazidAssessmentPPE.entityOrder))

  const questions = await tx
    .select()
    .from(hazidAssessmentQuestions)
    .where(eq(hazidAssessmentQuestions.assessmentId, assessmentId))
    .orderBy(asc(hazidAssessmentQuestions.entityOrder))

  const signatures = await tx
    .select({ row: hazidAssessmentSignatures, person: people })
    .from(hazidAssessmentSignatures)
    .leftJoin(people, eq(people.id, hazidAssessmentSignatures.personId))
    .where(eq(hazidAssessmentSignatures.assessmentId, assessmentId))

  const photos = await tx
    .select({ link: hazidAssessmentPhotos, att: attachments })
    .from(hazidAssessmentPhotos)
    .innerJoin(attachments, eq(attachments.id, hazidAssessmentPhotos.attachmentId))
    .where(eq(hazidAssessmentPhotos.assessmentId, assessmentId))

  return {
    ...row,
    projectName,
    tasks,
    taskHazards,
    hazards,
    ppe,
    questions,
    signatures,
    photos,
  }
}

// Convert the joined db rows into the HazidRenderInput shape consumed by
// renderHazidPdf / renderHazidSignedReportPdf. Pure / no IO.
function toHazidRenderInput(data: HazidLoadedAssessment): HazidRenderInput {
  const a = data.a
  const t = data.tenant
  const style = data.type?.style ?? 'task_based'
  const taskHazardLookup = new Map(data.taskHazards.map((h) => [h.id, h.name]))
  return {
    tenantName: t.name,
    tenantLogoUrl: t.branding.logoUrl,
    primaryColor: t.branding.primaryColor,
    sections: {
      jobScope: style === 'hazard_based',
      ppe: data.type?.hasPPE ?? true,
      questions: data.type?.hasQuestions ?? true,
      tasks: style === 'task_based',
      hazards: style === 'hazard_based',
    },
    assessment: {
      reference: a.reference,
      occurredAt: a.occurredAt,
      locked: a.locked,
      lockedAt: a.lockedAt,
      siteName: data.site?.name ?? null,
      locationOnSite: a.locationOnSite,
      projectName: data.projectName,
      typeName: data.type?.name ?? null,
      supervisorName: personName(data.supervisor),
      jobScope: a.jobScope,
    },
    ppe: data.ppe.map((p) => ({
      name: p.name,
      description: p.description,
      required: p.required,
      answer: p.answer,
    })),
    questions: data.questions.map((q) => ({
      question: q.question,
      answer: q.answer,
      requiresYes: q.requiresYes,
    })),
    tasks: data.tasks.map((t) => ({
      name: t.task?.name ?? t.row.description ?? 'Task',
      hazardNames: t.row.hazardIds
        .map((id) => taskHazardLookup.get(id))
        .filter((name): name is string => Boolean(name)),
      controls: t.row.controls,
    })),
    hazards: data.hazards.map((h) => ({
      name: h.library?.name ?? h.row.name ?? 'Hazard',
      standardControls: h.row.standardControls,
      specificControls: h.row.specificControls,
      applicable: h.row.applicable,
    })),
    signatures: data.signatures.map((s) => ({
      name: s.person ? personName(s.person)! : (s.row.externalName ?? 'Unknown'),
      signatureType: s.row.signatureType,
      csEntrant: s.row.csEntrant,
      csAttendant: s.row.csAttendant,
      csRescue: s.row.csRescue,
      signatureDataUrl: s.row.signatureDataUrl,
      signedAt: s.row.signedAt,
    })),
    photos: data.photos.map((p) => ({
      url: publicUrl(p.att.r2Key),
      caption: p.link.caption,
    })),
    generatedAt: new Date(),
  }
}

async function renderHazid(tenantId: string, assessmentId: string): Promise<StoredPdfResult> {
  const data = await withTenant(db, tenantId, async (tx) => loadHazidAssessment(tx, assessmentId))

  if (!data) {
    throw new Error(`HazID assessment ${assessmentId} not found`)
  }

  const a = data.a
  const pdf = await renderHazidPdf(toHazidRenderInput(data))

  const stamp = Date.now()
  const stored = await storeTransientPdfArtifact({
    tenantId,
    pdf,
    filename: `hazid-${a.reference || assessmentId.slice(0, 8)}-${stamp}.pdf`,
    r2Key: `tmp/pdfs/hazid/${tenantId}/${assessmentId}-${stamp}.pdf`,
    entityType: 'hazid_assessment',
    entityId: assessmentId,
    summary: 'Rendered HazID assessment PDF',
  })

  console.log(`[pdf] hazid ${assessmentId} rendered (${pdf.length} bytes)`)
  return stored
}

// --- hazid signed-report bundle -------------------------------------------
//
// Bundle N hazid assessments into a single PDF with a cover page. The flow:
//
//   1. Load the hazid_signed_reports row + its assessmentIds[]
//   2. Flip status pending → rendering so the detail page shows progress
//   3. Load each per-assessment payload via the shared loader
//   4. Render the cover + each assessment as a single big HTML doc
//   5. Upload, insert attachments row, link via pdfAttachmentId
//   6. Flip status rendering → completed (or failed on error)
//   7. If recipientEmails is non-empty, enqueue an email with a signed link
//   8. Audit-log with entityType='hazid_signed_report', action='export'
//
// Errors are caught and recorded as status='failed' + errorMessage. We then
// re-throw so BullMQ can apply its retry/backoff policy: the retry will see
// status='failed' and is free to flip back to 'rendering' on the next attempt.

async function renderHazidSignedReport(tenantId: string, reportId: string): Promise<void> {
  // 1+2. Load the report row and flip to 'rendering' in one round trip. We
  // do this BEFORE the heavy loaders so the UI shows progress immediately.
  const reportRow = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(hazidSignedReports)
      .where(eq(hazidSignedReports.id, reportId))
      .limit(1)
    if (!row) return null
    if (row.status !== 'completed') {
      await tx
        .update(hazidSignedReports)
        .set({ status: 'rendering', errorMessage: null })
        .where(eq(hazidSignedReports.id, reportId))
    }
    return row
  })

  if (!reportRow) {
    console.warn(`[pdf] hazid_signed_report ${reportId} not found`)
    return
  }

  if (reportRow.status === 'completed' && reportRow.pdfAttachmentId) {
    // Idempotent: a successful render already exists. Nothing to do.
    console.log(`[pdf] hazid_signed_report ${reportId} already completed, skipping`)
    return
  }

  const assessmentIds = reportRow.assessmentIds
  if (assessmentIds.length === 0) {
    await markReportFailed(tenantId, reportId, 'No assessments selected')
    throw new Error(`Signed-report ${reportId} has no assessments`)
  }

  try {
    // 3. Load tenant + each assessment payload. We also resolve the builder's
    // display name from tenantUsers + user for the cover page.
    const loaded = await withTenant(db, tenantId, async (tx) => {
      const [tenantRow] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
      if (!tenantRow) return null

      let builtByName: string | null = null
      if (reportRow.builtByTenantUserId) {
        const [u] = await tx
          .select({ member: tenantUsers, u: user })
          .from(tenantUsers)
          .leftJoin(user, eq(user.id, tenantUsers.userId))
          .where(eq(tenantUsers.id, reportRow.builtByTenantUserId))
          .limit(1)
        builtByName = u ? memberDisplayName({ member: u.member, user: u.u }) : null
      }

      // Load every requested assessment. Skip silently-missing ones (they
      // may have been soft-deleted between build and render). We still error
      // out hard if EVERY assessment is missing, since the bundle would be
      // empty.
      const assessments: HazidLoadedAssessment[] = []
      for (const aid of assessmentIds) {
        const a = await loadHazidAssessment(tx, aid)
        if (a) assessments.push(a)
      }
      return { tenant: tenantRow, builtByName, assessments }
    })

    if (!loaded) {
      await markReportFailed(tenantId, reportId, 'Tenant row missing')
      throw new Error(`Tenant ${tenantId} not found while rendering signed-report`)
    }

    if (loaded.assessments.length === 0) {
      await markReportFailed(tenantId, reportId, 'All selected assessments are missing or deleted')
      throw new Error(`Signed-report ${reportId} resolved to zero assessments`)
    }

    const t = loaded.tenant

    // 4. Render the big HTML document → one PDF.
    const pdf = await renderHazidSignedReportPdf({
      tenantName: t.name,
      tenantLogoUrl: t.branding.logoUrl,
      primaryColor: t.branding.primaryColor,
      report: {
        title: reportRow.title,
        description: reportRow.description,
        builtAt: reportRow.builtAt ?? reportRow.createdAt,
        builtByName: loaded.builtByName,
        assessmentCount: loaded.assessments.length,
      },
      assessments: loaded.assessments.map(toHazidRenderInput),
      generatedAt: new Date(),
    })

    // 5. Upload + record attachment + link onto the report row.
    const stamp = Date.now()
    const safeTitle = reportRow.title.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 60) || 'bundle'
    const filename = `hazid-signed-${safeTitle}-${stamp}.pdf`
    const r2Key = `pdfs/hazid-signed/${reportId}-${stamp}.pdf`
    await putObject({ key: r2Key, body: pdf, contentType: 'application/pdf' })

    const completedAt = new Date()
    await withTenant(db, tenantId, async (tx) => {
      const [att] = await tx
        .insert(attachments)
        .values({
          tenantId,
          kind: 'document',
          r2Key,
          contentType: 'application/pdf',
          sizeBytes: pdf.length,
          filename,
        })
        .returning()
      if (!att) throw new Error('Failed to insert attachment row for signed-report bundle')

      // 6. Flip rendering → completed and link the PDF.
      await tx
        .update(hazidSignedReports)
        .set({
          status: 'completed',
          pdfAttachmentId: att.id,
          completedAt,
          builtAt: reportRow.builtAt ?? completedAt,
          errorMessage: null,
        })
        .where(eq(hazidSignedReports.id, reportId))

      // 8. Audit-log the export.
      await audit(tx, {
        tenantId,
        entityType: 'hazid_signed_report',
        entityId: reportId,
        action: 'export',
        summary: `Rendered signed-report bundle "${reportRow.title}" (${loaded.assessments.length} assessments)`,
        metadata: {
          attachmentId: att.id,
          r2Key,
          sizeBytes: pdf.length,
          url: publicUrl(r2Key),
          assessmentIds: loaded.assessments.map((a) => a.a.id),
        },
      })
    })

    console.log(`[pdf] hazid_signed_report ${reportId} rendered (${pdf.length} bytes) → ${r2Key}`)

    // 7. If the builder captured recipients, send them an email with a signed
    // link to the freshly-rendered PDF. We enqueue rather than send inline so
    // the email_log fan-out + retry logic kicks in.
    if (reportRow.recipientEmails.length > 0) {
      await sendSignedReportEmail({
        tenantId,
        reportId,
        title: reportRow.title,
        description: reportRow.description,
        recipients: reportRow.recipientEmails,
        attachmentR2Key: r2Key,
        tenantName: t.name,
        assessmentCount: loaded.assessments.length,
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[pdf] hazid_signed_report ${reportId} render failed:`, err)
    await markReportFailed(tenantId, reportId, msg)
    throw err
  }
}

// Stamp status='failed' + the error message so the detail page can surface
// what went wrong. Audit-log the failure too.
async function markReportFailed(
  tenantId: string,
  reportId: string,
  message: string,
): Promise<void> {
  try {
    await withTenant(db, tenantId, async (tx) => {
      await tx
        .update(hazidSignedReports)
        .set({
          status: 'failed',
          errorMessage: message.slice(0, 1000),
          completedAt: new Date(),
        })
        .where(eq(hazidSignedReports.id, reportId))
      await audit(tx, {
        tenantId,
        entityType: 'hazid_signed_report',
        entityId: reportId,
        action: 'update',
        summary: `Signed-report render failed: ${message.slice(0, 200)}`,
        metadata: { error: message.slice(0, 1000) },
      })
    })
  } catch (writeErr) {
    // Don't let bookkeeping errors hide the original failure.
    console.error(`[pdf] failed to mark signed-report ${reportId} as failed:`, writeErr)
  }
}

// Compose + enqueue the recipient email for a freshly-rendered signed-report
// bundle. The body contains a signed (presigned) link valid for 7 days; we
// keep the rest of the message intentionally minimal — the PDF is the artifact
// of record.
async function sendSignedReportEmail(args: {
  tenantId: string
  reportId: string
  title: string
  description: string | null
  recipients: string[]
  attachmentR2Key: string
  tenantName: string
  assessmentCount: number
}): Promise<void> {
  const signedUrl = await presignGet({
    key: args.attachmentR2Key,
    expiresInSeconds: 7 * 24 * 3600,
  })
  const recipients = args.recipients.filter((s) => /@/.test(s))
  if (recipients.length === 0) return

  const subject = `Signed-report bundle: ${args.title}`
  const text = [
    `${args.tenantName}`,
    ``,
    `A signed-report bundle has been prepared for your review.`,
    ``,
    `Title: ${args.title}`,
    `Assessments included: ${args.assessmentCount}`,
    args.description ? `\nDescription:\n${args.description}` : '',
    ``,
    `Download the PDF (link valid for 7 days):`,
    signedUrl,
  ]
    .filter((s) => s !== '')
    .join('\n')

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:720px;">
      <h2 style="margin:0 0 4px;font-size:18px;">${escapeHtml(args.title)}</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:12px;">
        ${escapeHtml(args.tenantName)} · Signed-report bundle ·
        ${args.assessmentCount} assessment${args.assessmentCount === 1 ? '' : 's'}
      </div>
      ${
        args.description
          ? `<div style="border-left:3px solid #0f766e;padding:8px 12px;background:#ecfdf5;margin-bottom:12px;font-size:13px;white-space:pre-wrap;">${escapeHtml(args.description)}</div>`
          : ''
      }
      <p style="font-size:13px;">A signed-report bundle has been prepared for your review.</p>
      <p style="font-size:13px;margin-top:18px;">
        <a href="${escapeHtml(signedUrl)}"
           style="display:inline-block;padding:10px 16px;background:#0f766e;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
          Download PDF
        </a>
      </p>
      <p style="font-size:11px;color:#94a3b8;margin-top:18px;">
        This link is valid for 7 days. After it expires, ask the bundle owner to re-send.
      </p>
    </div>
  `

  await enqueueEmail({
    to: recipients,
    subject,
    html,
    text,
    meta: {
      tenantId: args.tenantId,
      category: 'hazid_signed_report',
    },
  })
}

// --- ca --------------------------------------------------------------------

async function renderCa(tenantId: string, caId: string): Promise<StoredPdfResult> {
  const data = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        c: correctiveActions,
        site: orgUnits,
        ownerMember: tenantUsers,
        ownerUser: user,
        tenant: tenants,
      })
      .from(correctiveActions)
      .leftJoin(orgUnits, eq(orgUnits.id, correctiveActions.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, correctiveActions.ownerTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .innerJoin(tenants, eq(tenants.id, correctiveActions.tenantId))
      .where(eq(correctiveActions.id, caId))
      .limit(1)
    if (!row) return null

    let assignedByName: string | null = null
    if (row.c.assignedByTenantUserId) {
      const [a] = await tx
        .select({ member: tenantUsers, u: user })
        .from(tenantUsers)
        .leftJoin(user, eq(user.id, tenantUsers.userId))
        .where(eq(tenantUsers.id, row.c.assignedByTenantUserId))
        .limit(1)
      assignedByName = a ? memberDisplayName({ member: a.member, user: a.u }) : null
    }
    let verifierName: string | null = null
    if (row.c.verifiedByTenantUserId) {
      const [v] = await tx
        .select({ member: tenantUsers, u: user })
        .from(tenantUsers)
        .leftJoin(user, eq(user.id, tenantUsers.userId))
        .where(eq(tenantUsers.id, row.c.verifiedByTenantUserId))
        .limit(1)
      verifierName = v ? memberDisplayName({ member: v.member, user: v.u }) : null
    }

    const photos = await tx
      .select({ link: caPhotos, att: attachments })
      .from(caPhotos)
      .innerJoin(attachments, eq(attachments.id, caPhotos.attachmentId))
      .where(eq(caPhotos.caId, caId))

    const steps = await tx
      .select({
        step: caCompleteSteps,
        byMember: tenantUsers,
        byUser: user,
      })
      .from(caCompleteSteps)
      .leftJoin(tenantUsers, eq(tenantUsers.id, caCompleteSteps.completedByTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(caCompleteSteps.caId, caId))
      .orderBy(asc(caCompleteSteps.entityOrder))

    return { ...row, assignedByName, verifierName, photos, steps }
  })

  if (!data) {
    throw new Error(`Corrective action ${caId} not found`)
  }

  const c = data.c
  const t = data.tenant

  const pdf = await renderCaPdf({
    tenantName: t.name,
    tenantLogoUrl: t.branding.logoUrl,
    primaryColor: t.branding.primaryColor,
    ca: {
      reference: c.reference,
      title: c.title,
      description: c.description,
      rootCause: c.rootCause,
      actionTaken: c.actionTaken,
      severity: c.severity,
      status: c.status,
      source: c.source,
      sourceEntityType: c.sourceEntityType,
      siteName: data.site?.name ?? null,
      ownerName: memberDisplayName({
        member: data.ownerMember,
        user: data.ownerUser,
      }),
      assignedByName: data.assignedByName,
      assignedOn: c.assignedOn,
      dueOn: c.dueOn,
      closedAt: c.closedAt,
      costImpact: c.costImpact,
      verificationRequired: c.verificationRequired,
      verificationNotes: c.verificationNotes,
      verifierName: data.verifierName,
      verifiedAt: c.verifiedAt,
    },
    photos: data.photos.map((p) => ({
      url: publicUrl(p.att.r2Key),
      caption: p.link.caption,
    })),
    completeSteps: data.steps.map((s) => ({
      kind: s.step.kind,
      description: s.step.description,
      completedByName: memberDisplayName({
        member: s.byMember,
        user: s.byUser,
      }),
      completedAt: s.step.completedAt,
      signatureDataUrl: s.step.signatureDataUrl,
    })),
    generatedAt: new Date(),
  })

  const stamp = Date.now()
  const stored = await storeTransientPdfArtifact({
    tenantId,
    pdf,
    filename: `ca-${c.reference || caId.slice(0, 8)}-${stamp}.pdf`,
    r2Key: `tmp/pdfs/corrective-actions/${tenantId}/${caId}-${stamp}.pdf`,
    entityType: 'corrective_action',
    entityId: caId,
    summary: 'Rendered corrective action PDF',
  })

  console.log(`[pdf] ca ${caId} rendered (${pdf.length} bytes)`)
  return stored
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
  const title = b.title || b.name || 'Document Book'
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
    r2Key: `tmp/pdfs/document-books/${tenantId}/${bookId}-${stamp}.pdf`,
    entityType: 'document_book',
    entityId: bookId,
    summary: 'Rendered document book PDF',
  })

  console.log(`[pdf] document_book ${bookId} rendered (${pdf.length} bytes)`)
  return stored
}

// --- equipment_workorder ---------------------------------------------------

async function renderEquipmentWorkOrder(
  tenantId: string,
  workOrderId: string,
): Promise<StoredPdfResult> {
  const data = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        wo: equipmentWorkOrders,
        item: equipmentItems,
        type: equipmentTypes,
        site: orgUnits,
        holder: people,
        tenant: tenants,
      })
      .from(equipmentWorkOrders)
      .innerJoin(equipmentItems, eq(equipmentItems.id, equipmentWorkOrders.itemId))
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
      .innerJoin(tenants, eq(tenants.id, equipmentWorkOrders.tenantId))
      .where(eq(equipmentWorkOrders.id, workOrderId))
      .limit(1)
    if (!row) return null

    let reportedByName: string | null = null
    if (row.wo.reportedByPersonId) {
      const [p] = await tx
        .select({ firstName: people.firstName, lastName: people.lastName })
        .from(people)
        .where(eq(people.id, row.wo.reportedByPersonId))
        .limit(1)
      reportedByName = personName(p ?? null)
    }
    let openedByName: string | null = null
    if (row.wo.openedByTenantUserId) {
      const [m] = await tx
        .select({ member: tenantUsers, u: user })
        .from(tenantUsers)
        .leftJoin(user, eq(user.id, tenantUsers.userId))
        .where(eq(tenantUsers.id, row.wo.openedByTenantUserId))
        .limit(1)
      openedByName = m ? memberDisplayName({ member: m.member, user: m.u }) : null
    }
    let assignedToName: string | null = null
    if (row.wo.assignedToTenantUserId) {
      const [m] = await tx
        .select({ member: tenantUsers, u: user })
        .from(tenantUsers)
        .leftJoin(user, eq(user.id, tenantUsers.userId))
        .where(eq(tenantUsers.id, row.wo.assignedToTenantUserId))
        .limit(1)
      assignedToName = m ? memberDisplayName({ member: m.member, user: m.u }) : null
    }

    return { ...row, reportedByName, openedByName, assignedToName }
  })

  if (!data) {
    throw new Error(`Equipment work order ${workOrderId} not found`)
  }

  const wo = data.wo
  const item = data.item
  const t = data.tenant

  const pdf = await renderEquipmentWorkOrderPdf({
    tenantName: t.name,
    tenantLogoUrl: t.branding.logoUrl,
    primaryColor: t.branding.primaryColor,
    workOrder: {
      reference: wo.reference,
      status: wo.status,
      priority: wo.priority,
      summary: wo.summary,
      description: wo.description,
      actionTaken: wo.actionTaken,
      cost: wo.cost,
      openedAt: wo.openedAt,
      closedAt: wo.closedAt,
      reportedByName: data.reportedByName,
      openedByName: data.openedByName,
      assignedToName: data.assignedToName,
    },
    item: {
      assetTag: item.assetTag,
      name: item.name,
      serialNumber: item.serialNumber,
      description: item.description,
      typeName: data.type?.name ?? null,
      status: item.status,
      currentSiteName: data.site?.name ?? null,
      currentHolderName: personName(data.holder),
    },
    generatedAt: new Date(),
  })

  const stamp = Date.now()
  const stored = await storeTransientPdfArtifact({
    tenantId,
    pdf,
    filename: `wo-${wo.reference || workOrderId.slice(0, 8)}-${stamp}.pdf`,
    r2Key: `tmp/pdfs/equipment-work-orders/${tenantId}/${workOrderId}-${stamp}.pdf`,
    entityType: 'equipment_work_order',
    entityId: workOrderId,
    summary: 'Rendered equipment work order PDF',
  })

  console.log(`[pdf] equipment_workorder ${workOrderId} rendered (${pdf.length} bytes)`)
  return stored
}

// --- ppe_issue -------------------------------------------------------------

async function renderPpeIssue(tenantId: string, issueReportId: string): Promise<StoredPdfResult> {
  const data = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        r: ppeIssueReports,
        item: ppeItems,
        type: ppeTypes,
        holder: people,
        tenant: tenants,
      })
      .from(ppeIssueReports)
      .innerJoin(ppeItems, eq(ppeItems.id, ppeIssueReports.itemId))
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
      .innerJoin(tenants, eq(tenants.id, ppeIssueReports.tenantId))
      .where(eq(ppeIssueReports.id, issueReportId))
      .limit(1)
    if (!row) return null

    let reportedByName: string | null = null
    if (row.r.reportedByTenantUserId) {
      const [m] = await tx
        .select({ member: tenantUsers, u: user })
        .from(tenantUsers)
        .leftJoin(user, eq(user.id, tenantUsers.userId))
        .where(eq(tenantUsers.id, row.r.reportedByTenantUserId))
        .limit(1)
      reportedByName = m ? memberDisplayName({ member: m.member, user: m.u }) : null
    }

    return { ...row, reportedByName }
  })

  if (!data) {
    throw new Error(`PPE issue report ${issueReportId} not found`)
  }

  const r = data.r
  const item = data.item
  const t = data.tenant

  const pdf = await renderPpeIssuePdf({
    tenantName: t.name,
    tenantLogoUrl: t.branding.logoUrl,
    primaryColor: t.branding.primaryColor,
    issueReport: {
      description: r.description,
      status: r.status,
      resolution: r.resolution,
      reportedAt: r.reportedAt,
      resolvedAt: r.resolvedAt,
      reportedByName: data.reportedByName,
    },
    item: {
      serialNumber: item.serialNumber,
      size: item.size,
      status: item.status,
      typeName: data.type.name,
      category: data.type.category,
      currentHolderName: personName(data.holder),
      purchaseDate: item.purchaseDate,
      expiresOn: item.expiresOn,
    },
    generatedAt: new Date(),
  })

  const stamp = Date.now()
  const stored = await storeTransientPdfArtifact({
    tenantId,
    pdf,
    filename: `ppe-issue-${issueReportId.slice(0, 8)}-${stamp}.pdf`,
    r2Key: `tmp/pdfs/ppe-issues/${tenantId}/${issueReportId}-${stamp}.pdf`,
    entityType: 'ppe_issue_report',
    entityId: issueReportId,
    summary: 'Rendered PPE issue report PDF',
  })

  console.log(`[pdf] ppe_issue ${issueReportId} rendered (${pdf.length} bytes)`)
  return stored
}
