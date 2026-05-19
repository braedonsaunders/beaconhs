// PDF worker.
//
// Consumes the `pdfs` BullMQ queue and renders three kinds of PDFs:
//   - form_response  → form response → PDF, stored on form_responses.pdfAttachmentId
//   - incident       → incident detail → PDF, linked via incident_attachments
//   - certificate    → training_certificates → both wallet card + full cert PDFs,
//                       cert URL stored on training_certificates.pdfAttachmentId
//
// All renders are uploaded straight to MinIO/R2 via the storage package and
// recorded in the attachments table + audit_log (action='export').

import type { Job } from 'bullmq'
import { asc, eq } from 'drizzle-orm'
import { db, withTenant } from '@beaconhs/db'
import {
  attachments,
  departments,
  formResponses,
  formTemplateVersions,
  formTemplates,
  incidentAttachments,
  incidentInjuries,
  incidentLostTimeEvents,
  incidentPeople,
  incidents,
  orgUnits,
  people,
  tenants,
  trainingCertificates,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import {
  renderCertificatePdf,
  renderFormPdf,
  renderIncidentPdf,
} from '@beaconhs/forms-pdf'
import type { PdfJobData } from '@beaconhs/jobs'
import { newAttachmentKey, publicUrl, putObject } from '@beaconhs/storage'
import { audit } from '@beaconhs/audit'

export async function processPdf(job: Job<PdfJobData>): Promise<void> {
  const data = job.data
  try {
    switch (data.kind) {
      case 'form_response':
        return await renderFormResponse(data.tenantId, data.responseId)
      case 'incident':
        return await renderIncident(data.tenantId, data.incidentId)
      case 'certificate':
        return await renderCertificate(data.tenantId, data.certificateId)
    }
  } catch (err) {
    console.error(`[pdf] job ${job.id} failed:`, err)
    throw err
  }
}

// --- form_response --------------------------------------------------------

async function renderFormResponse(tenantId: string, responseId: string): Promise<void> {
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
    console.warn(`[pdf] form_response ${responseId} not found`)
    return
  }

  const title =
    typeof result.version.schema.title === 'object'
      ? (result.version.schema.title.en ?? result.template.name)
      : result.template.name

  const pdf = await renderFormPdf({
    schema: result.version.schema,
    values: result.response.data,
    metadata: {
      title,
      reference: result.response.id.slice(0, 8),
      submittedAt: result.response.submittedAt?.toISOString().slice(0, 19).replace('T', ' '),
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

  const filename = `form-${responseId.slice(0, 8)}.pdf`
  const r2Key = newAttachmentKey({ tenantId, kind: 'document', filename })

  await putObject({ key: r2Key, body: pdf, contentType: 'application/pdf' })

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
    if (att) {
      await tx
        .update(formResponses)
        .set({ pdfAttachmentId: att.id })
        .where(eq(formResponses.id, responseId))
    }
    await audit(tx, {
      tenantId,
      entityType: 'form_response',
      entityId: responseId,
      action: 'export',
      summary: 'Rendered form response PDF',
      metadata: { attachmentId: att?.id, r2Key, sizeBytes: pdf.length, url: publicUrl(r2Key) },
    })
  })

  console.log(`[pdf] form_response ${responseId} rendered (${pdf.length} bytes) → ${r2Key}`)
}

// --- incident -------------------------------------------------------------

async function renderIncident(tenantId: string, incidentId: string): Promise<void> {
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
    console.warn(`[pdf] incident ${incidentId} not found`)
    return
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
        : row.link.personNameText ?? 'Unknown',
      role: row.link.role,
    })),
    injuries: result.injuries.map((row) => ({
      personName: row.person
        ? `${row.person.firstName} ${row.person.lastName}`
        : row.injury.personName ?? 'Unknown',
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
  const r2Key = `pdfs/incidents/${incidentId}-${stamp}.pdf`

  await putObject({ key: r2Key, body: pdf, contentType: 'application/pdf' })

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
    if (att) {
      await tx.insert(incidentAttachments).values({
        tenantId,
        incidentId,
        attachmentId: att.id,
        caption: 'Generated incident report PDF',
      })
    }
    await audit(tx, {
      tenantId,
      entityType: 'incident',
      entityId: incidentId,
      action: 'export',
      summary: 'Rendered incident PDF',
      metadata: { attachmentId: att?.id, r2Key, sizeBytes: pdf.length, url: publicUrl(r2Key) },
    })
  })

  console.log(`[pdf] incident ${incidentId} rendered (${pdf.length} bytes) → ${r2Key}`)
}

// --- certificate ----------------------------------------------------------

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

  // Public verify URL — used in QR / footer text.
  const baseUrl = process.env.PUBLIC_APP_URL ?? 'http://localhost:3000'
  const verifyUrl = `${baseUrl}/verify/${cert.verifyToken}`

  const { certificate, wallet } = await renderCertificatePdf({
    tenantName: t.name,
    tenantLogoUrl: t.branding.logoUrl,
    primaryColor: t.branding.primaryColor,
    recipient: {
      fullName: `${person.firstName} ${person.lastName}`,
      employeeNo: person.employeeNo,
    },
    course: { code: course.code, name: course.name },
    completedOn: record.completedOn,
    expiresOn: record.expiresOn,
    instructor: record.instructor,
    grade: record.grade,
    verifyUrl,
    verifyToken: cert.verifyToken,
    generatedAt: new Date(),
    wallet: {
      tenantName: t.name,
      tenantLogoUrl: t.branding.logoUrl,
      primaryColor: t.branding.primaryColor,
      recipient: {
        fullName: `${person.firstName} ${person.lastName}`,
        employeeNo: person.employeeNo,
        photoUrl,
      },
      course: { code: course.code, name: course.name },
      completedOn: record.completedOn,
      expiresOn: record.expiresOn,
      verifyUrl,
      verifyToken: cert.verifyToken,
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
