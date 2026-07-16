import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
// Group sign-off sheet — a roomy, tablet-friendly page where a facilitator
// records ONE session against the document's published version and collects each
// attendee's signature on the device. Every signer writes their own
// document_acknowledgments row (with session_id), so the per-person compliance
// engine is satisfied exactly as for self-service acks.

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle, Button, PageHeader } from '@beaconhs/ui'
import {
  attachments,
  documentAcknowledgmentSessions,
  documentAcknowledgments,
  documentVersions,
  documents,
  people,
} from '@beaconhs/db/schema'
import { attachmentUrl } from '@/lib/attachment-url'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { isUuid, pickString } from '@/lib/list-params'
import { SignOffSheet, type SheetSigner } from './_sign-off-sheet'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1b116800589b7a') }
}

export default async function SignOffPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  const sp = await searchParams
  const resumeSessionId = pickString(sp.session) ?? null
  if (!isUuid(id) || (resumeSessionId !== null && !isUuid(resumeSessionId))) notFound()

  const backHref = `/documents/${id}?tab=acknowledgments`

  const ctx = await requireRequestContext()
  // Facilitator-only: the sign-off sheet loads the full active-people directory
  // and writes acks on behalf of others. Gate the render on documents.manage so
  // a read-only user can't reach the kiosk session or enumerate people.
  if (!can(ctx, 'documents.manage')) notFound()

  const data = await ctx.db(async (tx) => {
    const [doc] = await tx
      .select({ id: documents.id, title: documents.title, key: documents.key })
      .from(documents)
      .where(
        and(eq(documents.id, id), eq(documents.status, 'published'), isNull(documents.deletedAt)),
      )
      .limit(1)
    if (!doc) return null

    const [pub] = await tx
      .select({ id: documentVersions.id, version: documentVersions.version })
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, id), isNotNull(documentVersions.publishedAt)))
      .orderBy(desc(documentVersions.version))
      .limit(1)

    let roster: SheetSigner[] = []
    let sessionDetails: {
      title: string | null
      location: string | null
      notes: string | null
      siteOrgUnitId: string | null
      completedAt: string | null
    } | null = null
    let invalidSession = false
    if (resumeSessionId) {
      const [session] = pub
        ? await tx
            .select({
              id: documentAcknowledgmentSessions.id,
              title: documentAcknowledgmentSessions.title,
              location: documentAcknowledgmentSessions.location,
              notes: documentAcknowledgmentSessions.notes,
              siteOrgUnitId: documentAcknowledgmentSessions.siteOrgUnitId,
              completedAt: documentAcknowledgmentSessions.completedAt,
            })
            .from(documentAcknowledgmentSessions)
            .where(
              and(
                eq(documentAcknowledgmentSessions.id, resumeSessionId),
                eq(documentAcknowledgmentSessions.documentId, id),
                eq(documentAcknowledgmentSessions.versionId, pub.id),
                isNull(documentAcknowledgmentSessions.deletedAt),
              ),
            )
            .limit(1)
        : []
      invalidSession = !session
      if (session) {
        sessionDetails = {
          title: session.title,
          location: session.location,
          notes: session.notes,
          siteOrgUnitId: session.siteOrgUnitId,
          completedAt: session.completedAt?.toISOString() ?? null,
        }
        const rows = await tx
          .select({
            ackId: documentAcknowledgments.id,
            personId: documentAcknowledgments.personId,
            firstName: people.firstName,
            lastName: people.lastName,
            acknowledgedAt: documentAcknowledgments.acknowledgedAt,
            signatureAttachmentId: attachments.id,
          })
          .from(documentAcknowledgments)
          .innerJoin(people, eq(people.id, documentAcknowledgments.personId))
          .leftJoin(attachments, eq(attachments.id, documentAcknowledgments.signatureAttachmentId))
          .where(
            and(
              eq(documentAcknowledgments.sessionId, session.id),
              eq(documentAcknowledgments.documentId, id),
              eq(documentAcknowledgments.versionId, pub!.id),
            ),
          )
          .orderBy(asc(documentAcknowledgments.acknowledgedAt))
        roster = rows.map((r) => ({
          ackId: r.ackId,
          personId: r.personId,
          name: `${r.firstName} ${r.lastName}`.trim() || '(unnamed)',
          acknowledgedAt: r.acknowledgedAt.toISOString(),
          signatureUrl: r.signatureAttachmentId ? attachmentUrl(r.signatureAttachmentId) : null,
        }))
      }
    }

    return { doc, pub: pub ?? null, roster, invalidSession, sessionDetails }
  })

  if (!data) notFound()
  const { doc, pub, roster, invalidSession, sessionDetails } = data
  if (invalidSession) notFound()

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title={tGenerated('m_1b116800589b7a')}
          description={tGeneratedValue(`${doc.title} · ${doc.key}`)}
          back={{ href: backHref, label: 'Back to document' }}
        />

        <GeneratedValue
          value={
            !pub ? (
              <Alert variant="warning">
                <AlertTitle>
                  <GeneratedText id="m_1889b3a36ba7b2" />
                </AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>
                    <GeneratedText id="m_153dbb9f3fd767" />
                  </p>
                  <Link href={backHref}>
                    <Button variant="outline">
                      <ArrowLeft size={14} /> <GeneratedText id="m_0d77915e52a475" />
                    </Button>
                  </Link>
                </AlertDescription>
              </Alert>
            ) : (
              <SignOffSheet
                documentId={id}
                versionId={pub.id}
                versionNumber={pub.version}
                defaultTitle={doc.title}
                initialRoster={roster}
                initialSessionId={resumeSessionId}
                initialTitle={sessionDetails?.title ?? doc.title}
                initialLocation={sessionDetails?.location ?? ''}
                initialNotes={sessionDetails?.notes ?? ''}
                initialSiteOrgUnitId={sessionDetails?.siteOrgUnitId ?? null}
                completedAt={sessionDetails?.completedAt ?? null}
                backHref={backHref}
              />
            )
          }
        />
      </div>
    </PageContainer>
  )
}
