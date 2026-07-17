import { eq } from 'drizzle-orm'
import QRCode from 'qrcode'
import {
  attachments,
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
import { renderDesignDocumentPdf, renderDesignDocumentPngs } from '@beaconhs/forms-pdf'
import { presignGet, resolveTenantLogoUrl } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import { directPrintProvider, type DirectPrintProvider } from '@beaconhs/design-studio'
import { appBaseUrl } from '@/lib/app-base-url'
import {
  credentialOutputPdfFormat,
  resolveCourseCredentialOutput,
  resolveCredentialOutput,
  type CredentialOutputRequest,
} from '@/lib/credential-designs'

export type RenderedCredentialPdf = {
  bytes: Buffer
  filename: string
}

export type RenderedCredentialPrint = {
  images: Buffer[]
  provider: DirectPrintProvider
}

async function makeVerifyQr(verifyUrl: string): Promise<string> {
  return QRCode.toDataURL(verifyUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 8,
    color: { dark: '#0f172a', light: '#ffffff' },
  })
}

function safeName(value: string | null | undefined, fallback: string): string {
  const s = (value ?? fallback).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return (s || fallback).slice(0, 48)
}

async function photoUrlForPerson(ctx: RequestContext, photoAttachmentId: string | null) {
  if (!photoAttachmentId) return null
  return ctx.db(async (tx) => {
    const [photo] = await tx
      .select({ r2Key: attachments.r2Key })
      .from(attachments)
      .where(eq(attachments.id, photoAttachmentId))
      .limit(1)
    return photo ? presignGet({ key: photo.r2Key, expiresInSeconds: 900 }) : null
  })
}

type CredentialOutput = Parameters<typeof credentialOutputPdfFormat>[0]
type DesignDocumentData = Parameters<typeof renderDesignDocumentPdf>[0]['data']

type PreparedCredential = {
  output: CredentialOutput
  documentData: DesignDocumentData
  filename: string
}

async function prepareTrainingCredential(
  ctx: RequestContext,
  certificateId: string,
  request: CredentialOutputRequest,
): Promise<PreparedCredential | null> {
  const data = await ctx.db(async (tx) => {
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
    return row ?? null
  })
  if (!data) return null

  const { cert, record, person, course, tenant } = data
  const [photoUrl, tenantLogoUrl] = await Promise.all([
    photoUrlForPerson(ctx, person.photoAttachmentId),
    resolveTenantLogoUrl({ tenantId: tenant.id, logoUrl: tenant.branding.logoUrl }),
  ])
  const verifyUrl = `${appBaseUrl()}/verify/${cert.verifyToken}`
  const qrDataUrl = await makeVerifyQr(verifyUrl)
  const fullName = `${person.firstName} ${person.lastName}`
  // Honor the course's pinned Card Studio designs; fall back to tenant defaults.
  const output = resolveCourseCredentialOutput(course.metadata, tenant.settings, request)
  const pdfFormat = credentialOutputPdfFormat(output)
  const coursePart = safeName(course.code, 'course')
  const personPart = safeName(person.lastName, 'person')
  const outputPart = safeName(output.name, pdfFormat === 'wallet' ? 'wallet' : 'certificate')
  return {
    output,
    documentData: {
      tenantName: tenant.name,
      tenantLogoUrl,
      recipientFullName: fullName,
      recipientEmployeeNo: person.employeeNo,
      recipientPhotoUrl: photoUrl,
      credentialName: course.name,
      credentialCode: course.code,
      completedOn: record.completedOn,
      expiresOn: record.expiresOn,
      instructor: record.instructor,
      grade: record.grade,
      verifyUrl,
      verifyToken: cert.verifyToken,
      qrDataUrl,
      issuedAt: cert.createdAt,
    },
    filename: `${outputPart}-${coursePart}-${personPart}.pdf`,
  }
}

async function prepareSkillCredential(
  ctx: RequestContext,
  certificateId: string,
  request: CredentialOutputRequest,
): Promise<PreparedCredential | null> {
  const data = await ctx.db(async (tx) => {
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
      .where(eq(trainingSkillCertificates.id, certificateId))
      .limit(1)
    return row ?? null
  })
  if (!data) return null

  const { cert, assignment, skillType, authority, person, tenant } = data
  const [photoUrl, tenantLogoUrl] = await Promise.all([
    photoUrlForPerson(ctx, person.photoAttachmentId),
    resolveTenantLogoUrl({ tenantId: tenant.id, logoUrl: tenant.branding.logoUrl }),
  ])
  const verifyUrl = `${appBaseUrl()}/verify/${cert.verifyToken}`
  const qrDataUrl = await makeVerifyQr(verifyUrl)
  const fullName = `${person.firstName} ${person.lastName}`
  const output = resolveCredentialOutput(tenant.settings, request)
  const pdfFormat = credentialOutputPdfFormat(output)
  const skillPart = safeName(skillType.code || skillType.name, 'skill')
  const personPart = safeName(person.lastName, 'person')
  const outputPart = safeName(output.name, pdfFormat === 'wallet' ? 'wallet' : 'certificate')
  return {
    output,
    documentData: {
      tenantName: tenant.name,
      tenantLogoUrl,
      recipientFullName: fullName,
      recipientEmployeeNo: person.employeeNo,
      recipientPhotoUrl: photoUrl,
      credentialName: skillType.name,
      credentialCode: skillType.code,
      authorityName: authority.name,
      completedOn: assignment.grantedOn,
      expiresOn: assignment.expiresOn,
      verifyUrl,
      verifyToken: cert.verifyToken,
      qrDataUrl,
      issuedAt: cert.createdAt,
    },
    filename: `skill-${outputPart}-${skillPart}-${personPart}.pdf`,
  }
}

async function renderPreparedCredentialPdf(
  prepared: PreparedCredential | null,
): Promise<RenderedCredentialPdf | null> {
  if (!prepared?.output.document) return null
  const bytes = await renderDesignDocumentPdf({
    document: prepared.output.document,
    data: prepared.documentData,
    title: prepared.output.name,
  })
  return { bytes, filename: prepared.filename }
}

async function renderPreparedCredentialPngs(
  prepared: PreparedCredential | null,
): Promise<RenderedCredentialPrint | null> {
  if (!prepared?.output.document || prepared.output.format !== 'wallet') return null
  const provider = directPrintProvider(prepared.output.document)
  if (!provider) return null
  const images = await renderDesignDocumentPngs({
    document: prepared.output.document,
    data: prepared.documentData,
    dpi: 300,
  })
  return { images, provider }
}

export async function renderTrainingCredentialPdf(
  ctx: RequestContext,
  certificateId: string,
  request: CredentialOutputRequest,
): Promise<RenderedCredentialPdf | null> {
  return renderPreparedCredentialPdf(await prepareTrainingCredential(ctx, certificateId, request))
}

export async function renderSkillCredentialPdf(
  ctx: RequestContext,
  certificateId: string,
  request: CredentialOutputRequest,
): Promise<RenderedCredentialPdf | null> {
  return renderPreparedCredentialPdf(await prepareSkillCredential(ctx, certificateId, request))
}

export async function renderTrainingCredentialPngs(
  ctx: RequestContext,
  certificateId: string,
  request: CredentialOutputRequest,
): Promise<RenderedCredentialPrint | null> {
  return renderPreparedCredentialPngs(await prepareTrainingCredential(ctx, certificateId, request))
}

export async function renderSkillCredentialPngs(
  ctx: RequestContext,
  certificateId: string,
  request: CredentialOutputRequest,
): Promise<RenderedCredentialPrint | null> {
  return renderPreparedCredentialPngs(await prepareSkillCredential(ctx, certificateId, request))
}

export function pdfResponse(rendered: RenderedCredentialPdf): Response {
  return new Response(new Uint8Array(rendered.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(rendered.bytes.length),
      'Content-Disposition': `inline; filename="${rendered.filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
