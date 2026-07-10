// Person ID badge: token issuance, data assembly, and PDF rendering.
//
// The badge QR points at the person's PUBLIC live training transcript
// (/verify/person/<token>). Tokens follow the training-certificate model —
// randomBytes(20) hex, generated lazily the first time a badge is printed and
// stable from then on (reprints keep the same QR).

import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import QRCode from 'qrcode'
import { attachments, departments, people, tenants } from '@beaconhs/db/schema'
import { renderDesignDocumentPdf } from '@beaconhs/forms-pdf'
import { publicUrl } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import type { PersonBadgeDesignData } from '@beaconhs/design-studio'
import { appBaseUrl } from '@/lib/app-base-url'
import { normalizePersonBadgeDesign } from '@/lib/person-badge-design'
import type { RenderedCredentialPdf } from '@/lib/training-credential-pdf'

/** Return the person's badge token, generating + persisting one on first use. */
export async function ensurePersonBadgeToken(
  ctx: RequestContext,
  personId: string,
): Promise<string | null> {
  return ctx.db(async (tx) => {
    const [person] = await tx
      .select({ id: people.id, badgeToken: people.badgeToken })
      .from(people)
      .where(eq(people.id, personId))
      .limit(1)
    if (!person) return null
    if (person.badgeToken) return person.badgeToken
    const token = randomBytes(20).toString('hex')
    await tx.update(people).set({ badgeToken: token }).where(eq(people.id, personId))
    return token
  })
}

export function personBadgeVerifyUrl(token: string): string {
  return `${appBaseUrl()}/verify/person/${token}`
}

/** Assemble the badge design data + render the tenant's badge design to PDF. */
export async function renderPersonBadgePdf(
  ctx: RequestContext,
  personId: string,
): Promise<RenderedCredentialPdf | null> {
  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .select({
        person: people,
        departmentName: departments.name,
        photoKey: attachments.r2Key,
        tenant: tenants,
      })
      .from(people)
      .leftJoin(departments, eq(departments.id, people.departmentId))
      .leftJoin(attachments, eq(attachments.id, people.photoAttachmentId))
      .innerJoin(tenants, eq(tenants.id, people.tenantId))
      .where(eq(people.id, personId))
      .limit(1)
    return r ?? null
  })
  if (!row || row.person.deletedAt) return null

  const token = await ensurePersonBadgeToken(ctx, personId)
  if (!token) return null
  const verifyUrl = personBadgeVerifyUrl(token)
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 8,
    color: { dark: '#0f172a', light: '#ffffff' },
  })

  const data: PersonBadgeDesignData = {
    tenantName: row.tenant.name,
    tenantLogoUrl: row.tenant.branding.logoUrl,
    recipientFullName: `${row.person.firstName} ${row.person.lastName}`,
    recipientEmployeeNo: row.person.employeeNo,
    recipientPhotoUrl: row.photoKey ? publicUrl(row.photoKey) : null,
    personTitle: row.person.jobTitle,
    personDepartment: row.departmentName,
    verifyUrl,
    qrDataUrl,
    issuedAt: new Date().toISOString().slice(0, 10),
  }

  const document = normalizePersonBadgeDesign(row.tenant.settings)
  const bytes = await renderDesignDocumentPdf({
    document,
    data,
    title: `${data.recipientFullName} — ID badge`,
  })
  const safe = data.recipientFullName.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return { bytes, filename: `${safe || 'person'}-id-badge.pdf` }
}
