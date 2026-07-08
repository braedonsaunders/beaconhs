// "My wallet" — an Apple-Wallet-style view of the signed-in user's credentials.
//
// Every training record and granted skill is rendered through the SAME design
// system that produces the printed CR80 cards: the tenant's configured *wallet*
// credential design document (resolveCredentialOutput → format 'wallet'), drawn
// to HTML by `renderDesignDocumentHtml`. The front/back artboards on screen are
// therefore pixel-identical to the downloaded PDF. Each card links to its
// print-ready pass and, once a verification certificate exists, shows a
// scan-to-verify QR.
//
// Pivots on people.userId = ctx.userId, like every other /my view.

import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
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
import {
  createWalletDesignDocument,
  renderDesignDocumentHtml,
  type CredentialDesignData,
} from '@beaconhs/design-studio'
import { requireRequestContext } from '@/lib/auth'
import { latestTrainingRecordOnly } from '@/lib/training-latest'
import { ListPageLayout } from '@/components/page-layout'
import { resolveCourseCredentialOutput, resolveCredentialOutput } from '@/lib/credential-designs'
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
        photoAttachmentId: people.photoAttachmentId,
      })
      .from(people)
      .where(and(eq(people.userId, ctx.userId), isNull(people.deletedAt)))
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
        instructor: trainingRecords.instructor,
        grade: trainingRecords.grade,
        courseName: trainingCourses.name,
        courseCode: trainingCourses.code,
        courseMetadata: trainingCourses.metadata,
      })
      .from(trainingRecords)
      .leftJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      // The wallet is the person's CURRENT credentials: one card per course,
      // from the latest record. Superseded records (retrained since) stay in
      // /my/training history but never render an "expired" card here.
      .where(
        and(
          eq(trainingRecords.personId, person.id),
          isNull(trainingRecords.deletedAt),
          latestTrainingRecordOnly(),
        ),
      )
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
          .where(
            and(
              isNull(trainingCertificates.revokedAt),
              inArray(
                trainingCertificates.recordId,
                records.map((r) => r.id),
              ),
            ),
          )
      : []
    const skillCerts = skills.length
      ? await tx
          .select({
            assignmentId: trainingSkillCertificates.skillAssignmentId,
            token: trainingSkillCertificates.verifyToken,
          })
          .from(trainingSkillCertificates)
          .where(
            and(
              isNull(trainingSkillCertificates.revokedAt),
              inArray(
                trainingSkillCertificates.skillAssignmentId,
                skills.map((s) => s.id),
              ),
            ),
          )
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
          <PageHeader
            back={{ href: '/my', label: 'Workspace' }}
            title="My wallet"
            description="Your certificates and credential cards."
          />
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
  // Tenant-default wallet design — used for skills and as the fallback. Training
  // records resolve their own design from the course's pinned selection below.
  const defaultOutput = resolveCredentialOutput(tenant?.settings, { format: 'wallet' })
  const defaultDocument = defaultOutput.document ?? createWalletDesignDocument(defaultOutput)
  const front = defaultDocument.artboards[0]
  const widthIn = front?.width ?? 3.375
  const heightIn = front?.height ?? 2.125

  const todayStr = new Date().toISOString().slice(0, 10)
  const base = appBaseUrl()
  const tenantName = tenant?.name ?? 'Credential'
  const tenantLogoUrl = tenant?.branding?.logoUrl ?? null
  const recipientFullName = `${person.firstName} ${person.lastName}`

  const tokenByRecord = new Map(recordCerts.map((c) => [c.recordId, c.token]))
  const tokenByAssignment = new Map(skillCerts.map((c) => [c.assignmentId, c.token]))

  async function qrFor(token: string | undefined): Promise<string | null> {
    if (!token) return null
    return QRCode.toDataURL(`${base}/verify/${token}`, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 6,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
  }

  async function renderCard(
    doc: typeof defaultDocument,
    cardData: CredentialDesignData,
  ): Promise<{ frontHtml: string; backHtml: string }> {
    const fId = doc.artboards[0]?.id ?? null
    const bId = doc.artboards[1]?.id ?? fId
    const frontHtml = renderDesignDocumentHtml(doc, cardData, { artboardId: fId })
    const backHtml = renderDesignDocumentHtml(doc, cardData, { artboardId: bId })
    return { frontHtml, backHtml }
  }

  const trainingCards: WalletCard[] = await Promise.all(
    records.map(async (r) => {
      const token = tokenByRecord.get(r.id)
      const qrDataUrl = await qrFor(token)
      // Each course can pin its own wallet design; fall back to the tenant default.
      const recordOutput = resolveCourseCredentialOutput(r.courseMetadata, tenant?.settings, {
        format: 'wallet',
      })
      const recordDocument = recordOutput.document ?? createWalletDesignDocument(recordOutput)
      const faces = await renderCard(recordDocument, {
        tenantName,
        tenantLogoUrl,
        recipientFullName,
        recipientEmployeeNo: person.employeeNo,
        recipientPhotoUrl: photoUrl,
        credentialName: r.courseName ?? 'Training credential',
        credentialCode: r.courseCode ?? null,
        completedOn: r.completedOn,
        expiresOn: r.expiresOn,
        instructor: r.instructor,
        grade: r.grade,
        verifyUrl: token ? `${base}/verify/${token}` : null,
        verifyToken: token ?? null,
        qrDataUrl,
      })
      return {
        id: `t-${r.id}`,
        kind: 'training' as const,
        title: r.courseName ?? 'Training credential',
        status: statusFor(r.expiresOn, todayStr),
        pdfHref: `/training/records/${r.id}/certificate?format=wallet&output=${recordOutput.id}`,
        verifyHref: token ? `/verify/${token}` : null,
        ...faces,
      }
    }),
  )

  const skillCards: WalletCard[] = await Promise.all(
    skills.map(async (s) => {
      const token = tokenByAssignment.get(s.id)
      const qrDataUrl = await qrFor(token)
      const faces = await renderCard(defaultDocument, {
        tenantName,
        tenantLogoUrl,
        recipientFullName,
        recipientEmployeeNo: person.employeeNo,
        recipientPhotoUrl: photoUrl,
        credentialName: s.skillName,
        credentialCode: s.skillCode ?? null,
        authorityName: s.authorityName,
        completedOn: s.grantedOn,
        expiresOn: s.expiresOn,
        verifyUrl: token ? `${base}/verify/${token}` : null,
        verifyToken: token ?? null,
        qrDataUrl,
      })
      return {
        id: `s-${s.id}`,
        kind: 'skill' as const,
        title: s.skillName,
        status: statusFor(s.expiresOn, todayStr),
        pdfHref: `/training/skills/${s.id}/certificate?format=wallet&output=${defaultOutput.id}`,
        verifyHref: token ? `/verify/${token}` : null,
        ...faces,
      }
    }),
  )

  // Most-urgent first (expired, then expiring), then training before skills.
  const order = { expired: 0, expiring: 1, valid: 2, none: 3 }
  const cards = [...trainingCards, ...skillCards].sort((a, b) => order[a.status] - order[b.status])

  const design: WalletDesign = { widthIn, heightIn }

  return (
    <ListPageLayout
      header={
        <PageHeader
          back={{ href: '/my', label: 'Workspace' }}
          title="My wallet"
          description="Your certificates and credential cards. Tap a card to flip it, or download the print-ready pass."
        />
      }
    >
      <WalletStack cards={cards} design={design} />
    </ListPageLayout>
  )
}
