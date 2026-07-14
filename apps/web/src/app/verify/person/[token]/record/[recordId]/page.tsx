// Public wallet-card view for one training record on a badge transcript —
// the REAL rendered card (course-pinned design), flippable, plus the facts.
// Access is keyed entirely off the badge token; the record must belong to the
// badge holder.

import { and, desc, eq, isNull } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { db, withSuperAdmin } from '@beaconhs/db'
import {
  attachments,
  people,
  tenants,
  trainingCertificates,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { createWalletDesignDocument, renderDesignDocumentHtml } from '@beaconhs/design-studio'
import { presignGet } from '@beaconhs/storage'
import { appBaseUrl } from '@/lib/app-base-url'
import { resolveCourseCredentialOutput } from '@/lib/credential-designs'
import { activeTenantPredicate } from '@/lib/active-tenant'
import { isUuid } from '@/lib/list-params'
import { EXPIRING_DAYS, isoDaysFromNow, standingFor, todayIsoDate } from '../../_format'
import { factDay, PublicCardNotFound, PublicCardPage, verifyQrDataUrl } from '../../_card-page'

export const dynamic = 'force-dynamic'

export default async function VerifyPersonRecordPage({
  params,
}: {
  params: Promise<{ token: string; recordId: string }>
}) {
  const { token, recordId } = await params
  if (!isUuid(recordId)) notFound()

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
      .where(and(eq(people.badgeToken, token), isNull(people.deletedAt), activeTenantPredicate()))
      .limit(1)
    if (!row) return null

    const [record] = await tx
      .select({
        record: trainingRecords,
        course: trainingCourses,
      })
      .from(trainingRecords)
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(
        and(
          eq(trainingRecords.id, recordId),
          eq(trainingRecords.personId, row.person.id),
          isNull(trainingRecords.deletedAt),
        ),
      )
      .limit(1)
    if (!record) return null

    const [cert] = await tx
      .select({ verifyToken: trainingCertificates.verifyToken })
      .from(trainingCertificates)
      .where(
        and(eq(trainingCertificates.recordId, recordId), isNull(trainingCertificates.revokedAt)),
      )
      .orderBy(desc(trainingCertificates.createdAt))
      .limit(1)

    return { ...row, ...record, certToken: cert?.verifyToken ?? null }
  })

  if (!data) return <PublicCardNotFound backHref={backHref} />

  const base = appBaseUrl()
  // The card's QR verifies the certificate when one exists; otherwise it
  // points back at this live transcript so the printed QR is never dead.
  const verifyUrl = data.certToken ? `${base}/verify/${data.certToken}` : `${base}${backHref}`
  const qrDataUrl = await verifyQrDataUrl(verifyUrl)

  const output = resolveCourseCredentialOutput(data.course.metadata, data.tenant.settings, {
    format: 'wallet',
  })
  const document = output.document ?? createWalletDesignDocument(output)
  const cardData = {
    tenantName: data.tenant.name,
    tenantLogoUrl: data.tenant.branding.logoUrl,
    recipientFullName: `${data.person.firstName} ${data.person.lastName}`,
    recipientEmployeeNo: data.person.employeeNo,
    recipientPhotoUrl: data.photoKey
      ? await presignGet({ key: data.photoKey, expiresInSeconds: 300 })
      : null,
    credentialName: data.course.name,
    credentialCode: data.course.code,
    completedOn: data.record.completedOn,
    expiresOn: data.record.expiresOn,
    instructor: data.record.instructor,
    grade: data.record.grade,
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
      credentialName={data.course.name}
      standing={standingFor(data.record.expiresOn, todayIsoDate(), isoDaysFromNow(EXPIRING_DAYS))}
      frontHtml={frontHtml}
      backHtml={backHtml}
      widthIn={front?.width ?? 3.375}
      heightIn={front?.height ?? 2.125}
      facts={[
        { label: 'Course code', value: data.course.code },
        { label: 'Completed', value: factDay(data.record.completedOn) },
        {
          label: 'Expires',
          value: data.record.expiresOn ? factDay(data.record.expiresOn) : 'Does not expire',
        },
        { label: 'Instructor', value: data.record.instructor },
        { label: 'Issued by', value: data.tenant.name },
      ]}
      verifyHref={data.certToken ? `/verify/${data.certToken}` : null}
    />
  )
}
