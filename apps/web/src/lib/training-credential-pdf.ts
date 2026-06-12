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
import { renderCertificatePagePdf, renderWalletCardPdf } from '@beaconhs/forms-pdf'
import { publicUrl } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import {
  CREDENTIAL_DESIGN_SETTINGS_KEY,
  normalizeCredentialDesign,
  type CredentialDesign,
} from '@/lib/credential-designs'

export type CredentialPdfFormat = 'cert' | 'wallet'

export type RenderedCredentialPdf = {
  bytes: Buffer
  filename: string
}

function appBaseUrl(): string {
  return process.env.PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
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

function credentialDesignForFormat(
  settings: Record<string, unknown>,
  format: CredentialPdfFormat,
): CredentialDesign {
  const design = normalizeCredentialDesign(settings[CREDENTIAL_DESIGN_SETTINGS_KEY])
  return {
    ...design,
    format:
      format === 'wallet'
        ? 'wallet'
        : design.format === 'letter-portrait'
          ? 'letter-portrait'
          : 'letter-landscape',
  }
}

async function photoUrlForPerson(ctx: RequestContext, photoAttachmentId: string | null) {
  if (!photoAttachmentId) return null
  return ctx.db(async (tx) => {
    const [photo] = await tx
      .select({ r2Key: attachments.r2Key })
      .from(attachments)
      .where(eq(attachments.id, photoAttachmentId))
      .limit(1)
    return photo ? publicUrl(photo.r2Key) : null
  })
}

export async function renderTrainingCredentialPdf(
  ctx: RequestContext,
  certificateId: string,
  format: CredentialPdfFormat,
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
  const photoUrl = await photoUrlForPerson(ctx, person.photoAttachmentId)
  const verifyUrl = `${appBaseUrl()}/verify/${cert.verifyToken}`
  const qrDataUrl = await makeVerifyQr(verifyUrl)
  const fullName = `${person.firstName} ${person.lastName}`
  const design = credentialDesignForFormat(tenant.settings, format)
  const certificateInput = {
    tenantName: tenant.name,
    tenantLogoUrl: tenant.branding.logoUrl,
    primaryColor: tenant.branding.primaryColor,
    design,
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
    tenantLogoUrl: tenant.branding.logoUrl,
    primaryColor: tenant.branding.primaryColor,
    design,
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
  const bytes =
    format === 'wallet'
      ? await renderWalletCardPdf(walletInput)
      : await renderCertificatePagePdf(certificateInput)

  const coursePart = safeName(course.code, 'course')
  const personPart = safeName(person.lastName, 'person')
  return {
    bytes,
    filename:
      format === 'wallet'
        ? `wallet-${coursePart}-${personPart}.pdf`
        : `certificate-${coursePart}-${personPart}.pdf`,
  }
}

export async function renderSkillCredentialPdf(
  ctx: RequestContext,
  certificateId: string,
  format: CredentialPdfFormat,
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
  const photoUrl = await photoUrlForPerson(ctx, person.photoAttachmentId)
  const verifyUrl = `${appBaseUrl()}/verify/${cert.verifyToken}`
  const qrDataUrl = await makeVerifyQr(verifyUrl)
  const fullName = `${person.firstName} ${person.lastName}`
  const design = credentialDesignForFormat(tenant.settings, format)
  const certificateInput = {
    tenantName: tenant.name,
    tenantLogoUrl: tenant.branding.logoUrl,
    primaryColor: tenant.branding.primaryColor,
    design,
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
    tenantLogoUrl: tenant.branding.logoUrl,
    primaryColor: tenant.branding.primaryColor,
    design,
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
  const bytes =
    format === 'wallet'
      ? await renderWalletCardPdf(walletInput)
      : await renderCertificatePagePdf(certificateInput)

  const skillPart = safeName(skillType.code || skillType.name, 'skill')
  const personPart = safeName(person.lastName, 'person')
  return {
    bytes,
    filename:
      format === 'wallet'
        ? `skill-wallet-${skillPart}-${personPart}.pdf`
        : `skill-certificate-${skillPart}-${personPart}.pdf`,
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
