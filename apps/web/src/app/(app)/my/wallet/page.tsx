// "My wallet" — an Apple-Wallet-style view of the signed-in user's credentials.
//
// Every training record and granted skill the person holds is rendered as a
// live credential card styled with the tenant's configured *wallet* credential
// design (resolveCredentialOutput → format 'wallet'), so the cards on screen
// match the printed CR80 cards exactly. Each card links to its print-ready PDF
// and, once a verification certificate exists, shows a scan-to-verify QR.
//
// Pivots on people.userId = ctx.userId, like every other /my view.

import { and, desc, eq, isNull } from 'drizzle-orm'
import QRCode from 'qrcode'
import { PageHeader } from '@beaconhs/ui'
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
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { resolveCredentialOutput } from '@/lib/credential-designs'
import { WorkspaceNoIdentity } from '../_no-identity'
import { WalletStack, type WalletCard, type WalletDesign } from './_wallet-stack'

export const metadata = { title: 'My wallet' }
export const dynamic = 'force-dynamic'

function appBaseUrl(): string {
  return process.env.PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

const EXPIRING_DAYS = 60

function statusFor(expiresOn: string | null, todayStr: string): WalletCard['status'] {
  if (!expiresOn) return 'none'
  if (expiresOn < todayStr) return 'expired'
  const soon = new Date()
  soon.setDate(soon.getDate() + EXPIRING_DAYS)
  if (expiresOn <= soon.toISOString().slice(0, 10)) return 'expiring'
  return 'valid'
}

export default async function MyWalletPage() {
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [person] = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
        jobTitle: people.jobTitle,
        photoAttachmentId: people.photoAttachmentId,
      })
      .from(people)
      .where(eq(people.userId, ctx.userId))
      .limit(1)
    if (!person) return { person: null } as const

    const [tenant] = await tx
      .select({ name: tenants.name, branding: tenants.branding, settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId!))
      .limit(1)

    const records = await tx
      .select({
        id: trainingRecords.id,
        completedOn: trainingRecords.completedOn,
        expiresOn: trainingRecords.expiresOn,
        courseName: trainingCourses.name,
        courseCode: trainingCourses.code,
      })
      .from(trainingRecords)
      .leftJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(and(eq(trainingRecords.personId, person.id), isNull(trainingRecords.deletedAt)))
      .orderBy(desc(trainingRecords.completedOn))

    const skills = await tx
      .select({
        id: trainingSkillAssignments.id,
        grantedOn: trainingSkillAssignments.grantedOn,
        expiresOn: trainingSkillAssignments.expiresOn,
        skillName: trainingSkillTypes.name,
        skillCode: trainingSkillTypes.code,
        authorityName: trainingSkillAuthorities.name,
      })
      .from(trainingSkillAssignments)
      .innerJoin(
        trainingSkillTypes,
        eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId),
      )
      .leftJoin(
        trainingSkillAuthorities,
        eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
      )
      .where(eq(trainingSkillAssignments.personId, person.id))
      .orderBy(desc(trainingSkillAssignments.grantedOn))

    // Existing verification tokens (we never issue on render — the download
    // route lazily creates them). Cards with a token get a scan-to-verify QR.
    const recordCerts = records.length
      ? await tx
          .select({
            recordId: trainingCertificates.recordId,
            token: trainingCertificates.verifyToken,
          })
          .from(trainingCertificates)
          .where(isNull(trainingCertificates.revokedAt))
      : []
    const skillCerts = skills.length
      ? await tx
          .select({
            assignmentId: trainingSkillCertificates.skillAssignmentId,
            token: trainingSkillCertificates.verifyToken,
          })
          .from(trainingSkillCertificates)
          .where(isNull(trainingSkillCertificates.revokedAt))
      : []

    let photoUrl: string | null = null
    if (person.photoAttachmentId) {
      const [photo] = await tx
        .select({ r2Key: attachments.r2Key })
        .from(attachments)
        .where(eq(attachments.id, person.photoAttachmentId))
        .limit(1)
      photoUrl = photo ? publicUrl(photo.r2Key) : null
    }

    return { person, tenant, records, skills, recordCerts, skillCerts, photoUrl } as const
  })

  if (!data.person) {
    return (
      <ListPageLayout
        header={
          <PageHeader title="My wallet" description="Your certificates and credential cards." />
        }
      >
        <WorkspaceNoIdentity
          reason={ctx.membership ? 'no-person' : 'no-membership'}
          noun="credentials"
        />
      </ListPageLayout>
    )
  }

  const { person, tenant, records, skills, recordCerts, skillCerts, photoUrl } = data
  const output = resolveCredentialOutput(tenant?.settings, { format: 'wallet' })
  const todayStr = new Date().toISOString().slice(0, 10)
  const base = appBaseUrl()

  const tokenByRecord = new Map(recordCerts.map((c) => [c.recordId, c.token]))
  const tokenByAssignment = new Map(skillCerts.map((c) => [c.assignmentId, c.token]))

  async function qrFor(token: string | undefined): Promise<string | null> {
    if (!token) return null
    return QRCode.toDataURL(`${base}/verify/${token}`, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 5,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
  }

  const trainingCards: WalletCard[] = await Promise.all(
    records.map(async (r) => {
      const token = tokenByRecord.get(r.id)
      return {
        id: `t-${r.id}`,
        kind: 'training' as const,
        title: r.courseName ?? 'Training credential',
        code: r.courseCode ?? null,
        authority: null,
        issuedLabel: 'Issued',
        issuedOn: r.completedOn,
        expiresOn: r.expiresOn,
        status: statusFor(r.expiresOn, todayStr),
        pdfHref: `/training/records/${r.id}/certificate?format=wallet&output=${output.id}`,
        verifyHref: token ? `/verify/${token}` : null,
        qrDataUrl: await qrFor(token),
      }
    }),
  )

  const skillCards: WalletCard[] = await Promise.all(
    skills.map(async (s) => {
      const token = tokenByAssignment.get(s.id)
      return {
        id: `s-${s.id}`,
        kind: 'skill' as const,
        title: s.skillName,
        code: s.skillCode ?? null,
        authority: s.authorityName ?? null,
        issuedLabel: 'Granted',
        issuedOn: s.grantedOn,
        expiresOn: s.expiresOn,
        status: statusFor(s.expiresOn, todayStr),
        pdfHref: `/training/skills/${s.id}/certificate?format=wallet&output=${output.id}`,
        verifyHref: token ? `/verify/${token}` : null,
        qrDataUrl: await qrFor(token),
      }
    }),
  )

  // Most-urgent first (expired, then expiring), then newest issued.
  const order = { expired: 0, expiring: 1, valid: 2, none: 3 }
  const cards = [...trainingCards, ...skillCards].sort(
    (a, b) => order[a.status] - order[b.status] || b.issuedOn.localeCompare(a.issuedOn),
  )

  const design: WalletDesign = {
    primary: output.primary,
    accent: output.accent,
    paper: output.paper,
    typeface: output.typeface,
    showPhoto: output.showPhoto,
    showSeal: output.showSeal,
    showQr: output.showQr,
    tenantName: tenant?.name ?? 'Credential',
    tenantLogoUrl: tenant?.branding?.logoUrl ?? null,
    holderName: `${person.firstName} ${person.lastName}`,
    employeeNo: person.employeeNo,
    jobTitle: person.jobTitle,
    photoUrl,
  }

  return (
    <ListPageLayout
      header={
        <PageHeader
          title="My wallet"
          description="Your certificates and credential cards. Tap a card for details and to download the print-ready pass."
        />
      }
    >
      <WalletStack cards={cards} design={design} />
    </ListPageLayout>
  )
}
