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
import {
  renderCertificatePagePdf,
  renderDesignDocumentPdf,
  renderWalletCardPdf,
} from '@beaconhs/forms-pdf'
import { presignGet, resolveTenantLogoUrl } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
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
type CertificatePageInput = Parameters<typeof renderCertificatePagePdf>[0]
type WalletCardInput = Parameters<typeof renderWalletCardPdf>[0]

async function renderCredentialOutputPdf(args: {
  output: CredentialOutput
  documentData: DesignDocumentData
  certificateInput: CertificatePageInput
  walletInput: WalletCardInput
}): Promise<{ bytes: Buffer; pdfFormat: 'cert' | 'wallet' }> {
  const pdfFormat = credentialOutputPdfFormat(args.output)
  const bytes =
    args.output.document != null
      ? await renderDesignDocumentPdf({
          document: args.output.document,
          data: args.documentData,
          title: args.output.name,
        })
      : pdfFormat === 'wallet'
        ? await renderWalletCardPdf(args.walletInput)
        : await renderCertificatePagePdf(args.certificateInput)
  return { bytes, pdfFormat }
}

export async function renderTrainingCredentialPdf(
  ctx: RequestContext,
  certificateId: string,
  request: CredentialOutputRequest,
): Promise<RenderedCredentialPdf | null> {
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
  const certificateInput = {
    tenantName: tenant.name,
    tenantLogoUrl: tenantLogoUrl ?? undefined,
    primaryColor: tenant.branding.primaryColor,
    design: output,
    variant: 'completion',
    recipient: { fullName, employeeNo: person.employeeNo },
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
  } as const
  const walletInput = {
    tenantName: tenant.name,
    tenantLogoUrl: tenantLogoUrl ?? undefined,
    primaryColor: tenant.branding.primaryColor,
    design: output,
    variant: 'completion',
    recipient: { fullName, employeeNo: person.employeeNo, photoUrl },
    credential: { code: course.code, name: course.name },
    completedOn: record.completedOn,
    expiresOn: record.expiresOn,
    verifyUrl,
    verifyToken: cert.verifyToken,
    qrDataUrl,
    cardId: cert.id,
  } as const
  const { bytes, pdfFormat } = await renderCredentialOutputPdf({
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
    certificateInput,
    walletInput,
  })

  const coursePart = safeName(course.code, 'course')
  const personPart = safeName(person.lastName, 'person')
  const outputPart = safeName(output.name, pdfFormat === 'wallet' ? 'wallet' : 'certificate')
  return {
    bytes,
    filename: `${outputPart}-${coursePart}-${personPart}.pdf`,
  }
}

export async function renderSkillCredentialPdf(
  ctx: RequestContext,
  certificateId: string,
  request: CredentialOutputRequest,
): Promise<RenderedCredentialPdf | null> {
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
  const certificateInput = {
    tenantName: tenant.name,
    tenantLogoUrl: tenantLogoUrl ?? undefined,
    primaryColor: tenant.branding.primaryColor,
    design: output,
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
  } as const
  const walletInput = {
    tenantName: tenant.name,
    tenantLogoUrl: tenantLogoUrl ?? undefined,
    primaryColor: tenant.branding.primaryColor,
    design: output,
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
  } as const
  const { bytes, pdfFormat } = await renderCredentialOutputPdf({
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
    certificateInput,
    walletInput,
  })

  const skillPart = safeName(skillType.code || skillType.name, 'skill')
  const personPart = safeName(person.lastName, 'person')
  const outputPart = safeName(output.name, pdfFormat === 'wallet' ? 'wallet' : 'certificate')
  return {
    bytes,
    filename: `skill-${outputPart}-${skillPart}-${personPart}.pdf`,
  }
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
