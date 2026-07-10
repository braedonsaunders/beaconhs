// Public wallet-card view for one granted skill on a badge transcript — the
// tenant's default wallet design rendered with the skill's data, same as the
// holder's own /my/wallet. Access is keyed entirely off the badge token.

import { and, desc, eq, isNull } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import {
  attachments,
  people,
  tenants,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillCertificates,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { createWalletDesignDocument, renderDesignDocumentHtml } from '@beaconhs/design-studio'
import { publicUrl } from '@beaconhs/storage'
import { appBaseUrl } from '@/lib/app-base-url'
import { resolveCredentialOutput } from '@/lib/credential-designs'
import { EXPIRING_DAYS, isoDaysFromNow, standingFor, todayIsoDate } from '../../_format'
import { factDay, PublicCardNotFound, PublicCardPage, verifyQrDataUrl } from '../../_card-page'

export const dynamic = 'force-dynamic'

export default async function VerifyPersonSkillPage({
  params,
}: {
  params: Promise<{ token: string; assignmentId: string }>
}) {
  const { token, assignmentId } = await params
  const backHref = `/verify/person/${token}`

  const data = await withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({
        person: people,
        tenant: tenants,
        photoKey: attachments.r2Key,
      })
      .from(people)
      .leftJoin(attachments, eq(attachments.id, people.photoAttachmentId))
      .innerJoin(tenants, eq(tenants.id, people.tenantId))
      .where(and(eq(people.badgeToken, token), isNull(people.deletedAt)))
      .limit(1)
    if (!row) return null

    const [skill] = await tx
      .select({
        assignment: trainingSkillAssignments,
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
      .where(
        and(
          eq(trainingSkillAssignments.id, assignmentId),
          eq(trainingSkillAssignments.personId, row.person.id),
          isNull(trainingSkillAssignments.deletedAt),
        ),
      )
      .limit(1)
    if (!skill) return null

    const [cert] = await tx
      .select({ verifyToken: trainingSkillCertificates.verifyToken })
      .from(trainingSkillCertificates)
      .where(
        and(
          eq(trainingSkillCertificates.skillAssignmentId, assignmentId),
          isNull(trainingSkillCertificates.revokedAt),
        ),
      )
      .orderBy(desc(trainingSkillCertificates.createdAt))
      .limit(1)

    return { ...row, ...skill, certToken: cert?.verifyToken ?? null }
  })

  if (!data) return <PublicCardNotFound backHref={backHref} />

  const base = appBaseUrl()
  const verifyUrl = data.certToken ? `${base}/verify/${data.certToken}` : `${base}${backHref}`
  const qrDataUrl = await verifyQrDataUrl(verifyUrl)

  const output = resolveCredentialOutput(data.tenant.settings, { format: 'wallet' })
  const document = output.document ?? createWalletDesignDocument(output)
  const cardData = {
    tenantName: data.tenant.name,
    tenantLogoUrl: data.tenant.branding.logoUrl,
    recipientFullName: `${data.person.firstName} ${data.person.lastName}`,
    recipientEmployeeNo: data.person.employeeNo,
    recipientPhotoUrl: data.photoKey ? publicUrl(data.photoKey) : null,
    credentialName: data.skillName,
    credentialCode: data.skillCode,
    authorityName: data.authorityName,
    completedOn: data.assignment.grantedOn,
    expiresOn: data.assignment.expiresOn,
    verifyUrl,
    verifyToken: data.certToken,
    qrDataUrl,
  }
  const frontId = document.artboards[0]?.id ?? null
  const backId = document.artboards[1]?.id ?? frontId
  const frontHtml = renderDesignDocumentHtml(document, cardData, { artboardId: frontId })
  const backHtml = renderDesignDocumentHtml(document, cardData, { artboardId: backId })
  const front = document.artboards[0]

  return (
    <PublicCardPage
      backHref={backHref}
      personName={cardData.recipientFullName}
      credentialName={data.skillName}
      standing={standingFor(
        data.assignment.expiresOn,
        todayIsoDate(),
        isoDaysFromNow(EXPIRING_DAYS),
      )}
      frontHtml={frontHtml}
      backHtml={backHtml}
      widthIn={front?.width ?? 3.375}
      heightIn={front?.height ?? 2.125}
      facts={[
        { label: 'Skill code', value: data.skillCode },
        { label: 'Granted', value: factDay(data.assignment.grantedOn) },
        {
          label: 'Expires',
          value: data.assignment.expiresOn ? factDay(data.assignment.expiresOn) : 'Does not expire',
        },
        { label: 'Authority', value: data.authorityName },
        { label: 'Issued by', value: data.tenant.name },
      ]}
      verifyHref={data.certToken ? `/verify/${data.certToken}` : null}
    />
  )
}
